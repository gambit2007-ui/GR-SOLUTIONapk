import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createHash } from 'node:crypto';
import { FieldValue } from 'firebase-admin/firestore';
import type { LoanDraft } from '../../src/types.js';
import { requireAuthorizedActor } from './auth.js';
import { buildCreditRiskAudit, getCustomerCreditRisk, requireCreditRiskDecision, type CreditRiskDecisionInput } from './creditRisk.js';
import { adminDb } from './firebaseAdmin.js';
import { ApiError, handleApiError, parseJsonBody, sendJson } from './http.js';

interface CreateLoanInput {
  requestId: string;
  loan: LoanDraft;
  decision?: CreditRiskDecisionInput;
}

const requireDirectLoanDraft = (draft: LoanDraft): void => {
  if (!draft || typeof draft !== 'object' || typeof draft.customerId !== 'string' || !draft.customerId.trim()) {
    throw new ApiError(400, 'INVALID_LOAN', 'Cliente obrigatorio.');
  }
  if (!Number.isFinite(draft.amount) || Number(draft.amount.toFixed(2)) <= 0 || draft.amount >= 1_000_000_000) {
    throw new ApiError(400, 'INVALID_LOAN_AMOUNT', 'Valor do emprestimo invalido.');
  }
  const expectedTotal = Number(draft.totalToReturn);
  const installmentsCount = Number(draft.installmentsCount);
  if (!Array.isArray(draft.installments) ||
    !Number.isFinite(draft.interestRate) || draft.interestRate < 0 ||
    !Number.isFinite(expectedTotal) || expectedTotal <= 0 ||
    !Number.isSafeInteger(installmentsCount) || installmentsCount < 1 ||
    installmentsCount !== draft.installments.length) {
    throw new ApiError(400, 'INVALID_LOAN_TERMS', 'Condicoes do emprestimo invalidas.');
  }
  if (!Array.isArray(draft.installments) || draft.installments.length < 1 || draft.installments.length > 1000 ||
    draft.installments.some((item) => !Number.isFinite(Number(item.amount ?? item.value)) ||
      Number(item.amount ?? item.value) <= 0 ||
      !/^\d{4}-\d{2}-\d{2}$/.test(String(item.dueDate || '')) ||
      Number(item.paidAmount || item.partialPaid || 0) > 0 ||
      Boolean(item.paymentBreakdown) || Boolean(item.paymentEntries?.length))) {
    throw new ApiError(400, 'INVALID_INSTALLMENTS', 'Parcelas do novo contrato invalidas.');
  }
  if (draft.formalizationType === 'BANCARIZED' || draft.provider === 'CREDIGRUPO') {
    throw new ApiError(400, 'INVALID_LOAN_TYPE', 'Contrato bancarizado usa o fluxo da Credigrupo.');
  }
};

export default async function handler(request: VercelRequest, response: VercelResponse) {
  try {
    const actor = await requireAuthorizedActor(request);

    if (request.method === 'GET') {
      const customerId = String(request.query.customerId || '').trim();
      if (!customerId || customerId.includes('/')) throw new ApiError(400, 'CUSTOMER_REQUIRED', 'Selecione um cliente.');
      const customer = await adminDb.doc(`clientes/${customerId}`).get();
      if (!customer.exists) throw new ApiError(404, 'CUSTOMER_NOT_FOUND', 'Cliente nao encontrado.');
      return sendJson(response, 200, { risk: await getCustomerCreditRisk(customerId) });
    }

    if (request.method !== 'POST') return sendJson(response, 405, { error: 'METHOD_NOT_ALLOWED' });
    const input = parseJsonBody<CreateLoanInput>(request);
    const requestId = String(input.requestId || '').trim();
    if (!/^[a-zA-Z0-9_-]{8,120}$/.test(requestId)) {
      throw new ApiError(400, 'INVALID_REQUEST_ID', 'Identificador da operacao invalido.');
    }
    requireDirectLoanDraft(input.loan);
    const loanDraft = input.loan;
    const requestHash = createHash('sha256').update(JSON.stringify(loanDraft)).digest('hex');
    const customerId = loanDraft.customerId.trim();
    if (customerId.includes('/')) throw new ApiError(400, 'INVALID_CUSTOMER_ID', 'Cliente invalido.');

    const auditRef = adminDb.doc(`creditRiskDecisions/${requestId}`);
    const loanRef = adminDb.collection('loans').doc();
    const cashRef = adminDb.doc('settings/caixa');
    const counterRef = adminDb.doc('settings/contractCounter');
    const customerRef = adminDb.doc(`clientes/${customerId}`);

    const created = await adminDb.runTransaction(async (transaction) => {
      const [existingAudit, customer, cash, counter, risk] = await Promise.all([
        transaction.get(auditRef),
        transaction.get(customerRef),
        transaction.get(cashRef),
        transaction.get(counterRef),
        getCustomerCreditRisk(customerId, transaction),
      ]);
      if (existingAudit.exists) {
        if (existingAudit.data()?.customerId !== customerId || existingAudit.data()?.actorUid !== actor.uid ||
          existingAudit.data()?.operation !== 'DIRECT_LOAN' || existingAudit.data()?.requestHash !== requestHash) {
          throw new ApiError(409, 'REQUEST_ID_CONFLICT', 'Operacao ja usada em outro contrato.');
        }
        return { id: String(existingAudit.data()?.loanId || ''), contractNumber: String(existingAudit.data()?.contractNumber || '') };
      }
      if (!customer.exists) throw new ApiError(404, 'CUSTOMER_NOT_FOUND', 'Cliente nao encontrado.');
      if (customer.data()?.archived === true || customer.data()?.archivedAt) {
        throw new ApiError(409, 'CUSTOMER_ARCHIVED', 'Cliente arquivado.');
      }
      requireCreditRiskDecision(risk, input.decision, actor);

      const contractNumber = Math.max(
        Math.trunc(Number(counter.data()?.lastNumber || 0)) + 1,
        Math.trunc(Number(loanDraft.contractNumber || 0)),
        2026001,
      );
      const amount = Number(loanDraft.amount.toFixed(2));
      const currentCash = Number(cash.data()?.value || 0);
      const movementId = `loan-created-${loanRef.id}`;
      const timestamp = FieldValue.serverTimestamp();
      transaction.create(adminDb.doc(`cashMovement/${movementId}`), {
        id: movementId,
        type: 'RETIRADA', amount, value: amount,
        description: `EMPRESTIMO: ${String(customer.data()?.name || loanDraft.customerName).toUpperCase()}`,
        date: new Date().toISOString(), recordedAt: timestamp,
        loanId: loanRef.id, operationId: movementId,
        createdByUid: actor.uid, createdByEmail: actor.email || null, createdByName: actor.name || null,
      });
      transaction.create(loanRef, {
        customerId,
        customerName: String(customer.data()?.name || loanDraft.customerName),
        customerPhone: loanDraft.customerPhone || '',
        amount,
        interestRate: Number(loanDraft.interestRate),
        interestType: loanDraft.interestType,
        monthlyPaidInterestRate: loanDraft.monthlyPaidInterestRate ?? null,
        monthlyAccruedInterestRate: loanDraft.monthlyAccruedInterestRate ?? null,
        frequency: loanDraft.frequency,
        installmentCount: loanDraft.installmentCount,
        installmentsCount: loanDraft.installmentsCount,
        totalToReturn: loanDraft.totalToReturn,
        installmentValue: loanDraft.installmentValue,
        startDate: loanDraft.startDate,
        dueDate: loanDraft.dueDate || null,
        status: 'ATIVO', paidAmount: 0, maxHistoricalOverdueDays: 0, notes: loanDraft.notes || '',
        installments: loanDraft.installments,
        formalizationType: 'DIRECT', provider: 'GR', fundingSource: 'GR',
        investorInternalId: 'GR-SOLUTION',
        funding: { source: 'GR', investorId: 'GR-SOLUTION', investorName: 'GR Solutions' },
        contractNumber: String(contractNumber), version: 0, hasFinancialHistory: false,
        createdAt: timestamp,
        lastOperationId: movementId, lastOperationType: 'LOAN_CREATED',
        lastOperationAt: timestamp, lastOperationByUid: actor.uid,
        lastOperationByEmail: actor.email || null, lastOperationByName: actor.name || null,
      });
      transaction.set(cashRef, {
        value: Number((currentCash - amount).toFixed(2)),
        lastMovementId: movementId, updatedByUid: actor.uid, updatedAt: timestamp,
      }, { merge: true });
      transaction.set(counterRef, {
        lastNumber: contractNumber, lastContractNumber: String(contractNumber),
        lastLoanId: loanRef.id, updatedByUid: actor.uid, updatedAt: timestamp,
      }, { merge: true });
      transaction.create(auditRef, {
        ...buildCreditRiskAudit(risk, input.decision, actor, 'DIRECT_LOAN', loanRef.id),
        customerName: String(customer.data()?.name || loanDraft.customerName),
        contractNumber: String(contractNumber), requestHash, status: 'CONTRACT_CREATED', createdAt: timestamp,
      });
      return { id: loanRef.id, contractNumber: String(contractNumber) };
    });
    return sendJson(response, 201, created);
  } catch (error) {
    return handleApiError(response, error);
  }
}
