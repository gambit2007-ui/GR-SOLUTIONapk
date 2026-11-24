import type { CashMovement, Loan, PaymentBreakdown } from '../types';
import { getFinancialMonthKey } from './dateTime';
import { normalizeInstallmentStatus } from './loanCompat';

export interface FiscalMonthMetrics {
  principalRecovered: number;
  interestReceived: number;
  lateFeesReceived: number;
  serviceFeesReceived: number;
  taxableRevenue: number;
  totalPaid: number;
}

const emptyMetrics = (): FiscalMonthMetrics => ({
  principalRecovered: 0, interestReceived: 0, lateFeesReceived: 0,
  serviceFeesReceived: 0, taxableRevenue: 0, totalPaid: 0,
});
const money = (value: unknown): number => {
  const parsed = Number(value || 0);
  return Number((Number.isFinite(parsed) ? parsed : 0).toFixed(2));
};

// Shared cash-basis recognition for the screen and both PDF reports.
// Payment history wins over legacy aggregates; reversals remain signed entries.
export const buildRealizedIncome = (loans: Loan[], cashMovements: CashMovement[]) => {
  const monthly: Record<string, FiscalMonthMetrics> = {};
  const totals = emptyMetrics();
  let undatedEntries = 0;
  const movementDates = new Map<string, string>();
  cashMovements.forEach((movement) => {
    const operationId = String(movement.operationId || movement.id || '').trim();
    if (operationId && movement.date) movementDates.set(operationId, movement.date);
  });
  const register = (date: unknown, breakdown: Partial<PaymentBreakdown>, operationId?: string) => {
    const month = getFinancialMonthKey(operationId ? movementDates.get(operationId) || date : date);
    if (!month) { undatedEntries += 1; return; }
    const values: FiscalMonthMetrics = {
      principalRecovered: money(breakdown.principalPaid),
      interestReceived: money(breakdown.interestPaid),
      lateFeesReceived: money(breakdown.lateFeePaid),
      serviceFeesReceived: money(breakdown.serviceFeePaid),
      taxableRevenue: 0, totalPaid: money(breakdown.totalPaid),
    };
    values.taxableRevenue = money(values.interestReceived + values.lateFeesReceived + values.serviceFeesReceived);
    const metrics = monthly[month] ??= emptyMetrics();
    for (const key of Object.keys(values) as Array<keyof FiscalMonthMetrics>) {
      metrics[key] = money(metrics[key] + values[key]);
      totals[key] = money(totals[key] + values[key]);
    }
  };
  loans.forEach((loan) => {
    (loan.installments || []).forEach((installment) => {
      const entries = installment.paymentEntries || [];
      if (entries.length > 0) {
        entries.forEach((entry) => register(entry.recordedAt, entry, entry.operationId));
      } else if (normalizeInstallmentStatus(installment.status) === 'PAID' && installment.paymentBreakdown) {
        register(installment.paidAt || installment.paymentDate || installment.lastPaymentDate, installment.paymentBreakdown);
      }
    });
    (loan.fiscalPaymentEntries || []).forEach((entry) => register(entry.recordedAt, entry, entry.operationId));
    (loan.renewalHistory || []).forEach((renewal) => {
      const interestPaid = money(renewal.interestPaid ?? renewal.amount);
      const lateFeePaid = money(renewal.lateFeePaid);
      register(renewal.paymentDate, { interestPaid, lateFeePaid,
        totalPaid: money(renewal.totalPaid ?? interestPaid + lateFeePaid) });
    });
  });
  return { monthly, totals, undatedEntries };
};
