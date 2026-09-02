import type { VercelRequest, VercelResponse } from '@vercel/node';
import { FieldValue } from 'firebase-admin/firestore';
import { requireAuthorizedActor } from '../../_lib/auth.js';
import { CredigrupoClient } from '../../_lib/credit-providers/credigrupo/client.js';
import { requireCredigrupoProposalId } from '../../_lib/credit-providers/credigrupo/operationGuards.js';
import { resolveCredigrupoInstallment } from '../../_lib/credit-providers/credigrupo/installments.js';
import { removeUndefined, type StoredCredigrupoOperation } from '../../_lib/credit-providers/credigrupo/store.js';
import {
  assertCredigrupoFundingTestPayReady,
  normalizeCredigrupoTestPaySuccess,
} from '../../_lib/credit-providers/credigrupo/testPay.js';
import { adminDb } from '../../_lib/firebaseAdmin.js';
import { ApiError, handleApiError, parseJsonBody, sendJson } from '../../_lib/http.js';

export default async function handler(request: VercelRequest, response: VercelResponse) {
  try {
    if (request.method !== 'POST') return sendJson(response, 405, { error: 'METHOD_NOT_ALLOWED' });
    const actor = await requireAuthorizedActor(request);
    if (!actor.admin) throw new ApiError(403, 'ADMIN_REQUIRED', 'Somente administradores podem simular pagamentos.');
    const input = parseJsonBody<{ operationId?: string; contractId?: string; installmentId?: string }>(request);
    const client = new CredigrupoClient();

    const operationId = String(input.operationId || '').trim();
    if (operationId) {
      if (!/^[a-zA-Z0-9_-]{8,160}$/.test(operationId)) {
        throw new ApiError(400, 'INVALID_OPERATION_ID', 'Identificador da operacao invalido.');
      }
      const operationRef = adminDb.doc(`creditOperations/${operationId}`);
      const reserved = await adminDb.runTransaction(async (transaction) => {
        const snapshot = await transaction.get(operationRef);
        if (!snapshot.exists) throw new ApiError(404, 'OPERATION_NOT_FOUND', 'Operacao nao encontrada.');
        const operation = snapshot.data() as StoredCredigrupoOperation;
        assertCredigrupoFundingTestPayReady(operation);
        const proposalId = requireCredigrupoProposalId(operation);
        transaction.update(operationRef, {
          testPayStatus: 'REQUESTING',
          testPayRequestedAt: FieldValue.serverTimestamp(),
          testPayRequestedByUid: actor.uid,
          updatedAt: FieldValue.serverTimestamp(),
        });
        return { proposalId };
      });

      try {
        const providerResponse = await client.testPayLoan(reserved.proposalId);
        const result = normalizeCredigrupoTestPaySuccess(providerResponse, reserved.proposalId);
        await operationRef.set(removeUndefined({
          testPayStatus: 'SUCCEEDED',
          testPayResult: result,
          testPayCompletedAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        }), { merge: true });
        return sendJson(response, 200, { simulated: true, target: 'FUNDING', ...result });
      } catch (error) {
        await operationRef.set({
          testPayStatus: 'FAILED',
          testPayErrorCode: error instanceof ApiError ? error.code : 'TEST_PAY_FAILED',
          testPayCompletedAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });
        throw error;
      }
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
