import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireAuthorizedActor } from '../../_lib/auth';
import { CredigrupoClient } from '../../_lib/credit-providers/credigrupo/client';
import { resolveCredigrupoInstallment } from '../../_lib/credit-providers/credigrupo/installments';
import type { StoredCredigrupoOperation } from '../../_lib/credit-providers/credigrupo/store';
import { adminDb } from '../../_lib/firebaseAdmin';
import { ApiError, handleApiError, parseJsonBody, sendJson } from '../../_lib/http';

export default async function handler(request: VercelRequest, response: VercelResponse) {
  try {
    if (request.method !== 'POST') return sendJson(response, 405, { error: 'METHOD_NOT_ALLOWED' });
    const actor = await requireAuthorizedActor(request);
    if (!actor.admin) throw new ApiError(403, 'ADMIN_REQUIRED', 'Somente administradores podem simular pagamentos.');
    const input = parseJsonBody<{ operationId?: string; contractId?: string; installmentId?: string }>(request);
    const client = new CredigrupoClient();

    const operationId = String(input.operationId || '').trim();
    if (operationId) {
      const snapshot = await adminDb.doc(`creditOperations/${operationId}`).get();
      if (!snapshot.exists) throw new ApiError(404, 'OPERATION_NOT_FOUND', 'Operacao nao encontrada.');
      const operation = snapshot.data() as StoredCredigrupoOperation;
      if (operation.formalizationType !== 'BANCARIZED' || operation.provider !== 'CREDIGRUPO') {
        throw new ApiError(409, 'INVALID_OPERATION_PROVIDER', 'Operacao nao pertence a Credigrupo.');
      }
      if (!operation.proposalId) throw new ApiError(409, 'PROPOSAL_NOT_AVAILABLE', 'Proposta ainda nao identificada.');
      await client.testPayLoan(operation.proposalId);
      return sendJson(response, 200, { simulated: true, target: 'FUNDING' });
    }

    const context = await resolveCredigrupoInstallment(
      client,
      String(input.contractId || ''),
      String(input.installmentId || ''),
    );
    await client.testPayInstallment(context.proposalId, context.externalInstallmentId);
    return sendJson(response, 200, { simulated: true, target: 'INSTALLMENT' });
  } catch (error) {
    return handleApiError(response, error);
  }
}
