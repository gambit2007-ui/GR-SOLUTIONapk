import type { Installment, Loan } from '../types';
import { calculateCustomerFinancialSummary } from './customerFinancialSummary.js';
import { getInstallmentOutstanding, roundMoney } from './financialEngine.js';
import { effectiveLoanStatus, installmentPaidAmount, normalizeInstallmentStatus } from './loanCompat.js';

export type CreditRiskLevel = 'GREEN' | 'YELLOW' | 'ORANGE' | 'RED';

export interface CreditRiskAssessment {
  level: CreditRiskLevel;
  customerId: string;
  totalContracts: number;
  completedContracts: number;
  activeContracts: number;
  overdueContracts: number;
  activeLoanIds: string[];
  openAmount: number;
  overdueAmount: number;
  maxCurrentOverdueDays: number;
  maxHistoricalOverdueDays: number;
  realProfit: number;
  historyIncomplete: boolean;
}

const DAY_MS = 86_400_000;
const BUSINESS_TIME_ZONE = 'America/Sao_Paulo';

const calendarDay = (value: string | Date | undefined): number | null => {
  if (!value) return null;
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [year, month, day] = value.split('-').map(Number);
    const parsed = Date.UTC(year, month - 1, day);
    return new Date(parsed).toISOString().slice(0, 10) === value ? parsed : null;
  }
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: BUSINESS_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(parsed);
  const part = (type: 'year' | 'month' | 'day') => Number(parts.find((item) => item.type === type)?.value);
  return Date.UTC(part('year'), part('month') - 1, part('day'));
};

export const calculateOverdueDays = (dueDate: string | undefined, effectiveDate: string | Date | undefined): number => {
  const due = calendarDay(dueDate);
  const effective = calendarDay(effectiveDate);
  return due === null || effective === null ? 0 : Math.max(0, Math.floor((effective - due) / DAY_MS));
};

const activePaymentDates = (installment: Installment): string[] => {
  const entries = Array.isArray(installment.paymentEntries) ? installment.paymentEntries : [];
  if (entries.length === 0) {
    const legacyDate = installment.paymentDate || installment.paidAt || installment.lastPaymentDate;
    return legacyDate ? [legacyDate] : [];
  }
  const active: string[] = [];
  entries.forEach((entry) => {
    if (entry.kind === 'REVERSAL' || Number(entry.totalPaid || 0) < 0) {
      active.pop();
    } else if (Number(entry.totalPaid || 0) > 0) {
      active.push(entry.recordedAt);
    }
  });
  return active;
};

export const assessCustomerCreditRisk = (
  customerId: string,
  allLoans: Loan[],
  referenceDate = new Date(),
  dailyLateFeeRate?: number,
): CreditRiskAssessment => {
  const loans = allLoans.filter((loan) => loan.customerId === customerId);
  const financial = calculateCustomerFinancialSummary(customerId, loans, dailyLateFeeRate, referenceDate);
  const activeLoanIds: string[] = [];
  let maxCurrentOverdueDays = 0;
  let maxHistoricalOverdueDays = 0;
  let historyIncomplete = false;

  loans.forEach((loan) => {
    const status = effectiveLoanStatus(loan);
    if (status === 'ACTIVE') activeLoanIds.push(loan.id);
    maxHistoricalOverdueDays = Math.max(maxHistoricalOverdueDays, Number(loan.maxHistoricalOverdueDays || 0));
    if (!loan.installments?.length && Number(loan.amount || 0) > 0) historyIncomplete = true;
    // A redistribuicao substitui parcelas antigas; fiscalPaymentEntries conserva o
    // pagamento, mas nao o vencimento original necessario para medir aquele atraso.
    if (loan.fiscalPaymentEntries?.length) historyIncomplete = true;
    (Array.isArray(loan.installments) ? loan.installments : []).forEach((installment) => {
      const paymentDates = activePaymentDates(installment);
      if (calendarDay(installment.dueDate) === null) historyIncomplete = true;
      paymentDates.forEach((date) => {
        if (calendarDay(date) === null || calendarDay(installment.dueDate) === null) historyIncomplete = true;
        maxHistoricalOverdueDays = Math.max(maxHistoricalOverdueDays, calculateOverdueDays(installment.dueDate, date));
      });
      if ((normalizeInstallmentStatus(installment.status) === 'PAID' ||
        installmentPaidAmount(installment) > 0 ||
        Number(installment.paymentBreakdown?.totalPaid || 0) > 0) && paymentDates.length === 0) {
        historyIncomplete = true;
      }
      if (status !== 'ACTIVE') return;
      const outstanding = getInstallmentOutstanding(installment, referenceDate, dailyLateFeeRate);
      if (outstanding.total <= 0) return;
      maxCurrentOverdueDays = Math.max(maxCurrentOverdueDays, calculateOverdueDays(installment.dueDate, referenceDate));
    });

    (Array.isArray(loan.renewalHistory) ? loan.renewalHistory : []).forEach((renewal) => {
      if (calendarDay(renewal.previousDueDate) === null || calendarDay(renewal.paymentDate) === null) {
        historyIncomplete = true;
      }
      maxHistoricalOverdueDays = Math.max(
        maxHistoricalOverdueDays,
        calculateOverdueDays(renewal.previousDueDate, renewal.paymentDate),
      );
      if (!renewal.previousDueDate) historyIncomplete = true;
    });
    if (Number(loan.renewCount || 0) > (loan.renewalHistory?.length || 0)) historyIncomplete = true;
  });

  const level: CreditRiskLevel = maxCurrentOverdueDays > 15 || maxHistoricalOverdueDays > 15
    ? 'RED'
    : maxCurrentOverdueDays > 0
      ? 'ORANGE'
      : activeLoanIds.length > 0
        ? 'YELLOW'
        : 'GREEN';

  return {
    level,
    customerId,
    totalContracts: financial.totalContracts,
    completedContracts: financial.completedContracts,
    activeContracts: financial.activeContracts,
    overdueContracts: financial.overdueContracts,
    activeLoanIds,
    openAmount: roundMoney(financial.openAmount),
    overdueAmount: roundMoney(financial.overdueAmount),
    maxCurrentOverdueDays,
    maxHistoricalOverdueDays,
    realProfit: roundMoney(financial.realProfit),
    historyIncomplete,
  };
};

/** Persist only evidence available before/after an audited operation, never a guessed legacy value. */
export const nextMaxHistoricalOverdueDays = (
  before: Loan,
  after: Loan,
  effectiveDate: Date,
): number | undefined => {
  const beforeRisk = assessCustomerCreditRisk(before.customerId, [before], effectiveDate, 0);
  const afterRisk = assessCustomerCreditRisk(after.customerId, [{
    ...after, maxHistoricalOverdueDays: before.maxHistoricalOverdueDays,
  }], effectiveDate, 0);
  const nextMaximum = Math.max(
    Number(before.maxHistoricalOverdueDays || 0),
    beforeRisk.maxHistoricalOverdueDays,
    beforeRisk.maxCurrentOverdueDays,
    afterRisk.maxHistoricalOverdueDays,
    afterRisk.maxCurrentOverdueDays,
  );
  if (nextMaximum === 0 && before.maxHistoricalOverdueDays === undefined &&
    (beforeRisk.historyIncomplete || afterRisk.historyIncomplete)) return undefined;
  return nextMaximum;
};
