import type { VercelRequest, VercelResponse } from '@vercel/node';
import { FieldValue } from 'firebase-admin/firestore';
import type { CreateBancarizedLoanRequest } from '../../src/lib/creditProviders/types.js';
import { isCredigrupoLoanCancelable } from '../../src/lib/creditProviders/loanStatus.js';
import { requireAuthorizedActor } from '../_lib/auth.js';
import { CredigrupoClient } from '../_lib/credit-providers/credigrupo/client.js';
import { normalizeCredigrupoCreateSuccess } from '../_lib/credit-providers/credigrupo/createSuccess.js';
import { buildCredigrupoCreateFailurePatch } from '../_lib/credit-providers/credigrupo/operationFailure.js';
import { requireCredigrupoProposalId } from '../_lib/credit-providers/credigrupo/operationGuards.js';
import { removeUndefined, reserveCredigrupoOperation, type StoredCredigrupoOperation } from '../_lib/credit-providers/credigrupo/store.js';
import { adminDb } from '../_lib/firebaseAdmin.js';
import { ApiError, handleApiError, parseJsonBody, sendJson } from '../_lib/http.js';

async function requestCancellation(request: VercelRequest, response: VercelResponse) {
  const actor = await requireAuthorizedActor(request);
  if (!actor.admin) throw new ApiError(403, 'ADMIN_REQUIRED', 'Somente administradores podem cancelar uma bancarizacao.');
  const input = parseJsonBody<{ operationId: string }>(request);
  const operationId = String(input.operationId || '').trim();
  const operationRef = adminDb.doc(`creditOperations/${operationId}`);
  const operationSnapshot = await operationRef.get();
  if (!operationSnapshot.exists) throw new ApiError(404, 'OPERATION_NOT_FOUND', 'Operacao nao encontrada.');
  const operation = operationSnapshot.data() as StoredCredigrupoOperation;
  const proposalId = requireCredigrupoProposalId(operation);
  if (operation.status === 'FUNDED' || operation.status === 'SIGNED') {
    throw new ApiError(409, 'CANCELLATION_NOT_ALLOWED', 'A operacao nao pode mais ser cancelada pela API.');
  }

  const client = new CredigrupoClient({ allowWhenDisabled: true });
  const remote = await client.getLoan(proposalId);
  if (!isCredigrupoLoanCancelable(remote.data.status)) {
    throw new ApiError(409, 'CANCELLATION_NOT_ALLOWED', 'O status atual da Credigrupo nao permite cancelamento.');
  }
  await client.cancelLoan(proposalId);
  await operationRef.set({
    status: 'CANCELLATION_REQUESTED',
    externalStatus: remote.data.status,
    formalizationStatus: remote.data.formalization_status,
    cancellationRequestedByUid: actor.uid,
    cancellationRequestedAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });
  return sendJson(response, 200, { cancellationRequested: true, cancelled: false });
}

export default async function handler(request: VercelRequest, response: VercelResponse) {
  try {
    if (request.method !== 'POST') return sendJson(response, 405, { error: 'METHOD_NOT_ALLOWED' });
    if (request.query.route === 'cancel') return requestCancellation(request, response);
    const actor = await requireAuthorizedActor(request);
    const input = parseJsonBody<CreateBancarizedLoanRequest>(request);
    if (!/^[a-zA-Z0-9_-]{8,160}$/.test(String(input.operationId || ''))) {
      throw new ApiError(400, 'INVALID_OPERATION_ID', 'Identificador da operacao invalido.');
    }
    if (input.fundingSource !== 'GR') {
      throw new ApiError(400, 'INVALID_FUNDING_SOURCE', 'A chave propria Credigrupo aceita somente capital da GR.');
    }
    const reserved = await reserveCredigrupoOperation(input, actor);
    if (reserved.duplicate) {
      if (!reserved.operation.proposalId) {
        throw new ApiError(409, 'BANCARIZATION_PENDING', 'A bancarizacao ja esta em processamento.');
      }
      return sendJson(response, 200, {
        operationId: input.operationId,
        proposalId: reserved.operation.proposalId,
        requestId: reserved.operation.requestId,
        status: reserved.operation.externalStatus || 'unknown',
        internalStatus: reserved.operation.status,
        formalizationStatus: reserved.operation.formalizationStatus,
        unknownProviderStatus: reserved.operation.unknownProviderStatus === true,
        pix: reserved.operation.pix,
        duplicate: true,
      });
    }

    try {
      const created = await new CredigrupoClient().createLoan({
        borrowerId: reserved.operation.borrowerId,
        amountCents: reserved.operation.amountCents,
        installments: reserved.operation.installments,
        interestRate: reserved.operation.interestRate,
        firstPaymentDate: reserved.operation.firstPaymentDate,
        frequency: reserved.operation.frequency,
        interestType: reserved.operation.interestType,
        notes: `GR_OPERATION:${input.operationId}`,
        ccbSimulationData: { simulation: reserved.operation.simulation },
      });
      const normalized = normalizeCredigrupoCreateSuccess(created);
      const localLoanId = normalized.internalStatus === 'AWAITING_LENDER_PAYMENT'
        ? adminDb.collection('loans').doc().id
        : undefined;
      await adminDb.doc(`creditOperations/${input.operationId}`).update(removeUndefined({
        ...normalized,
        localLoanId,
        updatedAt: FieldValue.serverTimestamp(),
      }));
      if (!normalized.proposalId) {
        throw new ApiError(
          502,
          'CREDIGRUPO_SUCCESS_WITHOUT_PROPOSAL_ID',
          'A Credigrupo confirmou a requisicao sem informar a proposta.',
        );
      }
      return sendJson(response, 201, {
        operationId: input.operationId,
        ...created,
        proposalId: normalized.proposalId,
        requestId: normalized.requestId,
        status: normalized.externalStatus || 'unknown',
        internalStatus: normalized.internalStatus,
        formalizationStatus: normalized.formalizationStatus,
        unknownProviderStatus: normalized.unknownProviderStatus,
        duplicate: false,
      });
    } catch (error) {
      await adminDb.doc(`creditOperations/${input.operationId}`).set(removeUndefined({
        ...buildCredigrupoCreateFailurePatch(error),
        updatedAt: FieldValue.serverTimestamp(),
      }), { merge: true });
      throw error;
    }
  } catch (error) {
    return handleApiError(response, error);
  }
}
