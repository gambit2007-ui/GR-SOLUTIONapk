import crypto from 'node:crypto';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { FieldValue } from 'firebase-admin/firestore';
import { requireAuthorizedActor } from '../_lib/auth.js';
import { CredigrupoClient } from '../_lib/credit-providers/credigrupo/client.js';
import { prepareManualCredigrupoCreateReconciliation } from '../_lib/credit-providers/credigrupo/createSuccess.js';
import {
  updateOperationFromRemoteLoan,
} from '../_lib/credit-providers/credigrupo/events.js';
import {
  assertCredigrupoDiscoveryAdmin,
  confirmCredigrupoLoanByProposalId,
  discoverExistingCredigrupoLoan,
  isCredigrupoDiscoveryAlreadyReconciled,
  type CredigrupoConfirmedLoanEvidence,
} from '../_lib/credit-providers/credigrupo/loanDiscovery.js';
import { buildHomologationAuditSummary, type HomologationAuditDocument } from '../_lib/credit-providers/credigrupo/homologationAudit.js';
import { requireCredigrupoProposalId } from '../_lib/credit-providers/credigrupo/operationGuards.js';
import { syncCredigrupoInstallments } from '../_lib/credit-providers/credigrupo/installments.js';
import { processStoredCredigrupoEvent } from '../_lib/credit-providers/credigrupo/webhookProcessor.js';
import { removeUndefined, type StoredCredigrupoOperation } from '../_lib/credit-providers/credigrupo/store.js';
import { adminDb } from '../_lib/firebaseAdmin.js';
import { ApiError, handleApiError, parseJsonBody, sendJson } from '../_lib/http.js';

const reconciliationEventRef = (key: string) =>
  adminDb.doc(`creditWebhookEvents/reconcile-${crypto.createHash('sha256').update(key).digest('hex')}`);

const maskedBorrowerId = (borrowerId: string) => `***${borrowerId.slice(-6)}`;

interface ReconcileRequest {
  operationId: string;
  action?: string;
  proposalId?: string;
  requestId?: string;
  pix?: {
    amountCents?: number;
    expiresAt?: string;
    correlationId?: string;
  };
}

const discoverExistingLoan = async (
  operationId: string,
  operation: StoredCredigrupoOperation,
  actor: { uid: string; admin: boolean },
) => {
  assertCredigrupoDiscoveryAdmin(actor);
  if (isCredigrupoDiscoveryAlreadyReconciled(operation)) {
    return {
      status: 'RECONCILED' as const,
      alreadyReconciled: true,
      proposalId: operation.proposalId,
      requestId: operation.requestId,
      externalStatus: operation.externalStatus,
      formalizationStatus: operation.formalizationStatus,
      unknownProviderStatus: operation.unknownProviderStatus === true,
      pix: operation.pix,
      localStatus: operation.status,
    };
  }
  if (operation.status !== 'RECONCILIATION_REQUIRED') {
    throw new ApiError(409, 'DISCOVERY_NOT_APPLICABLE', 'A operacao nao requer descoberta de proposta.');
  }

  const criteria = {
    borrowerId: operation.borrowerId,
    amountCents: operation.amountCents,
    installments: operation.installments,
    createdAt: operation.createdAt?.toDate().toISOString(),
    firstPaymentDate: operation.firstPaymentDate,
    interestRate: operation.interestRate,
    simulationExternalId: operation.simulationExternalId,
  };
  const discovery = await discoverExistingCredigrupoLoan(
    criteria,
    new CredigrupoClient({ allowWhenDisabled: true }),
  );
  const safeCriteria = {
    borrowerIdMasked: maskedBorrowerId(operation.borrowerId),
    amountCents: operation.amountCents,
    installments: operation.installments,
    createdAt: criteria.createdAt,
    firstPaymentDate: operation.firstPaymentDate,
    interestRate: operation.interestRate,
    simulationExternalId: operation.simulationExternalId,
  };
  if (discovery.status !== 'MATCHED') {
    return { ...discovery, criteria: safeCriteria, alreadyReconciled: false };
  }

  const reconciledAt = new Date().toISOString();
  const prepared = prepareManualCredigrupoCreateReconciliation({
    operationId,
    current: operation,
    confirmedResponse: discovery.confirmedResponse,
    receivedAt: reconciledAt,
  });
  const operationRef = adminDb.doc(`creditOperations/${operationId}`);
  const transactionResult = await adminDb.runTransaction(async (transaction) => {
    const currentSnapshot = await transaction.get(operationRef);
    if (!currentSnapshot.exists) throw new ApiError(404, 'OPERATION_NOT_FOUND', 'Operacao nao encontrada.');
    const current = currentSnapshot.data() as StoredCredigrupoOperation;
    if (current.proposalId === prepared.patch.proposalId && current.status !== 'RECONCILIATION_REQUIRED') {
      return { alreadyReconciled: true, operation: current };
    }
    if (current.status !== 'RECONCILIATION_REQUIRED') {
      throw new ApiError(409, 'RECONCILIATION_STATE_CHANGED', 'O estado da operacao mudou durante a descoberta.');
    }
    if (current.proposalId && current.proposalId !== prepared.patch.proposalId) {
      throw new ApiError(409, 'PROPOSAL_ID_MISMATCH', 'A operacao ja possui outra proposta externa.');
    }
    if (current.borrowerId !== operation.borrowerId
      || current.amountCents !== operation.amountCents
      || current.installments !== operation.installments
      || current.simulationExternalId !== operation.simulationExternalId) {
      throw new ApiError(409, 'DISCOVERY_CRITERIA_CHANGED', 'Os criterios da operacao mudaram durante a descoberta.');
    }

    transaction.update(operationRef, removeUndefined({
      ...prepared.patch,
      reconciledAt: FieldValue.serverTimestamp(),
      reconciledByUid: actor.uid,
      updatedAt: FieldValue.serverTimestamp(),
    }));
    return { alreadyReconciled: false, operation: { ...current, ...prepared.patch } };
  });

  return {
    status: 'RECONCILED' as const,
    listHttpStatus: discovery.listHttpStatus,
    detailHttpStatus: discovery.detailHttpStatus,
    receivedCount: discovery.receivedCount,
    total: discovery.total,
    candidates: 1,
    proposalId: transactionResult.operation.proposalId,
    requestId: transactionResult.operation.requestId,
    externalStatus: transactionResult.operation.externalStatus,
    formalizationStatus: transactionResult.operation.formalizationStatus,
    unknownProviderStatus: transactionResult.operation.unknownProviderStatus === true,
    pix: transactionResult.operation.pix,
    localStatus: transactionResult.operation.status,
    alreadyReconciled: transactionResult.alreadyReconciled,
    criteria: safeCriteria,
  };
};

const reconcileConfirmedLoan = async (
  operationId: string,
  operation: StoredCredigrupoOperation,
  evidence: CredigrupoConfirmedLoanEvidence,
  actor: { uid: string; admin: boolean },
) => {
  assertCredigrupoDiscoveryAdmin(actor);
  if (operation.proposalId === evidence.proposalId && operation.status !== 'RECONCILIATION_REQUIRED') {
    return {
      reconciled: true,
      alreadyReconciled: true,
      getLoanHttpStatus: undefined,
      proposalId: operation.proposalId,
      requestId: operation.requestId,
      externalStatus: operation.externalStatus,
      formalizationStatus: operation.formalizationStatus,
      unknownProviderStatus: operation.unknownProviderStatus === true,
      pix: operation.pix,
      localStatus: operation.status,
    };
  }
  if (operation.status !== 'RECONCILIATION_REQUIRED') {
    throw new ApiError(409, 'RECONCILIATION_NOT_APPLICABLE', 'A operacao nao requer conciliacao manual.');
  }
  if (operation.formalizationType !== 'BANCARIZED'
    || operation.provider !== 'CREDIGRUPO'
    || operation.fundingSource !== 'GR') {
    throw new ApiError(409, 'INVALID_OPERATION_PROVIDER', 'Operacao incompativel com a conciliacao confirmada.');
  }

  const criteria = {
    borrowerId: operation.borrowerId,
    amountCents: operation.amountCents,
    installments: operation.installments,
    createdAt: operation.createdAt?.toDate().toISOString(),
    firstPaymentDate: operation.firstPaymentDate,
    interestRate: operation.interestRate,
    simulationExternalId: operation.simulationExternalId,
  };
  const confirmation = await confirmCredigrupoLoanByProposalId(
    criteria,
    evidence,
    new CredigrupoClient({ allowWhenDisabled: true }),
  );
  const reconciledAt = new Date().toISOString();
  const prepared = prepareManualCredigrupoCreateReconciliation({
    operationId,
    current: operation,
    confirmedResponse: confirmation.confirmedResponse,
    receivedAt: reconciledAt,
  });
  const operationRef = adminDb.doc(`creditOperations/${operationId}`);
  const transactionResult = await adminDb.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(operationRef);
    if (!snapshot.exists) throw new ApiError(404, 'OPERATION_NOT_FOUND', 'Operacao nao encontrada.');
    const current = snapshot.data() as StoredCredigrupoOperation;
    if (current.proposalId === prepared.patch.proposalId && current.status !== 'RECONCILIATION_REQUIRED') {
      return { alreadyReconciled: true, operation: current };
    }
    if (current.status !== 'RECONCILIATION_REQUIRED') {
      throw new ApiError(409, 'RECONCILIATION_STATE_CHANGED', 'O estado da operacao mudou durante a consulta.');
    }
    if (current.proposalId && current.proposalId !== prepared.patch.proposalId) {
      throw new ApiError(409, 'PROPOSAL_ID_MISMATCH', 'A operacao ja possui outra proposta externa.');
    }
    if (current.borrowerId !== operation.borrowerId
      || current.amountCents !== operation.amountCents
      || current.installments !== operation.installments
      || current.interestRate !== operation.interestRate
      || current.firstPaymentDate !== operation.firstPaymentDate
      || current.simulationExternalId !== operation.simulationExternalId) {
      throw new ApiError(409, 'RECONCILIATION_CRITERIA_CHANGED', 'Os criterios da operacao mudaram durante a consulta.');
    }

    transaction.update(operationRef, removeUndefined({
      ...prepared.patch,
      reconciledAt: FieldValue.serverTimestamp(),
      reconciledByUid: actor.uid,
      updatedAt: FieldValue.serverTimestamp(),
    }));
    return { alreadyReconciled: false, operation: { ...current, ...prepared.patch } };
  });

  return {
    reconciled: true,
    alreadyReconciled: transactionResult.alreadyReconciled,
    getLoanHttpStatus: confirmation.detailHttpStatus,
    proposalId: transactionResult.operation.proposalId,
    requestId: transactionResult.operation.requestId,
    externalStatus: transactionResult.operation.externalStatus,
    formalizationStatus: transactionResult.operation.formalizationStatus,
    unknownProviderStatus: transactionResult.operation.unknownProviderStatus === true,
    pix: transactionResult.operation.pix,
    localStatus: transactionResult.operation.status,
  };
};

const toAuditDocument = (document: FirebaseFirestore.QueryDocumentSnapshot): HomologationAuditDocument => ({
  id: document.id,
  data: document.data(),
});

const fetchDocumentsByLinkedIds = async (collection: string, field: string, ids: string[]) => {
  const uniqueIds = [...new Set(ids.filter(Boolean))].slice(0, 30);
  const batches = Array.from({ length: Math.ceil(uniqueIds.length / 10) }, (_, index) => uniqueIds.slice(index * 10, index * 10 + 10));
  const snapshots = await Promise.all(batches.map((values) => (
    adminDb.collection(collection).where(field, 'in', values).limit(50).get()
  )));
  return snapshots.flatMap((snapshot) => snapshot.docs);
};

const auditHomologationOperation = async (operation: StoredCredigrupoOperation) => {
  const customerRef = adminDb.doc(`clientes/${operation.customerId}`);
  const [customerSnapshot, borrowerSnapshot, simulationSnapshot, operationSnapshot, loanSnapshot] = await Promise.all([
    customerRef.get(),
    adminDb.collection('creditBorrowers').where('customerId', '==', operation.customerId).limit(50).get(),
    adminDb.collection('creditSimulations').where('customerId', '==', operation.customerId).limit(50).get(),
    adminDb.collection('creditOperations').where('customerId', '==', operation.customerId).limit(50).get(),
    adminDb.collection('loans').where('customerId', '==', operation.customerId).limit(50).get(),
  ]);
  const operationIds = operationSnapshot.docs.map((document) => document.id);
  const loanIds = loanSnapshot.docs.map((document) => document.id);
  const proposalIds = operationSnapshot.docs.map((document) => String(document.data().proposalId || '')).filter(Boolean);
  const [cashByLoan, cashByOperation, ledgerByLoan, ledgerByOperation, ledgerByProposal] = await Promise.all([
    fetchDocumentsByLinkedIds('cashMovement', 'loanId', loanIds),
    fetchDocumentsByLinkedIds('cashMovement', 'operationId', operationIds),
    fetchDocumentsByLinkedIds('creditInvestorLedger', 'loanId', loanIds),
    fetchDocumentsByLinkedIds('creditInvestorLedger', 'operationId', operationIds),
    fetchDocumentsByLinkedIds('creditInvestorLedger', 'proposalId', proposalIds),
  ]);
  const uniqueDocuments = (documents: FirebaseFirestore.QueryDocumentSnapshot[]) => (
    [...new Map(documents.map((document) => [document.ref.path, document])).values()]
  );

  return buildHomologationAuditSummary({
    customerId: operation.customerId,
    customer: customerSnapshot.data(),
    borrowers: borrowerSnapshot.docs.map(toAuditDocument),
    simulations: simulationSnapshot.docs.map(toAuditDocument),
    operations: operationSnapshot.docs.map(toAuditDocument),
    loans: loanSnapshot.docs.map(toAuditDocument),
    cashMovements: uniqueDocuments([...cashByLoan, ...cashByOperation]).map(toAuditDocument),
    ledgerEntries: uniqueDocuments([...ledgerByLoan, ...ledgerByOperation, ...ledgerByProposal]).map(toAuditDocument),
  });
};

export default async function handler(request: VercelRequest, response: VercelResponse) {
  try {
    if (request.method !== 'POST') return sendJson(response, 405, { error: 'METHOD_NOT_ALLOWED' });
    const actor = await requireAuthorizedActor(request);
    if (!actor.admin) throw new ApiError(403, 'ADMIN_REQUIRED', 'Somente administradores podem reconciliar operacoes.');
    const input = parseJsonBody<ReconcileRequest>(request);
    const operationId = String(input.operationId || '').trim();
    if (!/^[a-zA-Z0-9_-]{8,160}$/.test(operationId)) {
      throw new ApiError(400, 'INVALID_OPERATION_ID', 'Identificador da operacao invalido.');
    }
    const operationRef = adminDb.doc(`creditOperations/${operationId}`);
    const operationSnapshot = await operationRef.get();
    if (!operationSnapshot.exists) throw new ApiError(404, 'OPERATION_NOT_FOUND', 'Operacao nao encontrada.');
    const operation = operationSnapshot.data() as StoredCredigrupoOperation;
    if (input.action === 'audit_homologation') {
      return sendJson(response, 200, {
        action: 'audit_homologation',
        readOnly: true,
        audit: await auditHomologationOperation(operation),
      });
    }
    if (input.action === 'discover_existing_loan') {
      return sendJson(response, 200, await discoverExistingLoan(operationId, operation, actor));
    }
    if (input.action === 'reconcile_confirmed_loan') {
      const evidence: CredigrupoConfirmedLoanEvidence = {
        proposalId: String(input.proposalId || '').trim(),
        requestId: String(input.requestId || '').trim(),
        pix: {
          amountCents: Number(input.pix?.amountCents),
          expiresAt: String(input.pix?.expiresAt || '').trim(),
          correlationId: String(input.pix?.correlationId || '').trim(),
        },
      };
      if (!/^[0-9a-f]{8}-[0-9a-f-]{27,}$/.test(evidence.proposalId)
        || !/^[A-Za-z0-9._:-]{1,200}$/.test(evidence.requestId || '')
        || !Number.isSafeInteger(evidence.pix?.amountCents)
        || Number(evidence.pix?.amountCents) <= 0
        || Number.isNaN(Date.parse(evidence.pix?.expiresAt || ''))
        || !/^[A-Za-z0-9._:-]{1,200}$/.test(evidence.pix?.correlationId || '')) {
        throw new ApiError(400, 'INVALID_CONFIRMED_LOAN_EVIDENCE', 'Dados confirmados da proposta invalidos.');
      }
      return sendJson(response, 200, await reconcileConfirmedLoan(operationId, operation, evidence, actor));
    }
    if (input.action) throw new ApiError(400, 'INVALID_RECONCILIATION_ACTION', 'Acao de reconciliacao invalida.');
    const proposalId = requireCredigrupoProposalId(operation);

    const client = new CredigrupoClient({ allowWhenDisabled: true });
    const [loanDetails, installments] = await Promise.all([
      client.getLoan(proposalId),
      client.listInstallments(proposalId),
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
    if (loanDetails.data.status === 'funded') {
      const event = {
        event: 'loan.funded',
        partnerId: 'reconciliation',
        timestamp: now,
        data: {
          proposalId,
          borrowerId: operation.borrowerId,
          amountCents: operation.amountCents,
        },
      };
      const eventRef = reconciliationEventRef(`${proposalId}:loan.funded`);
      await eventRef.set({
        eventId: eventRef.id,
        eventType: event.event,
        timestamp: event.timestamp,
        partnerId: event.partnerId,
        proposalId,
        status: 'RECEIVED',
        source: 'RECONCILIATION',
        receivedAt: FieldValue.serverTimestamp(),
        payload: event,
      }, { merge: true });
      await processStoredCredigrupoEvent(eventRef, event);
    }

    const localLoanId = operation.localLoanId
      || (loanDetails.data.status === 'funded' ? operationId : undefined);
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
      const paidRef = reconciliationEventRef(`${proposalId}:installment.paid:${installment.id}`);
      const paidSnapshot = await paidRef.get();
      if (!paidSnapshot.exists || paidSnapshot.data()?.status !== 'PROCESSED') {
        await paidRef.set({
          eventId: paidRef.id,
          eventType: paidEvent.event,
          timestamp: paidEvent.timestamp,
          partnerId: paidEvent.partnerId,
          proposalId,
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
            proposalId,
            installmentId: installment.id,
            installmentNumber: installment.installment_number,
            amountCents: installment.amount,
          },
        };
        const repaidRef = reconciliationEventRef(`${proposalId}:installment.investor_repaid:${installment.id}`);
        const repaidSnapshot = await repaidRef.get();
        if (!repaidSnapshot.exists || repaidSnapshot.data()?.status !== 'PROCESSED') {
          await repaidRef.set({
            eventId: repaidRef.id,
            eventType: repaidEvent.event,
            timestamp: repaidEvent.timestamp,
            partnerId: repaidEvent.partnerId,
            proposalId,
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
      externalStatus: loanDetails.data.status,
      formalizationStatus: loanDetails.data.formalization_status,
      installments: installments.data.length,
    });
  } catch (error) {
    return handleApiError(response, error);
  }
}
