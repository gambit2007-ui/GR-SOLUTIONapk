import type { Installment, Loan, PaymentBreakdown } from '../types';
import {
  effectiveLoanStatus,
  installmentAmount,
  installmentPaidAmount,
  normalizeInstallmentStatus,
} from './loanCompat';
import { calculateInstallmentLateFee } from './lateFee';

export interface CustomerFinancialSummary {
  totalBorrowed: number;
  totalReceived: number;
  realProfit: number;
  projectedProfit: number;
  openAmount: number;
  overdueAmount: number;
  totalContracts: number;
  completedContracts: number;
  activeContracts: number;
  overdueContracts: number;
}

const emptySummary: CustomerFinancialSummary = {
  totalBorrowed: 0,
  totalReceived: 0,
  realProfit: 0,
  projectedProfit: 0,
  openAmount: 0,
  overdueAmount: 0,
  totalContracts: 0,
  completedContracts: 0,
  activeContracts: 0,
  overdueContracts: 0,
};

const roundMoney = (value: number) => Number((Number.isFinite(value) ? value : 0).toFixed(2));

const getLoanExpectedTotal = (loan: Loan): number => {
  const installmentsTotal = (Array.isArray(loan.installments) ? loan.installments : []).reduce(
    (sum, installment) => sum + installmentAmount(installment),
    0,
  );
  if (installmentsTotal > 0) return roundMoney(installmentsTotal);

  const totalToReturn = Number(loan.totalToReturn || 0);
  if (Number.isFinite(totalToReturn) && totalToReturn > 0) return roundMoney(totalToReturn);

  const amount = Number(loan.amount || 0);
  const interestRate = Number(loan.interestRate || 0);
  return roundMoney(amount * (1 + interestRate / 100));
};

const normalizeBreakdown = (breakdown: Partial<PaymentBreakdown>): PaymentBreakdown => ({
  principalPaid: roundMoney(Number(breakdown.principalPaid || 0)),
  interestPaid: roundMoney(Number(breakdown.interestPaid || 0)),
  lateFeePaid: roundMoney(Number(breakdown.lateFeePaid || 0)),
  serviceFeePaid: roundMoney(Number(breakdown.serviceFeePaid || 0)),
  discountApplied: roundMoney(Number(breakdown.discountApplied || 0)),
  totalPaid: roundMoney(Number(breakdown.totalPaid || 0)),
});

const getInstallmentPaymentBreakdown = (installment: Installment): PaymentBreakdown => {
  const paymentEntries = Array.isArray(installment.paymentEntries) ? installment.paymentEntries : [];
  if (paymentEntries.length > 0) {
    return normalizeBreakdown(
      paymentEntries.reduce<PaymentBreakdown>(
        (acc, entry) => ({
          principalPaid: acc.principalPaid + Number(entry.principalPaid || 0),
          interestPaid: acc.interestPaid + Number(entry.interestPaid || 0),
          lateFeePaid: acc.lateFeePaid + Number(entry.lateFeePaid || 0),
          serviceFeePaid: acc.serviceFeePaid + Number(entry.serviceFeePaid || 0),
          discountApplied: acc.discountApplied + Number(entry.discountApplied || 0),
          totalPaid: acc.totalPaid + Number(entry.totalPaid || 0),
        }),
        {
          principalPaid: 0,
          interestPaid: 0,
          lateFeePaid: 0,
          serviceFeePaid: 0,
          discountApplied: 0,
          totalPaid: 0,
        },
      ),
    );
  }

  if (installment.paymentBreakdown) {
    return normalizeBreakdown(installment.paymentBreakdown);
  }

  return normalizeBreakdown({
    principalPaid: installmentPaidAmount(installment),
    totalPaid: installmentPaidAmount(installment),
  });
};

const isInstallmentOverdue = (installment: Installment, today: Date): boolean => {
  const status = normalizeInstallmentStatus(installment.status);
  if (status === 'PAID') return false;

  const dueDate = new Date(`${installment.dueDate}T00:00:00`);
  if (Number.isNaN(dueDate.getTime())) return status === 'OVERDUE';
  return dueDate < today;
};

const getRemainingInstallmentValue = (
  installment: Installment,
  today: Date,
  dailyLateFeeRate?: number,
): number => {
  if (normalizeInstallmentStatus(installment.status) === 'PAID') return 0;

  const lateFee = calculateInstallmentLateFee(installment, today, dailyLateFeeRate);
  const totalDue = roundMoney(installmentAmount(installment) + lateFee);
  const totalPaid = Math.max(roundMoney(getInstallmentPaymentBreakdown(installment).totalPaid), 0);
  return Math.max(roundMoney(totalDue - totalPaid), 0);
};

export const calculateCustomerFinancialSummary = (
  customerId: string,
  loans: Loan[],
  dailyLateFeeRate?: number,
): CustomerFinancialSummary => {
  if (!customerId) return { ...emptySummary };

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  return loans
    .filter((loan) => loan.customerId === customerId)
    .reduce<CustomerFinancialSummary>((summary, loan) => {
      const status = effectiveLoanStatus(loan);
      const installments = Array.isArray(loan.installments) ? loan.installments : [];
      const isCancelled = status === 'CANCELLED';

      summary.totalContracts += 1;
      if (status === 'COMPLETED') summary.completedContracts += 1;
      if (status === 'ACTIVE') summary.activeContracts += 1;

      let loanOpenAmount = 0;
      let loanOverdueAmount = 0;
      let loanHasOverdue = false;

      if (!isCancelled) {
        summary.totalBorrowed = roundMoney(summary.totalBorrowed + Number(loan.amount || 0));

        const projectedProfit = Math.max(roundMoney(getLoanExpectedTotal(loan) - Number(loan.amount || 0)), 0);
        summary.projectedProfit = roundMoney(summary.projectedProfit + projectedProfit);
      }

      installments.forEach((installment) => {
        const breakdown = getInstallmentPaymentBreakdown(installment);
        summary.totalReceived = roundMoney(summary.totalReceived + breakdown.totalPaid);
        summary.realProfit = roundMoney(
          summary.realProfit + breakdown.interestPaid + breakdown.lateFeePaid + breakdown.serviceFeePaid,
        );

        if (isCancelled || status !== 'ACTIVE') return;

        const remaining = getRemainingInstallmentValue(installment, today, dailyLateFeeRate);
        loanOpenAmount = roundMoney(loanOpenAmount + remaining);

        if (remaining > 0 && isInstallmentOverdue(installment, today)) {
          loanHasOverdue = true;
          loanOverdueAmount = roundMoney(loanOverdueAmount + remaining);
        }
      });

      (Array.isArray(loan.renewalHistory) ? loan.renewalHistory : []).forEach((renewal) => {
        const interestPaid = roundMoney(Number(renewal.interestPaid ?? renewal.amount ?? 0));
        const lateFeePaid = roundMoney(Number(renewal.lateFeePaid || 0));
        const totalPaid = roundMoney(Number(renewal.totalPaid ?? interestPaid + lateFeePaid));

        summary.totalReceived = roundMoney(summary.totalReceived + totalPaid);
        summary.realProfit = roundMoney(summary.realProfit + interestPaid + lateFeePaid);
      });

      summary.openAmount = roundMoney(summary.openAmount + loanOpenAmount);
      summary.overdueAmount = roundMoney(summary.overdueAmount + loanOverdueAmount);
      if (loanHasOverdue) summary.overdueContracts += 1;

      return summary;
    }, { ...emptySummary });
};
