import type { VercelRequest, VercelResponse } from '@vercel/node';
import { FieldValue } from 'firebase-admin/firestore';
import type { CreateBancarizedLoanRequest } from '../../src/lib/creditProviders/types.js';
import { requireAuthorizedActor } from '../_lib/auth.js';
import { CredigrupoClient } from '../_lib/credit-providers/credigrupo/client.js';
import { normalizeCredigrupoCreateSuccess } from '../_lib/credit-providers/credigrupo/createSuccess.js';
import { buildCredigrupoCreateFailurePatch } from '../_lib/credit-providers/credigrupo/operationFailure.js';
import { removeUndefined, reserveCredigrupoOperation } from '../_lib/credit-providers/credigrupo/store.js';
import { adminDb } from '../_lib/firebaseAdmin.js';
import { ApiError, handleApiError, parseJsonBody, sendJson } from '../_lib/http.js';

export default async function handler(request: VercelRequest, response: VercelResponse) {
  try {
    if (request.method !== 'POST') return sendJson(response, 405, { error: 'METHOD_NOT_ALLOWED' });
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
