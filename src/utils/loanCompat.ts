import { Installment, Loan } from '../types';

type NormalizedLoanStatus = 'ACTIVE' | 'COMPLETED' | 'CANCELLED';
type NormalizedInstallmentStatus = 'PENDING' | 'PAID' | 'OVERDUE';

const normalizeText = (value: unknown) =>
  String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .trim();

export const normalizeLoanStatus = (status: unknown): NormalizedLoanStatus => {
  const normalized = normalizeText(status);

  if (normalized === 'CANCELLED' || normalized === 'CANCELADO') return 'CANCELLED';
  if (
    normalized === 'COMPLETED' ||
    normalized === 'QUITADO' ||
    normalized === 'CONCLUIDO' ||
    normalized === 'LIQUIDADO'
  ) {
    return 'COMPLETED';
  }

  return 'ACTIVE';
};

export const normalizeInstallmentStatus = (status: unknown): NormalizedInstallmentStatus => {
  const normalized = normalizeText(status);

  if (normalized === 'PAID' || normalized === 'PAGO' || normalized === 'LIQUIDADO') return 'PAID';
  if (normalized === 'OVERDUE' || normalized === 'ATRASADO') return 'OVERDUE';

  return 'PENDING';
};

export const installmentAmount = (inst?: Partial<Installment> | null): number => {
  if (!inst) return 0;
  const value = Number((inst as any).amount ?? (inst as any).value ?? 0);
  return Number.isFinite(value) ? value : 0;
};

export const installmentPaidAmount = (inst?: Partial<Installment> | null): number => {
  if (!inst) return 0;
  const paidAmount = Number((inst as any).paidAmount ?? 0);
  const partialPaid = Number((inst as any).partialPaid ?? 0);
  const resolved = paidAmount > 0 ? paidAmount : partialPaid;
  return Number.isFinite(resolved) ? resolved : 0;
};

export const loanInstallmentsCount = (loan?: Partial<Loan> | null): number => {
  if (!loan) return 0;
  const count = Number((loan as any).installmentsCount ?? (loan as any).installmentCount ?? 0);
  if (Number.isFinite(count) && count > 0) return count;
  const installments = Array.isArray((loan as any).installments) ? (loan as any).installments : [];
  return installments.length;
};


