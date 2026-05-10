import type { Installment, Loan } from '../types';
import { buildPaymentBreakdown, round2 } from './paymentBreakdown';
import { installmentAmount, normalizeInstallmentStatus } from './loanCompat';

const DAY_IN_MS = 24 * 60 * 60 * 1000;

const toDateOnly = (value: string): Date | null => {
  const parsed = new Date(`${value}T12:00:00`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const toIsoDate = (value: Date): string => value.toISOString().split('T')[0];

const toLoanType = (interestType: unknown): 'SIMPLE' | 'PRICE' => {
  const normalized = String(interestType ?? '').trim().toUpperCase();
  return normalized === 'PRICE' ? 'PRICE' : 'SIMPLE';
};

const hasPositiveNumber = (value: unknown): boolean => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0;
};

const resolveTotalReceivable = (loan: Loan): number => {
  const installmentsTotal = (Array.isArray(loan.installments) ? loan.installments : []).reduce(
    (sum, installment) => sum + installmentAmount(installment),
    0,
  );
  if (installmentsTotal > 0) return round2(installmentsTotal);

  const totalToReturn = Number(loan.totalToReturn || 0);
  if (Number.isFinite(totalToReturn) && totalToReturn > 0) return round2(totalToReturn);

  return round2(Number(loan.amount || 0));
};

export const getPendingInstallments = (loan: Loan): Installment[] =>
  (Array.isArray(loan.installments) ? loan.installments : []).filter(
    (installment) => normalizeInstallmentStatus(installment?.status) !== 'PAID',
  );

export const getCurrentContractDueDate = (loan: Loan): string | undefined => {
  const firstPendingWithDueDate = getPendingInstallments(loan).find((installment) => toDateOnly(installment.dueDate));
  if (firstPendingWithDueDate?.dueDate) return firstPendingWithDueDate.dueDate;
  return loan.dueDate;
};

const calculateSplitLoanRenewalInterest = (loan: Loan): number => {
  const principal = round2(Number(loan.amount || 0));
  if (principal <= 0) return 0;

  const paidRate = Number(loan.monthlyPaidInterestRate || 0);
  if (Number.isFinite(paidRate) && paidRate > 0) {
    return round2(principal * (paidRate / 100));
  }

  const genericRate = Number(loan.interestRate || 0);
  if (Number.isFinite(genericRate) && genericRate > 0) {
    return round2(principal * (genericRate / 100));
  }

  return 0;
};

export const calculateInterestOnlyRenewalAmount = (loan: Loan): number => {
  const principal = round2(Number(loan.amount || 0));
  if (principal <= 0) return 0;

  const normalizedInterestType = String(loan.interestType || '').trim().toUpperCase();
  if (normalizedInterestType === 'SPLIT') {
    // Contrato SPLIT ja separa juros periodicos; usamos essa taxa explicitamente.
    return calculateSplitLoanRenewalInterest(loan);
  }

  const pendingInstallment = getPendingInstallments(loan)[0];
  if (!pendingInstallment) return 0;

  const installmentValue = round2(installmentAmount(pendingInstallment));
  if (installmentValue <= 0) return 0;

  const breakdown = buildPaymentBreakdown({
    loan: {
      id: loan.id,
      type: toLoanType(loan.interestType),
      totalAmount: principal,
      totalReceivable: resolveTotalReceivable(loan),
    },
    installment: {
      id: pendingInstallment.id,
      amount: installmentValue,
      expectedPrincipal: pendingInstallment.expectedPrincipal,
      expectedInterest: pendingInstallment.expectedInterest,
    },
    paidAmount: installmentValue,
  });

  if (hasPositiveNumber(breakdown.interestPaid)) {
    return round2(Number(breakdown.interestPaid));
  }

  if (hasPositiveNumber(pendingInstallment.expectedInterest)) {
    return round2(Number(pendingInstallment.expectedInterest));
  }

  return 0;
};

export interface RenewalDueDateShiftResult {
  previousDueDate: string;
  newDueDate: string;
  dayOffset: number;
  installments: Installment[];
  contractDueDate?: string;
}

export const shiftPendingInstallmentsToNewDueDate = (
  loan: Loan,
  newDueDate: string,
): RenewalDueDateShiftResult | null => {
  const installments = Array.isArray(loan.installments) ? loan.installments : [];
  if (installments.length === 0) return null;

  const pendingIndexes = installments.reduce<number[]>((acc, installment, index) => {
    if (normalizeInstallmentStatus(installment?.status) !== 'PAID') {
      acc.push(index);
    }
    return acc;
  }, []);
  if (pendingIndexes.length === 0) return null;

  const firstPending = installments[pendingIndexes[0]];
  if (!firstPending?.dueDate) return null;

  const previousDueDateParsed = toDateOnly(firstPending.dueDate);
  const newDueDateParsed = toDateOnly(newDueDate);
  if (!previousDueDateParsed || !newDueDateParsed) return null;

  const rawOffset = (newDueDateParsed.getTime() - previousDueDateParsed.getTime()) / DAY_IN_MS;
  const dayOffset = Math.round(rawOffset);
  if (!Number.isFinite(dayOffset) || dayOffset <= 0) return null;

  // Regra conservadora: mover somente parcelas pendentes pelo mesmo delta de dias.
  const updatedInstallments = installments.map((installment, index) => {
    if (!pendingIndexes.includes(index)) return { ...installment };
    const originalDueDate = toDateOnly(installment.dueDate);
    if (!originalDueDate) return { ...installment };

    const shifted = new Date(originalDueDate);
    shifted.setDate(shifted.getDate() + dayOffset);

    return {
      ...installment,
      dueDate: toIsoDate(shifted),
    };
  });

  const maxDueDate = updatedInstallments
    .map((installment) => toDateOnly(installment.dueDate))
    .filter((value): value is Date => Boolean(value))
    .sort((a, b) => b.getTime() - a.getTime())[0];

  return {
    previousDueDate: firstPending.dueDate,
    newDueDate,
    dayOffset,
    installments: updatedInstallments,
    contractDueDate: maxDueDate ? toIsoDate(maxDueDate) : loan.dueDate,
  };
};
