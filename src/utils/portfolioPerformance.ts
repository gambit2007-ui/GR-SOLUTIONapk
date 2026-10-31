import type { CashMovement, Loan, PaymentBreakdown } from '../types';
import { isLoanCashOutflowMovement } from './cashCategories';
import { normalizeInstallmentStatus } from './loanCompat';

const roundMoney = (value: number) => Number(value.toFixed(2));
const yearOf = (value: string | undefined): number | null => {
  if (value && /^\d{4}-\d{2}-\d{2}$/.test(value)) return Number(value.slice(0, 4));
  const date = value ? new Date(value) : null;
  return date && Number.isFinite(date.getTime()) ? date.getFullYear() : null;
};

export interface PortfolioPerformance {
  directRevenue: number;
  bancarizedRevenue: number;
  principalRecovered: number;
  principalLent: number;
  interestReceived: number;
  lateFeesReceived: number;
  serviceFeesReceived: number;
  renewalRevenue: number;
  discountsGranted: number;
  recoveryOnConcessionsPercent: number | null;
  undatedLegacyPayments: number;
}

export const calculatePortfolioPerformance = (
  loans: Loan[],
  cashMovements: CashMovement[],
  year: number,
): PortfolioPerformance => {
  const result: PortfolioPerformance = {
    directRevenue: 0, bancarizedRevenue: 0, principalRecovered: 0, principalLent: 0,
    interestReceived: 0, lateFeesReceived: 0, serviceFeesReceived: 0,
    renewalRevenue: 0, discountsGranted: 0, recoveryOnConcessionsPercent: null,
    undatedLegacyPayments: 0,
  };
  const movementDateByOperationId = new Map<string, string>();
  cashMovements.forEach((movement) => {
    const operationId = String(movement.operationId || movement.id || '').trim();
    if (operationId && movement.date) movementDateByOperationId.set(operationId, movement.date);
    if (isLoanCashOutflowMovement(movement) && yearOf(movement.date) === year) {
      result.principalLent = roundMoney(result.principalLent + Number(movement.amount || 0));
    }
  });

  loans.forEach((loan) => {
    const origin = loan.formalizationType === 'BANCARIZED' || loan.provider === 'CREDIGRUPO'
      ? 'bancarizedRevenue'
      : 'directRevenue';
    const register = (entry: Partial<PaymentBreakdown>, date: string | undefined, renewal = false) => {
      if (yearOf(date) !== year) return;
      const interest = Number(entry.interestPaid || 0);
      const lateFees = Number(entry.lateFeePaid || 0);
      const serviceFees = Number(entry.serviceFeePaid || 0);
      const revenue = interest + lateFees + serviceFees;
      result[origin] = roundMoney(result[origin] + revenue);
      result.principalRecovered = roundMoney(result.principalRecovered + Number(entry.principalPaid || 0));
      result.interestReceived = roundMoney(result.interestReceived + interest);
      result.lateFeesReceived = roundMoney(result.lateFeesReceived + lateFees);
      result.serviceFeesReceived = roundMoney(result.serviceFeesReceived + serviceFees);
      result.discountsGranted = roundMoney(result.discountsGranted + Number(entry.discountApplied || 0));
      if (renewal) result.renewalRevenue = roundMoney(result.renewalRevenue + revenue);
    };

    loan.installments?.forEach((installment) => {
      if (installment.paymentEntries?.length) {
        installment.paymentEntries.forEach((entry) => register(
          entry,
          movementDateByOperationId.get(entry.operationId || '') || entry.recordedAt,
        ));
      } else if (installment.paymentBreakdown && normalizeInstallmentStatus(installment.status) === 'PAID') {
        const paidAt = installment.paidAt || installment.paymentDate || installment.lastPaymentDate;
        if (paidAt) register(installment.paymentBreakdown, paidAt);
        else result.undatedLegacyPayments += 1;
      } else if (Number(installment.paidAmount || installment.partialPaid || 0) > 0) {
        result.undatedLegacyPayments += 1;
      }
    });
    loan.fiscalPaymentEntries?.forEach((entry) => register(
      entry,
      movementDateByOperationId.get(entry.operationId || '') || entry.recordedAt,
    ));
    loan.renewalHistory?.forEach((renewal) => register({
      interestPaid: Number(renewal.interestPaid ?? renewal.amount ?? 0),
      lateFeePaid: Number(renewal.lateFeePaid || 0),
    }, renewal.paymentDate, true));
  });

  result.recoveryOnConcessionsPercent = result.principalLent > 0
    ? roundMoney((result.principalRecovered / result.principalLent) * 100)
    : null;
  return result;
};
