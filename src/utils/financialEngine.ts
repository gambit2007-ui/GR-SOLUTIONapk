import type {
  Installment,
  InstallmentPaymentEntry,
  Loan,
  LoanPaymentRequest,
  PaymentBreakdown,
} from '../types';
import { buildInstallmentDueDate, getLocalISODate } from './dateTime';
import { calculateInstallmentLateFee } from './lateFee';
import { installmentAmount, installmentPaidAmount, normalizeInstallmentStatus, normalizeLoanStatus } from './loanCompat';
import { buildPaymentBreakdown } from './paymentBreakdown';

export const roundMoney = (value: number): number =>
  Number((Number.isFinite(value) ? value : 0).toFixed(2));

const EMPTY_BREAKDOWN: PaymentBreakdown = {
  principalPaid: 0,
  interestPaid: 0,
  lateFeePaid: 0,
  serviceFeePaid: 0,
  discountApplied: 0,
  totalPaid: 0,
};

export const addBreakdowns = (left: PaymentBreakdown, right: PaymentBreakdown): PaymentBreakdown => ({
  principalPaid: roundMoney(Number(left.principalPaid || 0) + Number(right.principalPaid || 0)),
  interestPaid: roundMoney(Number(left.interestPaid || 0) + Number(right.interestPaid || 0)),
  lateFeePaid: roundMoney(Number(left.lateFeePaid || 0) + Number(right.lateFeePaid || 0)),
  serviceFeePaid: roundMoney(Number(left.serviceFeePaid || 0) + Number(right.serviceFeePaid || 0)),
  discountApplied: roundMoney(Number(left.discountApplied || 0) + Number(right.discountApplied || 0)),
  totalPaid: roundMoney(Number(left.totalPaid || 0) + Number(right.totalPaid || 0)),
});

export const getInstallmentRecordedBreakdown = (installment: Installment): PaymentBreakdown => {
  const entries = Array.isArray(installment.paymentEntries) ? installment.paymentEntries : [];
  if (entries.length > 0) {
    return entries.reduce<PaymentBreakdown>((total, entry) => addBreakdowns(total, entry), EMPTY_BREAKDOWN);
  }
  return installment.paymentBreakdown ? addBreakdowns(EMPTY_BREAKDOWN, installment.paymentBreakdown) : { ...EMPTY_BREAKDOWN };
};

export const getInstallmentBaseRemaining = (installment: Installment | null | undefined): number => {
  if (!installment || normalizeInstallmentStatus(installment.status) === 'PAID') return 0;
  const amount = roundMoney(installmentAmount(installment));
  const breakdown = getInstallmentRecordedBreakdown(installment);
  const allocatedBase = roundMoney(
    breakdown.principalPaid + breakdown.interestPaid + breakdown.discountApplied,
  );

  if (allocatedBase !== 0) return roundMoney(Math.max(amount - allocatedBase, 0));

  const paidOutsideBase = roundMoney(breakdown.lateFeePaid + breakdown.serviceFeePaid);
  const legacyBasePaid = roundMoney(Math.max(installmentPaidAmount(installment) - paidOutsideBase, 0));
  return roundMoney(Math.max(amount - legacyBasePaid, 0));
};

export interface InstallmentOutstanding {
  base: number;
  lateFee: number;
  total: number;
}

export const getInstallmentOutstanding = (
  installment: Installment | null | undefined,
  referenceDate = new Date(),
  dailyLateFeeRate?: number,
): InstallmentOutstanding => {
  if (!installment || normalizeInstallmentStatus(installment.status) === 'PAID') {
    return { base: 0, lateFee: 0, total: 0 };
  }

  const base = getInstallmentBaseRemaining(installment);
  const lateFee = calculateInstallmentLateFee(installment, referenceDate, dailyLateFeeRate);
  return { base, lateFee, total: roundMoney(base + lateFee) };
};

const resolveLoanTotalReceivable = (loan: Loan): number => {
  const installmentTotal = (Array.isArray(loan.installments) ? loan.installments : [])
    .reduce((sum, installment) => sum + installmentAmount(installment), 0);
  return roundMoney(installmentTotal || Number(loan.totalToReturn || 0) || Number(loan.amount || 0));
};

const isPriceLoan = (loan: Loan): boolean => String(loan.interestType || '').toUpperCase() === 'PRICE';

const ensureLegacyPaymentEntry = (installment: Installment): InstallmentPaymentEntry[] => {
  const entries = Array.isArray(installment.paymentEntries) ? [...installment.paymentEntries] : [];
  if (entries.length > 0 || !installment.paymentBreakdown) return entries;

  const recordedAt = installment.paymentDate || installment.paidAt || installment.lastPaymentDate;
  if (!recordedAt) return entries;
  return [{
    id: `legacy-${installment.id || installment.number}`,
    recordedAt,
    kind: 'PAYMENT',
    ...installment.paymentBreakdown,
    installmentNumber: installment.number,
  }];
};

interface AppliedInstallment {
  installment: Installment;
  appliedAmount: number;
  breakdown: PaymentBreakdown | null;
}

const applyAmountToInstallment = (
  loan: Loan,
  source: Installment,
  requestedAmount: number,
  operationId: string,
  entrySuffix: string,
  processedAt: string,
  dailyLateFeeRate: number | undefined,
  discountApplied = 0,
): AppliedInstallment => {
  const installment = { ...source };
  const outstanding = getInstallmentOutstanding(installment, new Date(processedAt), dailyLateFeeRate);
  const safeDiscount = roundMoney(Math.min(Math.max(discountApplied, 0), outstanding.base));
  const maximumPayment = roundMoney(Math.max(outstanding.total - safeDiscount, 0));
  const appliedAmount = roundMoney(Math.min(Math.max(requestedAmount, 0), maximumPayment));
  if (appliedAmount <= 0 && safeDiscount <= 0) {
    return { installment, appliedAmount: 0, breakdown: null };
  }

  const previousBreakdown = getInstallmentRecordedBreakdown(installment);
  const lateFeePaid = roundMoney(Math.min(appliedAmount, outstanding.lateFee));
  const breakdown = buildPaymentBreakdown({
    loan: {
      id: loan.id,
      type: isPriceLoan(loan) ? 'PRICE' : 'SIMPLE',
      totalAmount: Number(loan.amount || 0),
      totalReceivable: resolveLoanTotalReceivable(loan),
    },
    installment: {
      id: installment.id,
      amount: installmentAmount(installment),
      expectedPrincipal: installment.expectedPrincipal,
      expectedInterest: installment.expectedInterest,
    },
    paidAmount: appliedAmount,
    lateFeePaid,
    discountApplied: safeDiscount,
    previousPrincipalPaid: previousBreakdown.principalPaid,
    previousInterestPaid: previousBreakdown.interestPaid,
  });
  const paymentEntries = ensureLegacyPaymentEntry(installment);
  const entry: InstallmentPaymentEntry = {
    id: `${operationId}-${entrySuffix}`,
    operationId,
    installmentNumber: installment.number,
    recordedAt: processedAt,
    kind: 'PAYMENT',
    principalPaid: breakdown.principalPaid,
    interestPaid: breakdown.interestPaid,
    lateFeePaid: breakdown.lateFeePaid,
    serviceFeePaid: breakdown.serviceFeePaid,
    discountApplied: breakdown.discountApplied,
    totalPaid: breakdown.totalPaid,
  };
  const mergedBreakdown = addBreakdowns(previousBreakdown, breakdown);
  const cumulativePaid = roundMoney(Math.max(installmentPaidAmount(installment), previousBreakdown.totalPaid) + appliedAmount);
  const baseAfter = roundMoney(Math.max(outstanding.base - breakdown.principalPaid - breakdown.interestPaid - safeDiscount, 0));
  const lateFeeAfter = roundMoney(Math.max(outstanding.lateFee - lateFeePaid, 0));
  const isPaid = baseAfter <= 0.01 && lateFeeAfter <= 0.01;

  installment.paymentEntries = [...paymentEntries, entry];
  installment.paymentBreakdown = mergedBreakdown;
  installment.paidAmount = cumulativePaid;
  installment.partialPaid = isPaid ? 0 : cumulativePaid;
  installment.lastPaymentDate = processedAt;
  installment.lastPaidValue = appliedAmount;
  installment.needsFiscalReview = installment.needsFiscalReview || breakdown.needsFiscalReview || undefined;
  if (isPaid) {
    installment.status = 'PAGO';
    installment.paymentDate = processedAt;
  } else {
    installment.status = 'PENDENTE';
  }

  return { installment, appliedAmount, breakdown };
};

export interface EarlySettlementEntry {
  installmentIndex: number;
  outstanding: number;
  payable: number;
  discount: number;
}

export interface EarlySettlementQuote {
  loanId: string;
  totalOutstanding: number;
  discount: number;
  payoffAmount: number;
  entries: EarlySettlementEntry[];
}

const getCalendarDay = (value: string | Date): number | null => {
  const date = value instanceof Date ? new Date(value) : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
};

const periodsUntilDue = (loan: Loan, dueDate: string, referenceDate: Date): number => {
  const dueDay = getCalendarDay(`${dueDate}T12:00:00`);
  const referenceDay = getCalendarDay(referenceDate);
  if (dueDay === null || referenceDay === null || dueDay <= referenceDay) return 0;
  const days = Math.max(Math.ceil((dueDay - referenceDay) / (24 * 60 * 60 * 1000)), 1);
  const frequency = String(loan.frequency || '').toUpperCase();
  if (frequency === 'DIARIO' || frequency === 'DAILY') return days;
  if (frequency === 'SEMANAL' || frequency === 'WEEKLY') return Math.max(Math.ceil(days / 7), 1);
  if (frequency === 'QUINZENAL' || frequency === 'BIWEEKLY') return Math.max(Math.ceil(days / 15), 1);
  const due = new Date(`${dueDate}T12:00:00`);
  return Math.max(
    ((due.getFullYear() - referenceDate.getFullYear()) * 12) + due.getMonth() - referenceDate.getMonth(),
    1,
  );
};

export const buildEarlySettlementQuote = (
  loan: Loan,
  referenceDate = new Date(),
  dailyLateFeeRate?: number,
): EarlySettlementQuote | null => {
  if (!isPriceLoan(loan)) return null;
  const periodicRate = Math.max(Number(loan.interestRate || 0) / 100, 0);
  const entries = (Array.isArray(loan.installments) ? loan.installments : []).reduce<EarlySettlementEntry[]>(
    (result, installment, installmentIndex) => {
      const outstanding = getInstallmentOutstanding(installment, referenceDate, dailyLateFeeRate);
      if (outstanding.total <= 0) return result;

      const periods = periodsUntilDue(loan, installment.dueDate, referenceDate);
      const discountedBase = periods > 0 && periodicRate > 0
        ? roundMoney(outstanding.base / Math.pow(1 + periodicRate, periods))
        : outstanding.base;
      const recorded = getInstallmentRecordedBreakdown(installment);
      const remainingContractualInterest = Math.max(
        roundMoney(Number(installment.expectedInterest || 0) - recorded.interestPaid),
        0,
      );
      const discount = periods > 0
        ? roundMoney(Math.min(Math.max(outstanding.base - discountedBase, 0), remainingContractualInterest))
        : 0;
      const payable = roundMoney(outstanding.total - discount);
      result.push({
        installmentIndex,
        outstanding: outstanding.total,
        payable,
        discount,
      });
      return result;
    },
    [],
  );
  if (entries.length === 0) return null;

  const totalOutstanding = roundMoney(entries.reduce((sum, entry) => sum + entry.outstanding, 0));
  const payoffAmount = roundMoney(entries.reduce((sum, entry) => sum + entry.payable, 0));
  return {
    loanId: loan.id,
    totalOutstanding,
    payoffAmount,
    discount: roundMoney(Math.max(totalOutstanding - payoffAmount, 0)),
    entries,
  };
};

const splitAmountEvenly = (total: number, count: number): number[] => {
  const safeCount = Math.max(Math.trunc(count), 0);
  if (safeCount === 0) return [];
  const totalCents = Math.max(Math.round(roundMoney(total) * 100), 0);
  const baseCents = Math.floor(totalCents / safeCount);
  let remainder = totalCents - (baseCents * safeCount);
  return Array.from({ length: safeCount }, () => {
    const receivesExtraCent = remainder > 0;
    if (receivesExtraCent) remainder -= 1;
    const cents = baseCents + (receivesExtraCent ? 1 : 0);
    return roundMoney(cents / 100);
  });
};

const normalizeFrequency = (loan: Loan): 'DAILY' | 'WEEKLY' | 'BIWEEKLY' | 'MONTHLY' => {
  const frequency = String(loan.frequency || '').toUpperCase();
  if (frequency === 'DIARIO' || frequency === 'DAILY') return 'DAILY';
  if (frequency === 'SEMANAL' || frequency === 'WEEKLY') return 'WEEKLY';
  if (frequency === 'QUINZENAL' || frequency === 'BIWEEKLY') return 'BIWEEKLY';
  return 'MONTHLY';
};

export interface ApplyLoanPaymentOutput {
  loan: Loan;
  appliedAmount: number;
  unappliedAmount: number;
  discountApplied: number;
}

export const applyLoanPaymentToCurrentLoan = (
  currentLoan: Loan,
  request: LoanPaymentRequest,
  dailyLateFeeRate?: number,
): ApplyLoanPaymentOutput => {
  if (!request.operationId.trim()) throw new Error('OPERACAO_INVALIDA');
  if (normalizeLoanStatus(currentLoan.status) === 'CANCELLED') throw new Error('CONTRATO_CANCELADO');
  const processedAtDate = new Date(request.processedAt);
  if (Number.isNaN(processedAtDate.getTime())) throw new Error('DATA_PAGAMENTO_INVALIDA');

  let installments = (Array.isArray(currentLoan.installments) ? currentLoan.installments : []).map((item) => ({ ...item }));
  if (!installments[request.installmentIndex]) throw new Error('PARCELA_INVALIDA');

  let appliedAmount = 0;
  let discountApplied = 0;
  let requestedAmount = roundMoney(Number(request.amount || 0));
  const fiscalEntries: InstallmentPaymentEntry[] = [];

  if (request.applyMode === 'EARLY_SETTLEMENT') {
    const quote = buildEarlySettlementQuote(currentLoan, processedAtDate, dailyLateFeeRate);
    if (!quote) throw new Error('QUITACAO_INDISPONIVEL');
    requestedAmount = quote.payoffAmount;
    quote.entries.forEach((quoteEntry, index) => {
      const applied = applyAmountToInstallment(
        currentLoan,
        installments[quoteEntry.installmentIndex],
        quoteEntry.payable,
        request.operationId,
        `settlement-${index}`,
        request.processedAt,
        dailyLateFeeRate,
        quoteEntry.discount,
      );
      installments[quoteEntry.installmentIndex] = applied.installment;
      appliedAmount = roundMoney(appliedAmount + applied.appliedAmount);
      discountApplied = roundMoney(discountApplied + quoteEntry.discount);
    });
  } else {
    if (!Number.isFinite(requestedAmount) || requestedAmount <= 0) throw new Error('VALOR_INVALIDO');
    const indexes = request.applyMode === 'TOTAL_BALANCE'
      ? installments.map((_, index) => index).reverse()
      : installments.map((_, index) => index).filter((index) => index >= request.installmentIndex);
    let remaining = requestedAmount;

    for (const index of indexes) {
      if (remaining <= 0) break;
      const applied = applyAmountToInstallment(
        currentLoan,
        installments[index],
        remaining,
        request.operationId,
        `installment-${index}`,
        request.processedAt,
        dailyLateFeeRate,
      );
      installments[index] = applied.installment;
      remaining = roundMoney(remaining - applied.appliedAmount);
      appliedAmount = roundMoney(appliedAmount + applied.appliedAmount);
      if (request.applyMode === 'REDISTRIBUTE_BALANCE' && applied.breakdown) {
        fiscalEntries.push({
          id: `${request.operationId}-redistribution-${index}`,
          operationId: request.operationId,
          installmentNumber: installments[index].number,
          recordedAt: request.processedAt,
          kind: 'PAYMENT',
          ...applied.breakdown,
        });
      }
    }

    if (request.applyMode === 'REDISTRIBUTE_BALANCE') {
      const count = Math.trunc(Number(request.redistributionInstallmentsCount || 0));
      const startDate = String(request.redistributionStartDate || '').trim();
      if (count <= 0) throw new Error('QUANTIDADE_PARCELAS_INVALIDA');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) throw new Error('DATA_REDISTRIBUICAO_INVALIDA');
      if (startDate < getLocalISODate(processedAtDate)) throw new Error('DATA_REDISTRIBUICAO_RETROATIVA');

      const selected = installments.slice(request.installmentIndex);
      const remainingBreakdown = selected.reduce(
        (totals, installment) => {
          const outstanding = getInstallmentOutstanding(installment, processedAtDate, dailyLateFeeRate);
          const paid = getInstallmentRecordedBreakdown(installment);
          const expectedPrincipal = isPriceLoan(currentLoan)
            ? Math.max(Number(installment.expectedPrincipal || 0) - paid.principalPaid, 0)
            : outstanding.base;
          const principal = roundMoney(Math.min(expectedPrincipal, outstanding.base));
          return {
            principal: roundMoney(totals.principal + principal),
            interest: roundMoney(totals.interest + Math.max(outstanding.base - principal, 0)),
            lateFee: roundMoney(totals.lateFee + outstanding.lateFee),
          };
        },
        { principal: 0, interest: 0, lateFee: 0 },
      );
      const principalValues = splitAmountEvenly(remainingBreakdown.principal, count);
      const interestValues = splitAmountEvenly(remainingBreakdown.interest, count);
      const baseNumber = Number(installments[request.installmentIndex]?.number || request.installmentIndex + 1);
      const frequency = normalizeFrequency(currentLoan);
      const rebuilt = Array.from({ length: count }, (_, index): Installment => {
        const principal = principalValues[index] || 0;
        const interest = interestValues[index] || 0;
        const amount = roundMoney(principal + interest);
        return {
          id: `${request.operationId}-redistributed-${index}`,
          number: baseNumber + index,
          amount,
          value: amount,
          dueDate: buildInstallmentDueDate(startDate, index, frequency) || startDate,
          status: 'PENDENTE',
          paidAmount: 0,
          partialPaid: 0,
          carriedLateFee: index === 0 && remainingBreakdown.lateFee > 0 ? remainingBreakdown.lateFee : undefined,
          expectedPrincipal: isPriceLoan(currentLoan) ? principal : undefined,
          expectedInterest: isPriceLoan(currentLoan) ? interest : undefined,
        };
      });
      installments = [...installments.slice(0, request.installmentIndex), ...rebuilt];
    }
  }

  if (appliedAmount <= 0) throw new Error('SEM_SALDO_PENDENTE');
  const allPaid = installments.every((installment) => normalizeInstallmentStatus(installment.status) === 'PAID');
  const nextLoan: Loan = {
    ...currentLoan,
    installments,
    installmentsCount: installments.length,
    installmentCount: installments.length,
    totalToReturn: roundMoney(installments.reduce((sum, installment) => sum + installmentAmount(installment), 0)),
    status: allPaid ? 'QUITADO' : 'ATIVO',
    fiscalPaymentEntries: fiscalEntries.length > 0
      ? [...(Array.isArray(currentLoan.fiscalPaymentEntries) ? currentLoan.fiscalPaymentEntries : []), ...fiscalEntries]
      : currentLoan.fiscalPaymentEntries,
    version: Math.max(Math.trunc(Number(currentLoan.version || 0)), 0) + 1,
  };

  return {
    loan: nextLoan,
    appliedAmount,
    unappliedAmount: roundMoney(Math.max(requestedAmount - appliedAmount, 0)),
    discountApplied,
  };
};
