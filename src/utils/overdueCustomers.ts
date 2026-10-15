import type { Loan } from '../types';
import { getLocalISODate } from './dateTime';
import { getInstallmentOutstanding, roundMoney } from './financialEngine';
import { effectiveLoanStatus, normalizeInstallmentStatus } from './loanCompat';

export interface OverdueCustomerCard {
  customerId: string;
  customerName: string;
  loanIds: string[];
  navigationLoanId: string;
  overdueContractCount: number;
  overdueInstallmentCount: number;
  maxOverdueDays: number;
  overdueAmount: number;
}

const calculateOverdueDays = (dueDate: string, referenceDate: Date): number => {
  const due = new Date(`${dueDate}T12:00:00`);
  const reference = new Date(referenceDate);
  reference.setHours(12, 0, 0, 0);
  if (Number.isNaN(due.getTime()) || due >= reference) return 0;
  return Math.floor((reference.getTime() - due.getTime()) / 86_400_000);
};

export const buildOverdueCustomerCards = (
  loans: Loan[],
  referenceDate = new Date(),
  dailyLateFeeRate?: number,
): OverdueCustomerCard[] => {
  const today = getLocalISODate(referenceDate);
  const groups = new Map<string, OverdueCustomerCard & { navigationAmount: number }>();

  loans.forEach((loan) => {
    if (effectiveLoanStatus(loan) !== 'ACTIVE') return;
    const overdueInstallments = loan.installments.flatMap((installment) => {
      if (normalizeInstallmentStatus(installment.status) === 'PAID' || installment.dueDate >= today) return [];
      const amount = getInstallmentOutstanding(installment, referenceDate, dailyLateFeeRate).total;
      if (amount <= 0) return [];
      return [{ amount, days: calculateOverdueDays(installment.dueDate, referenceDate) }];
    });
    if (overdueInstallments.length === 0) return;

    const loanAmount = roundMoney(overdueInstallments.reduce((sum, item) => sum + item.amount, 0));
    const loanDays = Math.max(...overdueInstallments.map((item) => item.days));
    const key = loan.customerId || `loan:${loan.id}`;
    const existing = groups.get(key) || {
      customerId: loan.customerId,
      customerName: loan.customerName,
      loanIds: [],
      navigationLoanId: loan.id,
      navigationAmount: 0,
      overdueContractCount: 0,
      overdueInstallmentCount: 0,
      maxOverdueDays: 0,
      overdueAmount: 0,
    };
    if (loanDays > existing.maxOverdueDays ||
      (loanDays === existing.maxOverdueDays && loanAmount > existing.navigationAmount) ||
      (loanDays === existing.maxOverdueDays && loanAmount === existing.navigationAmount && loan.id < existing.navigationLoanId)) {
      existing.navigationLoanId = loan.id;
      existing.navigationAmount = loanAmount;
    }
    existing.loanIds.push(loan.id);
    existing.overdueContractCount += 1;
    existing.overdueInstallmentCount += overdueInstallments.length;
    existing.maxOverdueDays = Math.max(existing.maxOverdueDays, loanDays);
    existing.overdueAmount = roundMoney(existing.overdueAmount + loanAmount);
    groups.set(key, existing);
  });

  return [...groups.values()].map(({ navigationAmount: _navigationAmount, ...card }) => ({
    ...card, loanIds: [...card.loanIds].sort(),
  })).sort((left, right) =>
    right.maxOverdueDays - left.maxOverdueDays ||
    right.overdueAmount - left.overdueAmount ||
    left.customerName.localeCompare(right.customerName, 'pt-BR', { sensitivity: 'base' }) ||
    left.customerId.localeCompare(right.customerId) ||
    left.navigationLoanId.localeCompare(right.navigationLoanId),
  );
};
