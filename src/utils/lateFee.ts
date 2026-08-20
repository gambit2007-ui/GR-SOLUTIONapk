import type { Installment } from '../types';
import { installmentAmount, installmentPaidAmount, normalizeInstallmentStatus } from './loanCompat';

export const DEFAULT_DAILY_LATE_FEE_RATE = 0.015;

export const normalizeDailyLateFeeRate = (value: unknown): number => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return DEFAULT_DAILY_LATE_FEE_RATE;
  return parsed;
};

const roundMoney = (value: number): number =>
  Number((Number.isFinite(value) ? value : 0).toFixed(2));

const DAY_IN_MS = 24 * 60 * 60 * 1000;

const toCalendarDay = (value: string | Date): number | null => {
  const date = value instanceof Date ? new Date(value) : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
};

interface LateFeeEvent {
  day: number;
  baseDelta: number;
  lateFeeDelta: number;
}

const getLateFeeEvents = (installment: Installment): LateFeeEvent[] => {
  const entries = Array.isArray(installment.paymentEntries) ? installment.paymentEntries : [];
  if (entries.length > 0) {
    return entries
      .map((entry) => {
        const day = toCalendarDay(entry.recordedAt);
        if (day === null) return null;
        return {
          day,
          baseDelta: roundMoney(
            Number(entry.principalPaid || 0) +
            Number(entry.interestPaid || 0) +
            Number(entry.discountApplied || 0),
          ),
          lateFeeDelta: roundMoney(Number(entry.lateFeePaid || 0)),
        };
      })
      .filter((event): event is LateFeeEvent => event !== null)
      .sort((a, b) => a.day - b.day);
  }

  const paymentDate = installment.lastPaymentDate || installment.paymentDate || installment.paidAt;
  const paymentDay = paymentDate ? toCalendarDay(paymentDate) : null;
  if (paymentDay === null) return [];

  if (installment.paymentBreakdown) {
    return [{
      day: paymentDay,
      baseDelta: roundMoney(
        Number(installment.paymentBreakdown.principalPaid || 0) +
        Number(installment.paymentBreakdown.interestPaid || 0) +
        Number(installment.paymentBreakdown.discountApplied || 0),
      ),
      lateFeeDelta: roundMoney(Number(installment.paymentBreakdown.lateFeePaid || 0)),
    }];
  }

  const paid = roundMoney(installmentPaidAmount(installment));
  return paid > 0 ? [{ day: paymentDay, baseDelta: paid, lateFeeDelta: 0 }] : [];
};

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

  const dueDay = toCalendarDay(`${installment.dueDate}T12:00:00`);
  const referenceDay = toCalendarDay(referenceDate);
  if (dueDay === null || referenceDay === null) return carriedLateFee;

  let outstandingBase = roundMoney(baseAmount);
  let outstandingLateFee = carriedLateFee;
  let cursorDay = dueDay;
  const rate = normalizeDailyLateFeeRate(dailyLateFeeRate);

  getLateFeeEvents(installment).forEach((event) => {
    if (event.day > referenceDay) return;
    const eventDay = Math.max(event.day, dueDay);
    if (eventDay > cursorDay && outstandingBase > 0) {
      const days = Math.floor((eventDay - cursorDay) / DAY_IN_MS);
      outstandingLateFee = roundMoney(outstandingLateFee + (outstandingBase * rate * days));
    }
    outstandingBase = roundMoney(Math.max(outstandingBase - event.baseDelta, 0));
    outstandingLateFee = roundMoney(Math.max(outstandingLateFee - event.lateFeeDelta, 0));
    cursorDay = Math.max(cursorDay, eventDay);
  });

  if (referenceDay > cursorDay && outstandingBase > 0) {
    const days = Math.floor((referenceDay - cursorDay) / DAY_IN_MS);
    outstandingLateFee = roundMoney(outstandingLateFee + (outstandingBase * rate * days));
  }

  return roundMoney(Math.max(outstandingLateFee, 0));
};
