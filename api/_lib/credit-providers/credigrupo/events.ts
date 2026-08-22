import { FieldValue } from 'firebase-admin/firestore';
import { applyLoanPaymentToCurrentLoan } from '../../../../src/utils/financialEngine';
import { parseLoan } from '../../../../src/utils/domainParsers';
import { resolveBancarizedCashDelta } from '../../../../src/utils/creditFunding';
import type { Installment, Loan } from '../../../../src/types';
import { adminDb } from '../../firebaseAdmin';
import { StoredCredigrupoOperation, findOperationByProposalId, removeUndefined } from './store';

export interface CredigrupoWebhookEvent {
  event: string;
  partnerId: string;
  timestamp: string;
  data: Record<string, unknown>;
}

const SYSTEM_UID = 'system:credigrupo';
const allowedSignatureHosts = new Set(['app.zapsign.com.br']);
const allowedDocumentHosts = new Set(['storage.supabase.co']);
const allowedPixHosts = new Set(['api.woovi.com']);

const safeUrl = (value: unknown, allowedHosts: Set<string>): string | undefined => {
  const raw = String(value || '').trim();
  if (!raw) return undefined;
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' && allowedHosts.has(url.hostname.toLowerCase()) ? url.toString() : undefined;
  } catch {
    return undefined;
  }
};

const asText = (value: unknown): string => String(value || '').trim();
const asPositiveNumber = (value: unknown): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
};

const markEvent = (transaction: FirebaseFirestore.Transaction, eventRef: FirebaseFirestore.DocumentReference, fields: Record<string, unknown>) => {
  transaction.set(eventRef, removeUndefined({ ...fields, updatedAt: FieldValue.serverTimestamp() }), { merge: true });
};

const findInstallmentIndex = (installments: Installment[], data: Record<string, unknown>): number => {
  const installmentId = asText(data.installmentId);
  const installmentNumber = Number(data.installmentNumber || 0);
  const byExternalId = installments.findIndex((item) => item.credigrupo?.installmentId === installmentId);
  if (byExternalId >= 0) return byExternalId;
  return installments.findIndex((item) => Number(item.number) === installmentNumber);
};

const activateFundedLoan = async (
  operationDocument: FirebaseFirestore.QueryDocumentSnapshot,
  eventRef: FirebaseFirestore.DocumentReference,
  event: CredigrupoWebhookEvent,
) => {
  const operationRef = operationDocument.ref;
  await adminDb.runTransaction(async (transaction) => {
    const operationSnapshot = await transaction.get(operationRef);
    if (!operationSnapshot.exists) throw new Error('CREDIGRUPO_OPERATION_NOT_FOUND');
    const operation = operationSnapshot.data() as StoredCredigrupoOperation;
    const loanId = operation.localLoanId || operationRef.id;
    const loanRef = adminDb.doc(`loans/${loanId}`);
    const counterRef = adminDb.doc('settings/contractCounter');
    const caixaRef = adminDb.doc('settings/caixa');
    const reads: Promise<FirebaseFirestore.DocumentSnapshot>[] = [
      transaction.get(loanRef),
      transaction.get(counterRef),
    ];
    if (operation.fundingSource === 'GR') reads.push(transaction.get(caixaRef));
    const [loanSnapshot, counterSnapshot, caixaSnapshot] = await Promise.all(reads);

    if (!loanSnapshot.exists) {
      const lastNumber = Math.trunc(Number(counterSnapshot.data()?.lastNumber || 0));
      const contractNumber = Math.max(lastNumber + 1, 2026001);
      const installments: Installment[] = operation.simulation.installments.map((installment) => ({
        id: `credigrupo-${installment.installmentNumber}`,
        number: installment.installmentNumber,
        amount: Number((installment.amount / 100).toFixed(2)),
        value: Number((installment.amount / 100).toFixed(2)),
        dueDate: installment.dueDate,
        status: 'PENDENTE',
        paidAmount: 0,
        partialPaid: 0,
        expectedPrincipal: Number((installment.principal / 100).toFixed(2)),
        expectedInterest: Number((installment.interest / 100).toFixed(2)),
      }));
      const totalToReturn = Number((operation.simulation.totalAmount / 100).toFixed(2));
      const amount = Number((operation.amountCents / 100).toFixed(2));
      const loan: Omit<Loan, 'id'> = {
        contractNumber: String(contractNumber),
        customerId: operation.customerId,
        customerName: operation.customerName,
        customerPhone: operation.customerPhone,
        amount,
        interestRate: operation.interestRate,
        installmentCount: installments.length,
        installmentsCount: installments.length,
        frequency: operation.frequency === 'weekly' ? 'SEMANAL' : 'MENSAL',
        interestType: operation.interestType === 'compound' ? 'PRICE' : 'SIMPLES',
        totalToReturn,
        installmentValue: installments[0]?.amount,
        startDate: operation.firstPaymentDate,
        dueDate: installments[installments.length - 1]?.dueDate || operation.firstPaymentDate,
        installments,
        status: 'ATIVO',
        paidAmount: 0,
        version: 0,
        hasFinancialHistory: false,
        formalizationType: 'BANCARIZED',
        provider: 'CREDIGRUPO',
        funding: {
          source: operation.fundingSource,
          investorId: operation.investorId,
          investorName: operation.investorName,
        },
        credigrupo: {
          operationId: operationRef.id,
          borrowerId: operation.borrowerId,
          investorId: operation.investorId,
          proposalId: operation.proposalId,
          requestId: operation.requestId,
          externalStatus: 'funded',
          fundingStatus: 'funded',
          borrowerSignUrl: operation.borrowerSignUrl,
          investorSignUrl: operation.investorSignUrl,
          ccbUrl: operation.ccbUrl,
          fundedAt: event.timestamp,
          updatedAt: event.timestamp,
        },
        createdAt: FieldValue.serverTimestamp() as unknown as Loan['createdAt'],
        lastOperationId: `credigrupo-funded-${operation.proposalId || operationRef.id}`,
        lastOperationType: 'BANCARIZATION_FUNDED',
        lastOperationAt: FieldValue.serverTimestamp() as unknown as Loan['lastOperationAt'],
        lastOperationByUid: SYSTEM_UID,
        lastOperationByName: 'Credigrupo',
      };
      transaction.create(loanRef, removeUndefined(loan));
      transaction.set(counterRef, {
        lastNumber: contractNumber,
        lastContractNumber: String(contractNumber),
        lastLoanId: loanId,
        updatedByUid: SYSTEM_UID,
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });

      const cashDelta = resolveBancarizedCashDelta(operation.fundingSource, 'LOAN_FUNDED', amount);
      if (cashDelta !== 0) {
        const movementId = `credigrupo-funded-${operation.proposalId || operationRef.id}`;
        const movementRef = adminDb.doc(`cashMovement/${movementId}`);
        const currentCash = Number(caixaSnapshot?.data()?.value || 0);
        transaction.create(movementRef, {
          type: 'RETIRADA',
          amount,
          description: `EMPRESTIMO BANCARIZADO: ${operation.customerName}`,
          date: event.timestamp,
          loanId,
          operationId: movementId,
          createdByUid: SYSTEM_UID,
          createdByName: 'Credigrupo',
          recordedAt: FieldValue.serverTimestamp(),
        });
        transaction.set(caixaRef, {
          value: Number((currentCash + cashDelta).toFixed(2)),
          lastMovementId: movementId,
          updatedByUid: SYSTEM_UID,
          updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });
      }
    }

    transaction.set(operationRef, {
      localLoanId: loanId,
      status: 'FUNDED',
      externalStatus: 'funded',
      fundedAt: event.timestamp,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    markEvent(transaction, eventRef, { status: 'PROCESSED', processedAt: FieldValue.serverTimestamp(), localLoanId: loanId });
  });
};

const updateOperationState = async (
  operationDocument: FirebaseFirestore.QueryDocumentSnapshot,
  eventRef: FirebaseFirestore.DocumentReference,
  fields: Record<string, unknown>,
) => {
  await adminDb.runTransaction(async (transaction) => {
    transaction.set(operationDocument.ref, removeUndefined({ ...fields, updatedAt: FieldValue.serverTimestamp() }), { merge: true });
    markEvent(transaction, eventRef, { status: 'PROCESSED', processedAt: FieldValue.serverTimestamp() });
  });
};

const updateInstallmentPix = async (
  operationDocument: FirebaseFirestore.QueryDocumentSnapshot,
  eventRef: FirebaseFirestore.DocumentReference,
  event: CredigrupoWebhookEvent,
) => {
  const operation = operationDocument.data() as StoredCredigrupoOperation;
  if (!operation.localLoanId) {
    return updateOperationState(operationDocument, eventRef, {
      status: 'FUNDED',
      pendingInstallmentEvent: event.data,
    });
  }
  await adminDb.runTransaction(async (transaction) => {
    const loanRef = adminDb.doc(`loans/${operation.localLoanId}`);
    const loanSnapshot = await transaction.get(loanRef);
    if (!loanSnapshot.exists) throw new Error('LOCAL_LOAN_NOT_FOUND');
    const loan = parseLoan(loanSnapshot.id, loanSnapshot.data());
    const index = findInstallmentIndex(loan.installments, event.data);
    if (index < 0) throw new Error('LOCAL_INSTALLMENT_NOT_FOUND');
    const installments = [...loan.installments];
    installments[index] = {
      ...installments[index],
      credigrupo: {
        ...installments[index].credigrupo,
        installmentId: asText(event.data.installmentId),
        externalStatus: 'pending',
        pixBrcode: asText(event.data.pixBrcode),
        pixQrCode: safeUrl(event.data.pixQrCode, allowedPixHosts),
        totalCents: asPositiveNumber(event.data.totalCents),
        updatedAt: event.timestamp,
      },
    };
    transaction.update(loanRef, removeUndefined({ installments, updatedAt: FieldValue.serverTimestamp() }));
    transaction.set(operationDocument.ref, {
      lastInstallmentEventAt: event.timestamp,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    markEvent(transaction, eventRef, { status: 'PROCESSED', processedAt: FieldValue.serverTimestamp() });
  });
};

const applyInstallmentPayment = async (
  operationDocument: FirebaseFirestore.QueryDocumentSnapshot,
  eventRef: FirebaseFirestore.DocumentReference,
  event: CredigrupoWebhookEvent,
) => {
  const operation = operationDocument.data() as StoredCredigrupoOperation;
  if (!operation.localLoanId) {
    return updateOperationState(operationDocument, eventRef, { pendingPaymentEvent: event.data, status: 'RECONCILIATION_REQUIRED' });
  }
  await adminDb.runTransaction(async (transaction) => {
    const loanRef = adminDb.doc(`loans/${operation.localLoanId}`);
    const installmentId = asText(event.data.installmentId);
    if (!installmentId) throw new Error('CREDIGRUPO_INSTALLMENT_ID_REQUIRED');
    const operationId = `credigrupo-payment-${installmentId}`;
    const ledgerRef = adminDb.doc(`creditInvestorLedger/${operationId}`);
    const [loanSnapshot, ledgerSnapshot] = await Promise.all([
      transaction.get(loanRef),
      transaction.get(ledgerRef),
    ]);
    if (!loanSnapshot.exists) throw new Error('LOCAL_LOAN_NOT_FOUND');
    if (ledgerSnapshot.exists) {
      markEvent(transaction, eventRef, {
        status: 'PROCESSED',
        processedAt: FieldValue.serverTimestamp(),
        duplicateFinancialEffect: true,
      });
      return;
    }
    const currentLoan = parseLoan(loanSnapshot.id, loanSnapshot.data());
    const installmentIndex = findInstallmentIndex(currentLoan.installments, event.data);
    if (installmentIndex < 0) throw new Error('LOCAL_INSTALLMENT_NOT_FOUND');
    const paidAmount = Number((asPositiveNumber(event.data.amountCents) / 100).toFixed(2));
    if (paidAmount <= 0) throw new Error('CREDIGRUPO_PAYMENT_AMOUNT_INVALID');
    const result = applyLoanPaymentToCurrentLoan(currentLoan, {
      operationId,
      amount: paidAmount,
      installmentIndex,
      applyMode: 'INSTALLMENTS',
      processedAt: asText(event.data.paidAt) || event.timestamp,
    }, 0);
    const { id: _loanId, ...loanUpdate } = result.loan;
    const installments = [...loanUpdate.installments];
    installments[installmentIndex] = {
      ...installments[installmentIndex],
      credigrupo: {
        ...installments[installmentIndex].credigrupo,
        installmentId,
        externalStatus: 'paid',
        updatedAt: event.timestamp,
      },
    };
    transaction.update(loanRef, removeUndefined({
      ...loanUpdate,
      installments,
      hasFinancialHistory: true,
      lastOperationId: operationId,
      lastOperationType: 'CREDIGRUPO_PAYMENT',
      lastOperationAt: FieldValue.serverTimestamp(),
      lastOperationByUid: SYSTEM_UID,
      lastOperationByName: 'Credigrupo',
      updatedAt: FieldValue.serverTimestamp(),
    }));
    transaction.create(ledgerRef, {
      type: 'INSTALLMENT_PAID',
      provider: 'CREDIGRUPO',
      operationId: operationDocument.id,
      proposalId: operation.proposalId,
      loanId: operation.localLoanId,
      investorId: operation.investorId,
      fundingSource: operation.fundingSource,
      installmentId,
      amount: result.appliedAmount,
      occurredAt: event.timestamp,
      recordedAt: FieldValue.serverTimestamp(),
    });
    markEvent(transaction, eventRef, { status: 'PROCESSED', processedAt: FieldValue.serverTimestamp(), localLoanId: operation.localLoanId });
  });
};

const recordInvestorRepayment = async (
  operationDocument: FirebaseFirestore.QueryDocumentSnapshot,
  eventRef: FirebaseFirestore.DocumentReference,
  event: CredigrupoWebhookEvent,
) => {
  const operation = operationDocument.data() as StoredCredigrupoOperation;
  if (!operation.localLoanId) {
    return updateOperationState(operationDocument, eventRef, { pendingInvestorRepaymentEvent: event.data });
  }
  await adminDb.runTransaction(async (transaction) => {
    const loanRef = adminDb.doc(`loans/${operation.localLoanId}`);
    const installmentId = asText(event.data.installmentId);
    if (!installmentId) throw new Error('CREDIGRUPO_INSTALLMENT_ID_REQUIRED');
    const ledgerId = `credigrupo-repaid-${installmentId}`;
    const ledgerRef = adminDb.doc(`creditInvestorLedger/${ledgerId}`);
    const movementRef = adminDb.doc(`cashMovement/${ledgerId}`);
    const caixaRef = adminDb.doc('settings/caixa');
    const shouldUpdateCash = resolveBancarizedCashDelta(operation.fundingSource, 'INVESTOR_REPAID', 1) !== 0;
    const [loanSnapshot, ledgerSnapshot, movementSnapshot, caixaSnapshot] = await Promise.all([
      transaction.get(loanRef),
      transaction.get(ledgerRef),
      shouldUpdateCash ? transaction.get(movementRef) : Promise.resolve(null),
      shouldUpdateCash ? transaction.get(caixaRef) : Promise.resolve(null),
    ]);
    if (!loanSnapshot.exists) throw new Error('LOCAL_LOAN_NOT_FOUND');
    const loan = parseLoan(loanSnapshot.id, loanSnapshot.data());
    const installmentIndex = findInstallmentIndex(loan.installments, event.data);
    const amount = Number((asPositiveNumber(event.data.amountCents) / 100).toFixed(2));
    if (amount <= 0) throw new Error('CREDIGRUPO_REPAYMENT_AMOUNT_INVALID');
    const installments = [...loan.installments];
    if (installmentIndex >= 0) {
      installments[installmentIndex] = {
        ...installments[installmentIndex],
        credigrupo: {
          ...installments[installmentIndex].credigrupo,
          installmentId,
          investorPayoutStatus: 'completed',
          updatedAt: event.timestamp,
        },
      };
      transaction.update(loanRef, removeUndefined({ installments, updatedAt: FieldValue.serverTimestamp() }));
    }

    if (!ledgerSnapshot.exists) {
      transaction.create(ledgerRef, {
        type: 'INVESTOR_REPAID',
        provider: 'CREDIGRUPO',
        operationId: operationDocument.id,
        proposalId: operation.proposalId,
        loanId: operation.localLoanId,
        investorId: operation.investorId,
        fundingSource: operation.fundingSource,
        installmentId,
        amount,
        occurredAt: event.timestamp,
        recordedAt: FieldValue.serverTimestamp(),
      });

      const cashDelta = resolveBancarizedCashDelta(operation.fundingSource, 'INVESTOR_REPAID', amount);
      if (cashDelta !== 0) {
        if (movementSnapshot && caixaSnapshot && !movementSnapshot.exists) {
          const currentCash = Number(caixaSnapshot.data()?.value || 0);
          transaction.create(movementRef, {
            type: 'PAGAMENTO',
            amount,
            description: `REPASSE CREDIGRUPO: ${operation.customerName}`,
            date: event.timestamp,
            loanId: operation.localLoanId,
            operationId: ledgerId,
            createdByUid: SYSTEM_UID,
            createdByName: 'Credigrupo',
            recordedAt: FieldValue.serverTimestamp(),
          });
          transaction.set(caixaRef, {
            value: Number((currentCash + cashDelta).toFixed(2)),
            lastMovementId: ledgerId,
            updatedByUid: SYSTEM_UID,
            updatedAt: FieldValue.serverTimestamp(),
          }, { merge: true });
        }
      }
    }
    markEvent(transaction, eventRef, { status: 'PROCESSED', processedAt: FieldValue.serverTimestamp() });
  });
};

const processKycEvent = async (eventRef: FirebaseFirestore.DocumentReference, event: CredigrupoWebhookEvent) => {
  const userId = asText(event.data.userId);
  const status = event.event === 'kyc.approved' ? 'approved' : 'rejected';
  const [borrowers, investors] = await Promise.all([
    adminDb.collection('creditBorrowers').where('borrowerId', '==', userId).get(),
    adminDb.collection('creditInvestors').where('externalId', '==', userId).get(),
  ]);
  await adminDb.runTransaction(async (transaction) => {
    borrowers.docs.forEach((document) => {
      transaction.set(document.ref, { kycStatus: status, kycReason: event.data.reason || null, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      const customerId = asText(document.data().customerId);
      if (customerId) {
        transaction.set(adminDb.doc(`clientes/${customerId}`), {
          credigrupo: {
            borrowerId: userId,
            investorId: document.data().investorId,
            kycStatus: status,
            updatedAt: FieldValue.serverTimestamp(),
          },
        }, { merge: true });
      }
    });
    investors.docs.forEach((document) => {
      transaction.set(document.ref, { kycStatus: status, kycReason: event.data.reason || null, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    });
    markEvent(transaction, eventRef, { status: 'PROCESSED', processedAt: FieldValue.serverTimestamp() });
  });
};

export const processCredigrupoEvent = async (
  eventRef: FirebaseFirestore.DocumentReference,
  event: CredigrupoWebhookEvent,
) => {
  if (event.event === 'kyc.approved' || event.event === 'kyc.rejected') {
    await processKycEvent(eventRef, event);
    return;
  }

  const proposalId = asText(event.data.proposalId);
  if (!proposalId) {
    await eventRef.set({ status: 'IGNORED', reason: 'MISSING_PROPOSAL_ID', updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    return;
  }
  const operation = await findOperationByProposalId(proposalId);
  if (!operation) {
    await eventRef.set({ status: 'PENDING_RECONCILIATION', reason: 'OPERATION_NOT_FOUND', proposalId, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    return;
  }

  switch (event.event) {
    case 'ccb_ready_for_signature':
      await updateOperationState(operation, eventRef, {
        status: 'AWAITING_SIGNATURES',
        externalStatus: 'ccb_uploaded',
        borrowerSignUrl: safeUrl(event.data.borrowerSignUrl, allowedSignatureHosts),
        investorSignUrl: safeUrl(event.data.investorSignUrl, allowedSignatureHosts),
      });
      return;
    case 'loan.signed':
      await updateOperationState(operation, eventRef, {
        status: 'SIGNED',
        externalStatus: 'completed',
        signedAt: asText(event.data.signedAt) || event.timestamp,
      });
      return;
    case 'loan.funded':
      await activateFundedLoan(operation, eventRef, event);
      return;
    case 'installment.pix_created':
      await updateInstallmentPix(operation, eventRef, event);
      return;
    case 'installment.paid':
      await applyInstallmentPayment(operation, eventRef, event);
      return;
    case 'installment.investor_repaid':
      await recordInvestorRepayment(operation, eventRef, event);
      return;
    case 'loan.cancelled':
      await updateOperationState(operation, eventRef, {
        status: 'CANCELLED',
        externalStatus: 'cancelled',
        cancelledAt: asText(event.data.cancelledAt) || event.timestamp,
      });
      return;
    default:
      await eventRef.set({ status: 'IGNORED', reason: 'UNSUPPORTED_EVENT', updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  }
};

export const updateOperationFromRemoteLoan = async (
  operationId: string,
  details: {
    status: string;
    formalizationStatus: string;
    ccbNumber?: string | null;
    ccbUrl?: string | null;
    borrowerSignUrl?: string | null;
    investorSignUrl?: string | null;
  },
) => {
  const operationRef = adminDb.doc(`creditOperations/${operationId}`);
  const operationSnapshot = await operationRef.get();
  const operation = operationSnapshot.data() as StoredCredigrupoOperation | undefined;
  const safeFields = removeUndefined({
    externalStatus: details.formalizationStatus || details.status,
    ccbNumber: details.ccbNumber || undefined,
    ccbUrl: safeUrl(details.ccbUrl, allowedDocumentHosts),
    borrowerSignUrl: safeUrl(details.borrowerSignUrl, allowedSignatureHosts),
    investorSignUrl: safeUrl(details.investorSignUrl, allowedSignatureHosts),
    updatedAt: FieldValue.serverTimestamp(),
  });
  const batch = adminDb.batch();
  batch.set(operationRef, safeFields, { merge: true });
  if (operation?.localLoanId) {
    batch.set(adminDb.doc(`loans/${operation.localLoanId}`), {
      credigrupo: safeFields,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
  }
  await batch.commit();
};
