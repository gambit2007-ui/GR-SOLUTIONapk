import {
  collection,
  doc,
  runTransaction,
  serverTimestamp,
} from 'firebase/firestore';
import { db } from '../firebase';
import { Installment, Loan, LoanDraft, LoanType, MovementType } from '../types';
import type { LoanPaymentRequest, LoanPaymentResult } from '../types';
import { appendCashMovementInTransaction, MovementActor, readCashBalanceInTransaction } from './cashService';
import { deleteLoansAndLinkedMovements } from './loanCleanup';
import { sanitizeFirestorePayload } from '../utils/firestoreSanitizer';
import { parseLoan, parseMovementType } from '../utils/domainParsers';
import { applyLoanPaymentToCurrentLoan } from '../utils/financialEngine';
import { parseFeeSettings } from './settingsService';

export interface LoanMovementPayload {
  type: MovementType;
  amount: number;
  description: string;
  actor?: MovementActor;
  operationId?: string;
  expectedVersion?: number;
}

const round2 = (value: number): number => Number((Number.isFinite(value) ? value : 0).toFixed(2));

const toLoanType = (value: unknown): LoanType => {
  const normalized = String(value ?? '').trim().toUpperCase();
  return normalized === 'PRICE' ? 'PRICE' : 'SIMPLE';
};

const toInstallmentAmount = (installment: Installment, fallback = 0): number => {
  const value = Number(installment.amount ?? installment.value ?? fallback);
  return Number.isFinite(value) ? round2(value) : round2(fallback);
};

const calculatePricePayment = (principal: number, rate: number, installments: number): number => {
  if (installments <= 0) return 0;
  if (rate <= 0) return round2(principal / installments);
  const factor = Math.pow(1 + rate, installments);
  if (!Number.isFinite(factor) || factor <= 1) return round2(principal / installments);
  return round2(principal * ((rate * factor) / (factor - 1)));
};

const enrichPriceInstallments = (loanDraft: LoanDraft): LoanDraft => {
  if (toLoanType(loanDraft.interestType) !== 'PRICE') {
    return loanDraft;
  }

  const installments = Array.isArray(loanDraft.installments)
    ? loanDraft.installments.map((installment) => ({ ...installment }))
    : [];
  if (installments.length === 0) {
    return loanDraft;
  }

  const principalTotal = Math.max(round2(Number(loanDraft.amount || 0)), 0);
  if (principalTotal <= 0) {
    return loanDraft;
  }

  const rate = Math.max(Number(loanDraft.interestRate || 0) / 100, 0);
  const fallbackInstallmentAmount = calculatePricePayment(principalTotal, rate, installments.length);

  let saldoPrincipal = principalTotal;
  const lastIndex = installments.length - 1;

  const enrichedInstallments = installments.map((installment, index) => {
    const baseAmount = toInstallmentAmount(installment, fallbackInstallmentAmount);
    const hasExpectedValues =
      Number.isFinite(Number(installment.expectedPrincipal)) &&
      Number.isFinite(Number(installment.expectedInterest));

    if (hasExpectedValues) {
      const expectedPrincipal = Math.max(round2(Number(installment.expectedPrincipal || 0)), 0);
      const expectedInterest = Math.max(round2(Number(installment.expectedInterest || 0)), 0);
      saldoPrincipal = Math.max(round2(saldoPrincipal - expectedPrincipal), 0);
      return {
        ...installment,
        expectedPrincipal,
        expectedInterest,
      };
    }

    let expectedInterest = rate > 0 ? round2(saldoPrincipal * rate) : 0;
    let expectedPrincipal = round2(baseAmount - expectedInterest);

    if (index === lastIndex) {
      expectedPrincipal = round2(saldoPrincipal);
      expectedInterest = round2(Math.max(baseAmount - expectedPrincipal, 0));
    } else {
      expectedPrincipal = round2(Math.max(expectedPrincipal, 0));
      if (expectedPrincipal > saldoPrincipal) {
        expectedPrincipal = round2(saldoPrincipal);
        expectedInterest = round2(Math.max(baseAmount - expectedPrincipal, 0));
      }
    }

    saldoPrincipal = Math.max(round2(saldoPrincipal - expectedPrincipal), 0);

    return {
      ...installment,
      expectedPrincipal,
      expectedInterest,
    };
  });

  return {
    ...loanDraft,
    installments: enrichedInstallments,
  };
};

export const createLoan = async (loanDraft: LoanDraft, actor?: MovementActor): Promise<string> => {
  const normalizedLoanDraft = enrichPriceInstallments(loanDraft);
  const safeLoanData = sanitizeFirestorePayload(normalizedLoanDraft);
  const amount = Number(normalizedLoanDraft.amount || 0);

  const createdLoanId = await runTransaction(db, async (tx) => {
    const loanRef = doc(collection(db, 'loans'));
    const contractCounterRef = doc(db, 'settings', 'contractCounter');
    const counterSnapshot = await tx.get(contractCounterRef);
    const saldoAtual = await readCashBalanceInTransaction(tx);
    const requestedNumber = Math.trunc(Number(normalizedLoanDraft.contractNumber || 0));
    const lastNumber = counterSnapshot.exists()
      ? Math.trunc(Number(counterSnapshot.data().lastNumber || 0))
      : 0;
    const contractNumber = Math.max(lastNumber + 1, requestedNumber, 2026001);

    await appendCashMovementInTransaction(tx, {
      type: 'RETIRADA',
      amount,
      description: `EMPRESTIMO: ${normalizedLoanDraft.customerName}`,
      loanId: loanRef.id,
      actor,
    }, { currentCashBalance: saldoAtual });

    tx.set(loanRef, {
      ...safeLoanData,
      contractNumber: String(contractNumber),
      version: 0,
      createdAt: serverTimestamp(),
    });
    tx.set(contractCounterRef, {
      lastNumber: contractNumber,
      updatedAt: serverTimestamp(),
    }, { merge: true });

    return loanRef.id;
  });

  return createdLoanId;
};

export const updateLoan = async (loanId: string, payload: Partial<Loan>) => {
  await runTransaction(db, async (tx) => {
    const loanRef = doc(db, 'loans', loanId);
    const currentSnapshot = await tx.get(loanRef);
    if (!currentSnapshot.exists()) throw new Error('CONTRATO_NAO_ENCONTRADO');
    const currentAmount = round2(Number(currentSnapshot.data().amount || 0));
    if (payload.amount !== undefined && round2(Number(payload.amount || 0)) !== currentAmount) {
      throw new Error('VALOR_PRINCIPAL_IMUTAVEL');
    }
    const currentVersion = Math.max(0, Math.trunc(Number(currentSnapshot.data().version || 0)));
    tx.update(loanRef, sanitizeFirestorePayload({
      ...payload,
      amount: currentAmount,
      version: currentVersion + 1,
      updatedAt: serverTimestamp(),
    }));
  });
};

export const updateLoanAndAddMovement = async (
  loanId: string,
  payload: Partial<Loan>,
  movement: LoanMovementPayload,
) => {
  const movementType = parseMovementType(movement.type);
  const operationId = movement.operationId ? normalizeOperationId(movement.operationId) : undefined;

  await runTransaction(db, async (tx) => {
    const loanRef = doc(db, 'loans', loanId);
    const movementRef = operationId ? doc(db, 'cashMovement', operationId) : null;
    if (movementRef) {
      const existingMovement = await tx.get(movementRef);
      if (existingMovement.exists()) {
        if (String(existingMovement.data().loanId || '') !== loanId) throw new Error('OPERACAO_ID_CONFLITANTE');
        return;
      }
    }
    const loanSnap = await tx.get(loanRef);
    if (!loanSnap.exists()) throw new Error('CONTRATO_NAO_ENCONTRADO');
    const currentVersion = Math.max(0, Math.trunc(Number(loanSnap.data().version || 0)));
    if (
      Number.isInteger(movement.expectedVersion) &&
      Number(movement.expectedVersion) !== currentVersion
    ) {
      throw new Error('CONTRATO_ATUALIZADO_POR_OUTRA_OPERACAO');
    }
    const saldoAtual = await readCashBalanceInTransaction(tx);

    await appendCashMovementInTransaction(tx, {
      type: movementType,
      amount: movement.amount,
      description: movement.description,
      loanId,
      operationId,
      actor: movement.actor,
    }, { currentCashBalance: saldoAtual, movementId: operationId });

    tx.update(loanRef, sanitizeFirestorePayload({
      ...payload,
      version: currentVersion + 1,
      updatedAt: serverTimestamp(),
    }));
  });
};

const normalizeOperationId = (value: string): string => {
  const operationId = String(value || '').trim();
  if (!/^[A-Za-z0-9_-]{8,120}$/.test(operationId)) {
    throw new Error('OPERACAO_INVALIDA');
  }
  return operationId;
};

export const applyLoanPayment = async (
  loanId: string,
  request: LoanPaymentRequest,
  actor?: MovementActor,
): Promise<LoanPaymentResult> => {
  const operationId = normalizeOperationId(request.operationId);

  return runTransaction(db, async (tx) => {
    const loanRef = doc(db, 'loans', loanId);
    const movementRef = doc(db, 'cashMovement', operationId);
    const feeSettingsRef = doc(db, 'settings', 'fees');
    const existingMovement = await tx.get(movementRef);

    if (existingMovement.exists()) {
      const existing = existingMovement.data();
      if (String(existing.loanId || '') !== loanId || String(existing.operationId || '') !== operationId) {
        throw new Error('OPERACAO_ID_CONFLITANTE');
      }
      return {
        operationId,
        appliedAmount: round2(Number(existing.amount || existing.value || 0)),
        unappliedAmount: 0,
        discountApplied: round2(Number(existing.discountApplied || 0)),
        duplicate: true,
      };
    }

    const loanSnap = await tx.get(loanRef);
    if (!loanSnap.exists()) throw new Error('CONTRATO_NAO_ENCONTRADO');
    const feeSettingsSnap = await tx.get(feeSettingsRef);
    const saldoAtual = await readCashBalanceInTransaction(tx);
    const currentLoan = parseLoan(loanSnap.id, loanSnap.data());
    const feeSettings = feeSettingsSnap.exists() ? parseFeeSettings(feeSettingsSnap.data()) : parseFeeSettings({});
    const processedAt = new Date().toISOString();
    const output = applyLoanPaymentToCurrentLoan(currentLoan, {
      ...request,
      operationId,
      processedAt,
    }, feeSettings.dailyLateFeeRate);
    const paymentLabel = request.applyMode === 'EARLY_SETTLEMENT'
      ? `QUITACAO ANTECIPADA: ${currentLoan.customerName}`
      : request.applyMode === 'TOTAL_BALANCE'
        ? `PAGAMENTO (ABATIMENTO SALDO): ${currentLoan.customerName}`
        : request.applyMode === 'REDISTRIBUTE_BALANCE'
          ? `PAGAMENTO (ABATE + REDIVISAO): ${currentLoan.customerName}`
          : `PAGAMENTO (ABATIMENTO PARCELAS): ${currentLoan.customerName}`;

    await appendCashMovementInTransaction(tx, {
      type: 'PAGAMENTO',
      amount: output.appliedAmount,
      description: paymentLabel,
      loanId,
      operationId,
      actor,
    }, { currentCashBalance: saldoAtual, movementId: operationId });

    tx.update(loanRef, sanitizeFirestorePayload({
      installments: output.loan.installments,
      installmentsCount: output.loan.installmentsCount,
      installmentCount: output.loan.installmentCount,
      totalToReturn: output.loan.totalToReturn,
      status: output.loan.status,
      fiscalPaymentEntries: output.loan.fiscalPaymentEntries,
      version: output.loan.version,
      updatedAt: serverTimestamp(),
    }));

    return {
      operationId,
      appliedAmount: output.appliedAmount,
      unappliedAmount: output.unappliedAmount,
      discountApplied: output.discountApplied,
      duplicate: false,
    };
  });
};

export const deleteLoan = async (loanId: string) => {
  await deleteLoansAndLinkedMovements([loanId]);
};
