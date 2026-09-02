import type { VercelRequest, VercelResponse } from '@vercel/node';
import { FieldValue } from 'firebase-admin/firestore';
import { requireAuthorizedActor } from '../_lib/auth.js';
import { CredigrupoClient } from '../_lib/credit-providers/credigrupo/client.js';
import { requireCredigrupoProposalId } from '../_lib/credit-providers/credigrupo/operationGuards.js';
import { isCredigrupoLoanCancelable } from '../../src/lib/creditProviders/loanStatus.js';
import type { StoredCredigrupoOperation } from '../_lib/credit-providers/credigrupo/store.js';
import { adminDb } from '../_lib/firebaseAdmin.js';
import { ApiError, handleApiError, parseJsonBody, sendJson } from '../_lib/http.js';

export default async function handler(request: VercelRequest, response: VercelResponse) {
  try {
    if (request.method !== 'POST') return sendJson(response, 405, { error: 'METHOD_NOT_ALLOWED' });
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
  } catch (error) {
    return handleApiError(response, error);
  }
}
