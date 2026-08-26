import crypto from 'node:crypto';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { FieldValue } from 'firebase-admin/firestore';
import { requireAuthorizedActor } from '../_lib/auth.js';
import { CredigrupoClient } from '../_lib/credit-providers/credigrupo/client.js';
import {
  updateOperationFromRemoteLoan,
} from '../_lib/credit-providers/credigrupo/events.js';
import { syncCredigrupoInstallments } from '../_lib/credit-providers/credigrupo/installments.js';
import { processStoredCredigrupoEvent } from '../_lib/credit-providers/credigrupo/webhookProcessor.js';
import type { StoredCredigrupoOperation } from '../_lib/credit-providers/credigrupo/store.js';
import { adminDb } from '../_lib/firebaseAdmin.js';
import { ApiError, handleApiError, parseJsonBody, sendJson } from '../_lib/http.js';

const reconciliationEventRef = (key: string) =>
  adminDb.doc(`creditWebhookEvents/reconcile-${crypto.createHash('sha256').update(key).digest('hex')}`);

export default async function handler(request: VercelRequest, response: VercelResponse) {
  try {
    if (request.method !== 'POST') return sendJson(response, 405, { error: 'METHOD_NOT_ALLOWED' });
    const actor = await requireAuthorizedActor(request);
    if (!actor.admin) throw new ApiError(403, 'ADMIN_REQUIRED', 'Somente administradores podem reconciliar operacoes.');
    const input = parseJsonBody<{ operationId: string }>(request);
    const operationId = String(input.operationId || '').trim();
    const operationRef = adminDb.doc(`creditOperations/${operationId}`);
    const operationSnapshot = await operationRef.get();
    if (!operationSnapshot.exists) throw new ApiError(404, 'OPERATION_NOT_FOUND', 'Operacao nao encontrada.');
    const operation = operationSnapshot.data() as StoredCredigrupoOperation;
    if (!operation.proposalId) throw new ApiError(409, 'PROPOSAL_NOT_AVAILABLE', 'Proposta ainda nao identificada.');

    const client = new CredigrupoClient({ allowWhenDisabled: true });
    const [loanDetails, installments] = await Promise.all([
      client.getLoan(operation.proposalId),
      client.listInstallments(operation.proposalId),
    ]);
    await updateOperationFromRemoteLoan(operationId, {
      status: loanDetails.data.status,
      formalizationStatus: loanDetails.data.formalization_status,
      ccbNumber: loanDetails.data.hiperbanco_ccb_number,
      ccbUrl: loanDetails.data.ccb_url,
      borrowerSignUrl: loanDetails.data.borrower_signature_link,
      investorSignUrl: loanDetails.data.lender_signature_link,
    });

    const now = new Date().toISOString();
    if (loanDetails.data.formalization_status === 'funded') {
      const event = {
        event: 'loan.funded',
        partnerId: 'reconciliation',
        timestamp: now,
        data: {
          proposalId: operation.proposalId,
          borrowerId: operation.borrowerId,
          amountCents: operation.amountCents,
        },
      };
      const eventRef = reconciliationEventRef(`${operation.proposalId}:loan.funded`);
      await eventRef.set({
        eventId: eventRef.id,
        eventType: event.event,
        proposalId: operation.proposalId,
        status: 'RECEIVED',
        source: 'RECONCILIATION',
        receivedAt: FieldValue.serverTimestamp(),
        payload: event,
      }, { merge: true });
      await processStoredCredigrupoEvent(eventRef, event);
    }

    const localLoanId = operation.localLoanId
      || (loanDetails.data.formalization_status === 'funded' ? operationId : undefined);
    if (localLoanId) await syncCredigrupoInstallments(localLoanId, installments.data);

    for (const installment of installments.data) {
      if (installment.status !== 'paid') continue;
      const paidEvent = {
        event: 'installment.paid',
        partnerId: 'reconciliation',
        timestamp: installment.payment_date ? `${installment.payment_date}T12:00:00.000Z` : now,
        data: {
          proposalId: operation.proposalId,
          installmentId: installment.id,
          installmentNumber: installment.installment_number,
          amountCents: installment.amount,
          dueDate: installment.due_date,
          paidAt: installment.payment_date ? `${installment.payment_date}T12:00:00.000Z` : now,
        },
      };
      const paidRef = reconciliationEventRef(`${operation.proposalId}:installment.paid:${installment.id}`);
      const paidSnapshot = await paidRef.get();
      if (!paidSnapshot.exists || paidSnapshot.data()?.status !== 'PROCESSED') {
        await paidRef.set({
          eventId: paidRef.id,
          eventType: paidEvent.event,
          proposalId: operation.proposalId,
          installmentId: installment.id,
          status: 'RECEIVED',
          source: 'RECONCILIATION',
          receivedAt: FieldValue.serverTimestamp(),
          payload: paidEvent,
        }, { merge: true });
        await processStoredCredigrupoEvent(paidRef, paidEvent);
      }

      if (installment.investor_payout_status === 'completed') {
        const repaidEvent = {
          event: 'installment.investor_repaid',
          partnerId: 'reconciliation',
          timestamp: now,
          data: {
            proposalId: operation.proposalId,
            installmentId: installment.id,
            installmentNumber: installment.installment_number,
            amountCents: installment.amount,
          },
        };
        const repaidRef = reconciliationEventRef(`${operation.proposalId}:installment.investor_repaid:${installment.id}`);
        const repaidSnapshot = await repaidRef.get();
        if (!repaidSnapshot.exists || repaidSnapshot.data()?.status !== 'PROCESSED') {
          await repaidRef.set({
            eventId: repaidRef.id,
            eventType: repaidEvent.event,
            proposalId: operation.proposalId,
            installmentId: installment.id,
            status: 'RECEIVED',
            source: 'RECONCILIATION',
            receivedAt: FieldValue.serverTimestamp(),
            payload: repaidEvent,
          }, { merge: true });
          await processStoredCredigrupoEvent(repaidRef, repaidEvent);
        }
      }
    }

    return sendJson(response, 200, {
      reconciled: true,
      externalStatus: loanDetails.data.formalization_status,
      installments: installments.data.length,
    });
  } catch (error) {
    return handleApiError(response, error);
  }
}
