import { InterestType, LoanType, PaymentBreakdown } from '../types';

interface PaymentBreakdownLoanInput {
  id: string;
  type: LoanType | InterestType | string;
  totalAmount: number;
  totalReceivable: number;
}

interface PaymentBreakdownInstallmentInput {
  id?: string;
  amount: number;
  expectedPrincipal?: number;
  expectedInterest?: number;
}

export interface BuildPaymentBreakdownParams {
  loan: PaymentBreakdownLoanInput;
  installment: PaymentBreakdownInstallmentInput;
  paidAmount?: number;
  lateFeePaid?: number;
  serviceFeePaid?: number;
  discountApplied?: number;
}

export interface BuildPaymentBreakdownResult extends PaymentBreakdown {
  needsFiscalReview?: boolean;
}

interface BreakdownBaseValues {
  paidAmount: number;
  lateFeePaid: number;
  serviceFeePaid: number;
  discountApplied: number;
  basePaidForPrincipalAndInterest: number;
}

const toSafeNumber = (value: unknown, fallback = 0): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export const round2 = (value: number): number => Number(toSafeNumber(value).toFixed(2));

const clamp = (value: number, min: number, max: number): number => {
  if (value < min) return min;
  if (value > max) return max;
  return value;
};

const normalizeLoanType = (value: unknown): LoanType => {
  const normalized = String(value ?? '').trim().toUpperCase();
  return normalized === 'PRICE' ? 'PRICE' : 'SIMPLE';
};

const buildBaseValues = (params: BuildPaymentBreakdownParams): BreakdownBaseValues => {
  const fallbackPaid = toSafeNumber(params.installment.amount, 0);
  const paidAmount = round2(Math.max(toSafeNumber(params.paidAmount, fallbackPaid), 0));
  const lateFeePaid = round2(Math.max(toSafeNumber(params.lateFeePaid, 0), 0));
  const serviceFeePaid = round2(Math.max(toSafeNumber(params.serviceFeePaid, 0), 0));
  const discountApplied = round2(Math.max(toSafeNumber(params.discountApplied, 0), 0));
  const basePaidForPrincipalAndInterest = round2(Math.max(paidAmount - lateFeePaid - serviceFeePaid, 0));

  return {
    paidAmount,
    lateFeePaid,
    serviceFeePaid,
    discountApplied,
    basePaidForPrincipalAndInterest,
  };
};

export const buildSimpleBreakdown = (params: BuildPaymentBreakdownParams): BuildPaymentBreakdownResult => {
  const base = buildBaseValues(params);
  const totalAmount = Math.max(round2(params.loan.totalAmount), 0);
  const totalReceivable = Math.max(round2(params.loan.totalReceivable), 0);
  const lucroTotal = Math.max(round2(totalReceivable - totalAmount), 0);
  const interestRatio = totalReceivable > 0 ? clamp(lucroTotal / totalReceivable, 0, 1) : 0;

  const interestPaid = round2(base.basePaidForPrincipalAndInterest * interestRatio);
  const principalPaid = round2(Math.max(base.basePaidForPrincipalAndInterest - interestPaid, 0));

  return {
    principalPaid,
    interestPaid,
    lateFeePaid: base.lateFeePaid,
    serviceFeePaid: base.serviceFeePaid,
    discountApplied: base.discountApplied,
    totalPaid: base.paidAmount,
  };
};

export const buildPriceBreakdown = (params: BuildPaymentBreakdownParams): BuildPaymentBreakdownResult => {
  const base = buildBaseValues(params);
  const expectedPrincipal = Math.max(round2(params.installment.expectedPrincipal ?? 0), 0);
  const expectedInterest = Math.max(round2(params.installment.expectedInterest ?? 0), 0);
  const expectedTotal = round2(expectedPrincipal + expectedInterest);

  if (expectedTotal > 0) {
    const isExactPayment = Math.abs(base.basePaidForPrincipalAndInterest - expectedTotal) <= 0.01;

    if (isExactPayment) {
      return {
        principalPaid: expectedPrincipal,
        interestPaid: expectedInterest,
        lateFeePaid: base.lateFeePaid,
        serviceFeePaid: base.serviceFeePaid,
        discountApplied: base.discountApplied,
        totalPaid: base.paidAmount,
      };
    }

    const proportionalFactor = Math.max(base.basePaidForPrincipalAndInterest / expectedTotal, 0);
    let principalPaid = round2(expectedPrincipal * proportionalFactor);
    principalPaid = round2(Math.min(principalPaid, base.basePaidForPrincipalAndInterest));
    let interestPaid = round2(Math.max(base.basePaidForPrincipalAndInterest - principalPaid, 0));

    if (interestPaid < 0) {
      interestPaid = 0;
      principalPaid = round2(base.basePaidForPrincipalAndInterest);
    }

    return {
      principalPaid,
      interestPaid,
      lateFeePaid: base.lateFeePaid,
      serviceFeePaid: base.serviceFeePaid,
      discountApplied: base.discountApplied,
      totalPaid: base.paidAmount,
    };
  }

  return {
    ...buildSimpleBreakdown(params),
    needsFiscalReview: true,
  };
};

export const buildPaymentBreakdown = (params: BuildPaymentBreakdownParams): BuildPaymentBreakdownResult => {
  const loanType = normalizeLoanType(params.loan.type);
  if (loanType === 'PRICE') {
    return buildPriceBreakdown(params);
  }
  return buildSimpleBreakdown(params);
};

