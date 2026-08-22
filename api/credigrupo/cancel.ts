import type { VercelRequest, VercelResponse } from '@vercel/node';
import { FieldValue } from 'firebase-admin/firestore';
import { requireAuthorizedActor } from '../_lib/auth';
import { CredigrupoClient } from '../_lib/credit-providers/credigrupo/client';
import type { StoredCredigrupoOperation } from '../_lib/credit-providers/credigrupo/store';
import { adminDb } from '../_lib/firebaseAdmin';
import { ApiError, handleApiError, parseJsonBody, sendJson } from '../_lib/http';

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
    if (!operation.proposalId) throw new ApiError(409, 'PROPOSAL_NOT_AVAILABLE', 'Proposta ainda nao identificada.');
    if (operation.status === 'FUNDED' || operation.status === 'SIGNED') {
      throw new ApiError(409, 'CANCELLATION_NOT_ALLOWED', 'A operacao nao pode mais ser cancelada pela API.');
    }

    await new CredigrupoClient({ allowWhenDisabled: true }).cancelLoan(operation.proposalId);
    await operationRef.set({
      status: 'CANCELLATION_REQUESTED',
      cancellationRequestedByUid: actor.uid,
      cancellationRequestedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    return sendJson(response, 200, { cancelled: true });
  } catch (error) {
    return handleApiError(response, error);
  }
}
