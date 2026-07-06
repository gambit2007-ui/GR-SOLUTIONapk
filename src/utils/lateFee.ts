import type { Installment } from '../types';
import { installmentAmount, normalizeInstallmentStatus } from './loanCompat';

export const DEFAULT_DAILY_LATE_FEE_RATE = 0.015;

export const normalizeDailyLateFeeRate = (value: unknown): number => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return DEFAULT_DAILY_LATE_FEE_RATE;
  return parsed;
};

const roundMoney = (value: number): number =>
  Number((Number.isFinite(value) ? value : 0).toFixed(2));

export const calculateInstallmentLateFee = (
  installment: Installment | null | undefined,
  referenceDate = new Date(),
  dailyLateFeeRate = DEFAULT_DAILY_LATE_FEE_RATE,
): number => {
  if (!installment || normalizeInstallmentStatus(installment.status) === 'PAID') return 0;

  const carriedLateFee = Math.max(roundMoney(Number(installment.carriedLateFee || 0)), 0);
  const baseAmount = installmentAmount(installment);
  if (!Number.isFinite(baseAmount) || baseAmount <= 0 || !installment.dueDate) {
    return carriedLateFee;
  }

  const dueDate = new Date(`${installment.dueDate}T00:00:00`);
  if (Number.isNaN(dueDate.getTime())) return carriedLateFee;

  const today = new Date(referenceDate);
  today.setHours(0, 0, 0, 0);
  if (dueDate >= today) return carriedLateFee;

  const diffDays = Math.floor((today.getTime() - dueDate.getTime()) / (24 * 60 * 60 * 1000));
  if (diffDays <= 0) return carriedLateFee;

  const accruedLateFee = roundMoney(baseAmount * normalizeDailyLateFeeRate(dailyLateFeeRate) * diffDays);
  return roundMoney(carriedLateFee + accruedLateFee);
};
