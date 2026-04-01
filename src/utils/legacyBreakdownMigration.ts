import type { BreakdownSource, Installment, Loan, LoanType, PaymentBreakdown } from '../types.ts';

export type BreakdownMigrationCategory =
  | 'MIGRATABLE_SIMPLE'
  | 'MIGRATABLE_PRICE'
  | 'REVIEW_REQUIRED'
  | 'SKIP_NO_PAYMENT'
  | 'SKIP_ALREADY_HAS_BREAKDOWN'
  | 'SKIP_INSUFFICIENT_DATA';

export type BreakdownMigrationReasonCode =
  | 'already_has_breakdown'
  | 'no_paid_amount'
  | 'linked_estorno_detected'
  | 'unsupported_interest_type'
  | 'missing_total_amount'
  | 'missing_total_receivable'
  | 'invalid_interest_rate'
  | 'missing_installments_count'
  | 'invalid_installment_number'
  | 'installment_number_out_of_range'
  | 'unable_to_build_price_schedule'
  | 'price_requires_manual_review'
  | 'price_estimated_fallback';

export interface LegacyLoanLike {
  id?: string;
  amount?: number;
  totalToReturn?: number;
  interestRate?: number;
  interestType?: unknown;
  installmentCount?: number;
  installmentsCount?: number;
  installments?: Array<LegacyInstallmentLike | Installment>;
}

export interface LegacyInstallmentLike {
  id?: string;
  number?: number;
  amount?: number;
  value?: number;
  status?: unknown;
  paidAmount?: number;
  partialPaid?: number;
  paymentAmount?: number;
  paymentDate?: string;
  paidAt?: string;
  lastPaymentDate?: string;
  paymentBreakdown?: PaymentBreakdown;
  expectedPrincipal?: number;
  expectedInterest?: number;
}

export interface PriceScheduleEntry {
  installmentNumber: number;
  total: number;
  expectedPrincipal: number;
  expectedInterest: number;
}

export interface LegacyInstallmentClassification {
  category: BreakdownMigrationCategory;
  reasonCodes: BreakdownMigrationReasonCode[];
  loanType: LoanType | null;
  paidAmount: number;
  installmentNumber: number | null;
  hasPaymentBreakdown: boolean;
}

export interface LegacyBreakdownBuildResult {
  paymentBreakdown: PaymentBreakdown;
  breakdownSource: BreakdownSource;
  needsFiscalReview: boolean;
  reasonCodes: BreakdownMigrationReasonCode[];
  expectedPrincipal?: number;
  expectedInterest?: number;
}

interface PriceMigrateCheck {
  isMigratable: boolean;
  requiresReview: boolean;
  reasonCodes: BreakdownMigrationReasonCode[];
  principal: number;
  interestRate: number;
  installmentsCount: number;
  installmentNumber: number | null;
  paidAmount: number;
}

const round2 = (value: number): number => Number((Number.isFinite(value) ? value : 0).toFixed(2));

const toNumber = (value: unknown): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const normalizeText = (value: unknown): string =>
  String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toUpperCase();

const isPaidStatus = (status: unknown): boolean => {
  const normalized = normalizeText(status);
  return normalized === 'PAGO' || normalized === 'PAID' || normalized === 'LIQUIDADO';
};

const safePositive = (value: unknown): number => {
  const parsed = toNumber(value);
  return parsed > 0 ? round2(parsed) : 0;
};

export const detectLoanType = (loan: Pick<LegacyLoanLike, 'interestType'>): LoanType | null => {
  const normalized = normalizeText(loan.interestType);
  if (normalized === 'PRICE') return 'PRICE';
  if (normalized === 'SIMPLE' || normalized === 'SIMPLES') return 'SIMPLE';
  return null;
};

export const hasPaymentBreakdown = (installment: Pick<LegacyInstallmentLike, 'paymentBreakdown'>): boolean => {
  const breakdown = installment.paymentBreakdown;
  if (!breakdown || typeof breakdown !== 'object') return false;
  const values = [
    breakdown.principalPaid,
    breakdown.interestPaid,
    breakdown.lateFeePaid,
    breakdown.serviceFeePaid,
    breakdown.discountApplied,
    breakdown.totalPaid,
  ];
  return values.some((value) => Number.isFinite(Number(value)) && Number(value) > 0);
};

export const resolveInstallmentAmount = (installment: LegacyInstallmentLike): number =>
  safePositive(installment.amount ?? installment.value);

export const resolveInstallmentPaidAmount = (installment: LegacyInstallmentLike): number => {
  const directPaid = safePositive(installment.paidAmount);
  if (directPaid > 0) return directPaid;

  const paymentAmount = safePositive(installment.paymentAmount);
  if (paymentAmount > 0) return paymentAmount;

  const partialPaid = safePositive(installment.partialPaid);
  if (partialPaid > 0) return partialPaid;

  if (isPaidStatus(installment.status)) {
    return resolveInstallmentAmount(installment);
  }

  return 0;
};

export const resolveInstallmentNumber = (
  installment: LegacyInstallmentLike,
  installmentIndex: number,
): number | null => {
  const fromField = Math.trunc(toNumber(installment.number));
  if (Number.isFinite(fromField) && fromField > 0) return fromField;
  const fromIndex = installmentIndex + 1;
  return fromIndex > 0 ? fromIndex : null;
};

export const resolveInstallmentsCount = (loan: LegacyLoanLike): number => {
  const explicitCount = Math.trunc(toNumber(loan.installmentsCount ?? loan.installmentCount));
  if (explicitCount > 0) return explicitCount;
  const byArray = Array.isArray(loan.installments) ? loan.installments.length : 0;
  return byArray > 0 ? byArray : 0;
};

export const resolveLoanTotalReceivable = (loan: LegacyLoanLike): number => {
  const explicitTotal = safePositive(loan.totalToReturn);
  if (explicitTotal > 0) return explicitTotal;

  if (Array.isArray(loan.installments) && loan.installments.length > 0) {
    const summedTotal = round2(
      loan.installments.reduce((sum, installment) => sum + resolveInstallmentAmount(installment), 0),
    );
    if (summedTotal > 0) return summedTotal;
  }

  return 0;
};

export const canMigrateSimple = (
  loan: LegacyLoanLike,
  installment: LegacyInstallmentLike,
): { isMigratable: boolean; reasonCodes: BreakdownMigrationReasonCode[]; paidAmount: number } => {
  const reasonCodes: BreakdownMigrationReasonCode[] = [];
  const totalAmount = safePositive(loan.amount);
  const totalReceivable = resolveLoanTotalReceivable(loan);
  const paidAmount = resolveInstallmentPaidAmount(installment);

  if (totalAmount <= 0) reasonCodes.push('missing_total_amount');
  if (totalReceivable <= 0) reasonCodes.push('missing_total_receivable');
  if (paidAmount <= 0) reasonCodes.push('no_paid_amount');

  return {
    isMigratable: reasonCodes.length === 0,
    reasonCodes,
    paidAmount,
  };
};

const calculatePricePayment = (principal: number, monthlyRate: number, installments: number): number => {
  if (installments <= 0 || principal <= 0) return 0;
  if (monthlyRate <= 0) return round2(principal / installments);
  const factor = Math.pow(1 + monthlyRate, installments);
  if (!Number.isFinite(factor) || factor <= 1) return round2(principal / installments);
  return round2(principal * ((monthlyRate * factor) / (factor - 1)));
};

export const buildPriceSchedule = (
  principal: number,
  interestRatePercent: number,
  installmentsCount: number,
): PriceScheduleEntry[] | null => {
  const normalizedPrincipal = safePositive(principal);
  const normalizedRate = toNumber(interestRatePercent);
  const normalizedCount = Math.trunc(toNumber(installmentsCount));

  if (normalizedPrincipal <= 0 || normalizedCount <= 0 || normalizedRate < 0) {
    return null;
  }

  const rate = normalizedRate / 100;
  const payment = calculatePricePayment(normalizedPrincipal, rate, normalizedCount);
  if (payment <= 0) return null;

  let remainingPrincipal = normalizedPrincipal;
  const schedule: PriceScheduleEntry[] = [];

  for (let installmentNumber = 1; installmentNumber <= normalizedCount; installmentNumber += 1) {
    let expectedInterest = rate > 0 ? round2(remainingPrincipal * rate) : 0;
    let expectedPrincipal = round2(payment - expectedInterest);

    if (installmentNumber === normalizedCount) {
      expectedPrincipal = round2(remainingPrincipal);
      expectedInterest = round2(Math.max(payment - expectedPrincipal, 0));
    } else {
      if (expectedPrincipal < 0) expectedPrincipal = 0;
      if (expectedPrincipal > remainingPrincipal) {
        expectedPrincipal = round2(remainingPrincipal);
        expectedInterest = round2(Math.max(payment - expectedPrincipal, 0));
      }
    }

    remainingPrincipal = round2(Math.max(remainingPrincipal - expectedPrincipal, 0));

    schedule.push({
      installmentNumber,
      total: round2(expectedPrincipal + expectedInterest),
      expectedPrincipal,
      expectedInterest,
    });
  }

  return schedule;
};

export const canMigratePrice = (
  loan: LegacyLoanLike,
  installment: LegacyInstallmentLike,
  installmentIndex: number,
): PriceMigrateCheck => {
  const reasonCodes: BreakdownMigrationReasonCode[] = [];
  const principal = safePositive(loan.amount);
  const interestRate = toNumber(loan.interestRate);
  const installmentsCount = resolveInstallmentsCount(loan);
  const installmentNumber = resolveInstallmentNumber(installment, installmentIndex);
  const paidAmount = resolveInstallmentPaidAmount(installment);

  if (principal <= 0) reasonCodes.push('missing_total_amount');
  if (!Number.isFinite(interestRate) || interestRate < 0) reasonCodes.push('invalid_interest_rate');
  if (!Number.isFinite(installmentsCount) || installmentsCount <= 0) {
    reasonCodes.push('missing_installments_count');
  }
  if (installmentNumber === null || !Number.isFinite(installmentNumber) || installmentNumber <= 0) {
    reasonCodes.push('invalid_installment_number');
  } else if (installmentsCount > 0 && installmentNumber > installmentsCount) {
    reasonCodes.push('installment_number_out_of_range');
  }
  if (paidAmount <= 0) reasonCodes.push('no_paid_amount');

  if (reasonCodes.length > 0) {
    const requiresReview = reasonCodes.includes('installment_number_out_of_range');
    return {
      isMigratable: false,
      requiresReview,
      reasonCodes,
      principal,
      interestRate,
      installmentsCount,
      installmentNumber,
      paidAmount,
    };
  }

  const schedule = buildPriceSchedule(principal, interestRate, installmentsCount);
  if (!schedule || schedule.length === 0) {
    return {
      isMigratable: false,
      requiresReview: true,
      reasonCodes: ['unable_to_build_price_schedule'],
      principal,
      interestRate,
      installmentsCount,
      installmentNumber,
      paidAmount,
    };
  }

  return {
    isMigratable: true,
    requiresReview: false,
    reasonCodes: [],
    principal,
    interestRate,
    installmentsCount,
    installmentNumber,
    paidAmount,
  };
};

const allocateByComposition = (
  paidAmount: number,
  expectedPrincipal: number,
  expectedInterest: number,
): Pick<PaymentBreakdown, 'principalPaid' | 'interestPaid'> => {
  const safePaidAmount = safePositive(paidAmount);
  const safeExpectedPrincipal = safePositive(expectedPrincipal);
  const safeExpectedInterest = safePositive(expectedInterest);
  const expectedTotal = round2(safeExpectedPrincipal + safeExpectedInterest);

  if (safePaidAmount <= 0 || expectedTotal <= 0) {
    return {
      principalPaid: 0,
      interestPaid: 0,
    };
  }

  const isExactPayment = Math.abs(safePaidAmount - expectedTotal) <= 0.01;
  if (isExactPayment) {
    return {
      principalPaid: safeExpectedPrincipal,
      interestPaid: safeExpectedInterest,
    };
  }

  const factor = safePaidAmount / expectedTotal;
  let principalPaid = round2(Math.min(safeExpectedPrincipal * factor, safePaidAmount));
  let interestPaid = round2(Math.max(safePaidAmount - principalPaid, 0));

  if (interestPaid < 0) {
    principalPaid = safePaidAmount;
    interestPaid = 0;
  }

  return { principalPaid, interestPaid };
};

export const buildLegacySimpleBreakdown = (
  loan: LegacyLoanLike,
  installment: LegacyInstallmentLike,
): LegacyBreakdownBuildResult | null => {
  const check = canMigrateSimple(loan, installment);
  if (!check.isMigratable) return null;

  const totalAmount = safePositive(loan.amount);
  const totalReceivable = resolveLoanTotalReceivable(loan);
  const paidAmount = check.paidAmount;
  const lucroTotal = round2(Math.max(totalReceivable - totalAmount, 0));
  const interestRatio = totalReceivable > 0 ? Math.min(Math.max(lucroTotal / totalReceivable, 0), 1) : 0;

  const interestPaid = round2(paidAmount * interestRatio);
  const principalPaid = round2(Math.max(paidAmount - interestPaid, 0));

  return {
    paymentBreakdown: {
      principalPaid,
      interestPaid,
      lateFeePaid: 0,
      serviceFeePaid: 0,
      discountApplied: 0,
      totalPaid: paidAmount,
    },
    breakdownSource: 'migrated_simple_ratio',
    needsFiscalReview: false,
    reasonCodes: [],
  };
};

export const buildLegacyPriceBreakdown = (
  loan: LegacyLoanLike,
  installment: LegacyInstallmentLike,
  installmentIndex: number,
  allowEstimatedFallback: boolean,
): LegacyBreakdownBuildResult | null => {
  const check = canMigratePrice(loan, installment, installmentIndex);
  if (!check.isMigratable) {
    if (!allowEstimatedFallback) return null;

    const simpleFallback = buildLegacySimpleBreakdown(loan, installment);
    if (!simpleFallback) return null;

    return {
      ...simpleFallback,
      breakdownSource: 'estimated_price_fallback',
      needsFiscalReview: true,
      reasonCodes: ['price_estimated_fallback', ...(check.reasonCodes.length > 0 ? check.reasonCodes : [])],
    };
  }

  const schedule = buildPriceSchedule(check.principal, check.interestRate, check.installmentsCount);
  if (!schedule || !check.installmentNumber) {
    if (!allowEstimatedFallback) return null;

    const fallback = buildLegacySimpleBreakdown(loan, installment);
    if (!fallback) return null;

    return {
      ...fallback,
      breakdownSource: 'estimated_price_fallback',
      needsFiscalReview: true,
      reasonCodes: ['unable_to_build_price_schedule', 'price_estimated_fallback'],
    };
  }

  const scheduleEntry = schedule[check.installmentNumber - 1];
  if (!scheduleEntry) {
    if (!allowEstimatedFallback) return null;

    const fallback = buildLegacySimpleBreakdown(loan, installment);
    if (!fallback) return null;

    return {
      ...fallback,
      breakdownSource: 'estimated_price_fallback',
      needsFiscalReview: true,
      reasonCodes: ['installment_number_out_of_range', 'price_estimated_fallback'],
    };
  }

  const expectedPrincipal = safePositive(installment.expectedPrincipal) || scheduleEntry.expectedPrincipal;
  const expectedInterest = safePositive(installment.expectedInterest) || scheduleEntry.expectedInterest;
  const paidAmount = check.paidAmount;
  const allocation = allocateByComposition(paidAmount, expectedPrincipal, expectedInterest);

  return {
    paymentBreakdown: {
      principalPaid: allocation.principalPaid,
      interestPaid: allocation.interestPaid,
      lateFeePaid: 0,
      serviceFeePaid: 0,
      discountApplied: 0,
      totalPaid: paidAmount,
    },
    breakdownSource: 'migrated_price_schedule',
    needsFiscalReview: false,
    reasonCodes: [],
    expectedPrincipal,
    expectedInterest,
  };
};

export const classifyLegacyInstallment = (
  loan: LegacyLoanLike,
  installment: LegacyInstallmentLike,
  installmentIndex: number,
  hasLinkedEstorno = false,
): LegacyInstallmentClassification => {
  const installmentNumber = resolveInstallmentNumber(installment, installmentIndex);
  const paidAmount = resolveInstallmentPaidAmount(installment);
  const loanType = detectLoanType(loan);
  const existingBreakdown = hasPaymentBreakdown(installment);

  if (existingBreakdown) {
    return {
      category: 'SKIP_ALREADY_HAS_BREAKDOWN',
      reasonCodes: ['already_has_breakdown'],
      loanType,
      paidAmount,
      installmentNumber,
      hasPaymentBreakdown: true,
    };
  }

  if (paidAmount <= 0) {
    return {
      category: 'SKIP_NO_PAYMENT',
      reasonCodes: ['no_paid_amount'],
      loanType,
      paidAmount,
      installmentNumber,
      hasPaymentBreakdown: false,
    };
  }

  if (hasLinkedEstorno) {
    return {
      category: 'REVIEW_REQUIRED',
      reasonCodes: ['linked_estorno_detected'],
      loanType,
      paidAmount,
      installmentNumber,
      hasPaymentBreakdown: false,
    };
  }

  if (loanType === null) {
    return {
      category: 'REVIEW_REQUIRED',
      reasonCodes: ['unsupported_interest_type'],
      loanType: null,
      paidAmount,
      installmentNumber,
      hasPaymentBreakdown: false,
    };
  }

  if (loanType === 'SIMPLE') {
    const simpleCheck = canMigrateSimple(loan, installment);
    if (simpleCheck.isMigratable) {
      return {
        category: 'MIGRATABLE_SIMPLE',
        reasonCodes: [],
        loanType,
        paidAmount,
        installmentNumber,
        hasPaymentBreakdown: false,
      };
    }

    return {
      category: 'SKIP_INSUFFICIENT_DATA',
      reasonCodes: simpleCheck.reasonCodes.length > 0 ? simpleCheck.reasonCodes : ['missing_total_receivable'],
      loanType,
      paidAmount,
      installmentNumber,
      hasPaymentBreakdown: false,
    };
  }

  const priceCheck = canMigratePrice(loan, installment, installmentIndex);
  if (priceCheck.isMigratable) {
    return {
      category: 'MIGRATABLE_PRICE',
      reasonCodes: [],
      loanType,
      paidAmount,
      installmentNumber,
      hasPaymentBreakdown: false,
    };
  }

  if (priceCheck.requiresReview) {
    return {
      category: 'REVIEW_REQUIRED',
      reasonCodes: priceCheck.reasonCodes.length > 0 ? priceCheck.reasonCodes : ['price_requires_manual_review'],
      loanType,
      paidAmount,
      installmentNumber,
      hasPaymentBreakdown: false,
    };
  }

  return {
    category: 'SKIP_INSUFFICIENT_DATA',
    reasonCodes: priceCheck.reasonCodes.length > 0 ? priceCheck.reasonCodes : ['missing_installments_count'],
    loanType,
    paidAmount,
    installmentNumber,
    hasPaymentBreakdown: false,
  };
};

