import type { VercelRequest, VercelResponse } from '@vercel/node';
import { FieldValue } from 'firebase-admin/firestore';
import type { Installment, LoanDraft } from '../src/types.js';
import { requireAuthorizedActor } from './_lib/auth.js';
import { adminDb } from './_lib/firebaseAdmin.js';
import { ApiError, handleApiError, parseJsonBody, sendJson } from './_lib/http.js';

interface CreateDirectLoanRequest {
  loan?: LoanDraft;
}

const DOCUMENT_ID = /^[A-Za-z0-9_-]{1,128}$/;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const DIRECT_FREQUENCIES = new Set(['DIARIO', 'SEMANAL', 'QUINZENAL', 'MENSAL']);

const roundedMoney = (value: unknown): number => {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return Number.NaN;
  return Number(amount.toFixed(2));
};

export function requireDirectLoanDraft(draft: LoanDraft | undefined): asserts draft is LoanDraft {
  if (!draft || typeof draft !== 'object') {
    throw new ApiError(400, 'INVALID_LOAN', 'Dados do contrato obrigatorios.');
  }

  if (!DOCUMENT_ID.test(String(draft.customerId || ''))) {
    throw new ApiError(400, 'INVALID_CUSTOMER_ID', 'Cliente invalido.');
  }

  const amount = roundedMoney(draft.amount);
  const totalToReturn = roundedMoney(draft.totalToReturn);
  const installmentsCount = Math.trunc(Number(draft.installmentsCount));
  const installmentCount = Math.trunc(Number(draft.installmentCount));

  if (!(amount > 0 && amount < 1_000_000_000)) {
    throw new ApiError(400, 'INVALID_LOAN_AMOUNT', 'Valor do emprestimo invalido.');
  }
  if (!Number.isFinite(Number(draft.interestRate)) || Number(draft.interestRate) < 0) {
    throw new ApiError(400, 'INVALID_INTEREST_RATE', 'Taxa de juros invalida.');
  }
  if (!DIRECT_FREQUENCIES.has(String(draft.frequency || '').toUpperCase())) {
    throw new ApiError(400, 'INVALID_FREQUENCY', 'Frequencia do contrato invalida.');
  }
  if (!DATE_ONLY.test(String(draft.startDate || ''))) {
    throw new ApiError(400, 'INVALID_START_DATE', 'Data inicial invalida.');
  }
  if (!Array.isArray(draft.installments) ||
    draft.installments.length < 1 ||
    draft.installments.length > 1000 ||
    !Number.isSafeInteger(installmentsCount) ||
    installmentsCount !== draft.installments.length ||
    !Number.isSafeInteger(installmentCount) ||
    installmentCount !== installmentsCount) {
    throw new ApiError(400, 'INVALID_INSTALLMENTS', 'Parcelas do contrato invalidas.');
  }
  if (draft.installments.some((installment) => {
    const installmentAmount = roundedMoney(installment.amount ?? installment.value);
    return !(installmentAmount > 0) || !DATE_ONLY.test(String(installment.dueDate || ''));
  })) {
    throw new ApiError(400, 'INVALID_INSTALLMENTS', 'Parcelas do contrato invalidas.');
  }
  const installmentsTotal = roundedMoney(draft.installments.reduce(
    (sum, installment) => sum + roundedMoney(installment.amount ?? installment.value),
    0,
  ));
  if (!(totalToReturn >= amount) || Math.abs(installmentsTotal - totalToReturn) > 0.01) {
    throw new ApiError(400, 'INVALID_LOAN_TOTAL', 'Total do contrato invalido.');
  }
  if (draft.formalizationType === 'BANCARIZED' || draft.provider === 'CREDIGRUPO') {
    throw new ApiError(400, 'INVALID_LOAN_TYPE', 'Contrato bancarizado usa o fluxo da Credigrupo.');
  }
  if (String(draft.frequency).toUpperCase() === 'DIARIO' &&
    (!Array.isArray(draft.dailyChargeDays) || draft.dailyChargeDays.length === 0 ||
      draft.dailyChargeDays.some((day) => !Number.isInteger(day) || day < 0 || day > 6))) {
    throw new ApiError(400, 'INVALID_DAILY_CHARGE_DAYS', 'Selecione os dias de cobranca do contrato diario.');
  }
}

const buildInstallments = (installments: Installment[]): Installment[] => installments.map((installment, index) => ({
  ...installment,
  number: Math.trunc(Number(installment.number || index + 1)),
  amount: roundedMoney(installment.amount ?? installment.value),
  value: roundedMoney(installment.value ?? installment.amount),
  dueDate: String(installment.dueDate),
  status: 'PENDENTE',
  paidAmount: 0,
  partialPaid: 0,
}));

export default async function handler(request: VercelRequest, response: VercelResponse) {
  try {
    if (request.method !== 'POST') return sendJson(response, 405, { error: 'METHOD_NOT_ALLOWED' });

    const actor = await requireAuthorizedActor(request);
    const input = parseJsonBody<CreateDirectLoanRequest>(request);
    requireDirectLoanDraft(input.loan);
    const draft = input.loan;
    const loanRef = adminDb.collection('loans').doc();
    const movementId = `loan-created-${loanRef.id}`;
    const cashRef = adminDb.doc('settings/caixa');
    const counterRef = adminDb.doc('settings/contractCounter');
    const customerRef = adminDb.doc(`clientes/${draft.customerId}`);

    const created = await adminDb.runTransaction(async (transaction) => {
      const [customerSnapshot, cashSnapshot, counterSnapshot] = await Promise.all([
        transaction.get(customerRef),
        transaction.get(cashRef),
        transaction.get(counterRef),
      ]);
      if (!customerSnapshot.exists) throw new ApiError(404, 'CUSTOMER_NOT_FOUND', 'Cliente nao encontrado.');
      if (customerSnapshot.data()?.archived === true || customerSnapshot.data()?.archivedAt) {
        throw new ApiError(409, 'CUSTOMER_ARCHIVED', 'Cliente arquivado.');
      }

      const customerName = String(customerSnapshot.data()?.name || '').trim();
      if (!customerName) throw new ApiError(409, 'CUSTOMER_INVALID', 'Cliente sem nome valido.');

      const requestedNumber = Math.trunc(Number(draft.contractNumber || 0));
      const storedCounter = Number(counterSnapshot.data()?.lastNumber || 0);
      if (!Number.isFinite(storedCounter)) {
        throw new ApiError(409, 'INVALID_CONTRACT_COUNTER', 'Contador de contratos precisa de revisao.');
      }
      const lastNumber = Math.trunc(storedCounter);
      const contractNumber = Math.max(lastNumber + 1, requestedNumber, 2026001);
      const amount = roundedMoney(draft.amount);
      const currentCash = roundedMoney(cashSnapshot.data()?.value ?? 0);
      if (!Number.isFinite(currentCash)) {
        throw new ApiError(409, 'INVALID_CASH_BALANCE', 'Saldo de caixa precisa de revisao.');
      }
      const timestamp = FieldValue.serverTimestamp();

      transaction.create(adminDb.doc(`cashMovement/${movementId}`), {
        id: movementId,
        type: 'RETIRADA',
        amount,
        value: amount,
        description: `EMPRESTIMO: ${customerName.toUpperCase()}`,
        date: new Date().toISOString(),
        recordedAt: timestamp,
        loanId: loanRef.id,
        operationId: movementId,
        createdByUid: actor.uid,
        createdByEmail: actor.email || null,
        createdByName: actor.name || null,
      });
      transaction.create(loanRef, {
        customerId: draft.customerId,
        customerName,
        customerPhone: String(draft.customerPhone || ''),
        amount,
        interestRate: Number(draft.interestRate),
        interestType: draft.interestType,
        ...(draft.monthlyPaidInterestRate !== undefined ? { monthlyPaidInterestRate: Number(draft.monthlyPaidInterestRate) } : {}),
        ...(draft.monthlyAccruedInterestRate !== undefined ? { monthlyAccruedInterestRate: Number(draft.monthlyAccruedInterestRate) } : {}),
        frequency: String(draft.frequency).toUpperCase(),
        ...(Array.isArray(draft.dailyChargeDays) ? { dailyChargeDays: draft.dailyChargeDays } : {}),
        installmentCount: Math.trunc(Number(draft.installmentCount)),
        installmentsCount: Math.trunc(Number(draft.installmentsCount)),
        totalToReturn: roundedMoney(draft.totalToReturn),
        installmentValue: roundedMoney(draft.installmentValue),
        startDate: String(draft.startDate),
        dueDate: String(draft.dueDate || draft.startDate),
        status: 'ATIVO',
        paidAmount: 0,
        notes: String(draft.notes || ''),
        installments: buildInstallments(draft.installments),
        formalizationType: 'DIRECT',
        provider: 'GR',
        fundingSource: 'GR',
        investorInternalId: 'GR-SOLUTION',
        funding: { source: 'GR', investorId: 'GR-SOLUTION', investorName: 'GR Solutions' },
        contractNumber: String(contractNumber),
        version: 0,
        hasFinancialHistory: false,
        createdAt: timestamp,
        lastOperationId: movementId,
        lastOperationType: 'LOAN_CREATED',
        lastOperationAt: timestamp,
        lastOperationByUid: actor.uid,
        lastOperationByEmail: actor.email || null,
        lastOperationByName: actor.name || null,
      });
      transaction.set(cashRef, {
        value: roundedMoney(currentCash - amount),
        lastMovementId: movementId,
        updatedByUid: actor.uid,
        updatedAt: timestamp,
      }, { merge: true });
      transaction.set(counterRef, {
        lastNumber: contractNumber,
        lastContractNumber: String(contractNumber),
        lastLoanId: loanRef.id,
        updatedByUid: actor.uid,
        updatedAt: timestamp,
      }, { merge: true });

      return { id: loanRef.id, contractNumber: String(contractNumber) };
    });

    return sendJson(response, 201, created);
  } catch (error) {
    return handleApiError(response, error);
  }
}
