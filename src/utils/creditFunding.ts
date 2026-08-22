import type { FundingSourceType } from '../types';

export type BancarizedCashEvent = 'LOAN_FUNDED' | 'INSTALLMENT_PAID' | 'INVESTOR_REPAID';

export const resolveBancarizedCashDelta = (
  fundingSource: FundingSourceType,
  event: BancarizedCashEvent,
  amount: number,
): number => {
  const safeAmount = Number.isFinite(Number(amount)) ? Math.abs(Number(amount)) : 0;
  if (fundingSource !== 'GR' || safeAmount === 0) return 0;
  if (event === 'LOAN_FUNDED') return -safeAmount;
  if (event === 'INVESTOR_REPAID') return safeAmount;
  return 0;
};
