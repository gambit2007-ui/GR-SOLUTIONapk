import {
  CashMovement,
  CashMovementType,
  Customer,
  Frequency,
  Installment,
  InstallmentStatus,
  InterestType,
  Loan,
  LoanStatus,
} from '../types';
import { getLocalISODate } from './dateTime';

const CASH_MOVEMENT_TYPES: readonly CashMovementType[] = [
  'APORTE',
  'RETIRADA',
  'PAGAMENTO',
  'ESTORNO',
  'ENTRADA',
  'SAIDA',
];

const ENTRY_MOVEMENT_TYPES = new Set<CashMovementType>(['APORTE', 'PAGAMENTO', 'ENTRADA']);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const toNumber = (value: unknown, fallback = 0): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const toString = (value: unknown, fallback = ''): string => {
  const parsed = String(value ?? '').trim();
  return parsed.length > 0 ? parsed : fallback;
};

const toOptionalString = (value: unknown): string | undefined => {
  const parsed = String(value ?? '').trim();
  return parsed.length > 0 ? parsed : undefined;
};

export const parseMovementType = (value: unknown): CashMovementType => {
  const normalized = String(value ?? '').trim().toUpperCase() as CashMovementType;
  return CASH_MOVEMENT_TYPES.includes(normalized) ? normalized : 'ENTRADA';
};

export const parseCashMovement = (id: string, raw: unknown): CashMovement => {
  const payload = isRecord(raw) ? raw : {};
  const amount = Math.abs(toNumber(payload.amount ?? payload.value, 0));
  const type = parseMovementType(payload.type);
  const fallbackDate = new Date().toISOString();
  const date = toString(payload.date, fallbackDate);
  const description = toString(payload.description, 'MOVIMENTACAO');

  return {
    id,
    type,
    amount,
    value: amount,
    description,
    date,
    loanId: toOptionalString(payload.loanId),
    createdByUid: toOptionalString(payload.createdByUid),
    createdByEmail: toOptionalString(payload.createdByEmail),
    createdByName: toOptionalString(payload.createdByName),
  };
};

export const parseInstallmentStatus = (value: unknown): InstallmentStatus => {
  const normalized = String(value ?? '').trim().toUpperCase();
  if (normalized === 'PAGO' || normalized === 'PAID') return 'PAGO';
  if (normalized === 'ATRASADO' || normalized === 'OVERDUE') return 'ATRASADO';
  return 'PENDENTE';
};

const parseFrequency = (value: unknown): Frequency => {
  const normalized = String(value ?? '').trim().toUpperCase();
  if (normalized === 'DIARIO' || normalized === 'DAILY') return 'DIARIO';
  if (normalized === 'SEMANAL' || normalized === 'WEEKLY') return 'SEMANAL';
  if (normalized === 'QUINZENAL' || normalized === 'BIWEEKLY') return 'QUINZENAL';
  return 'MENSAL';
};

const parseInterestType = (value: unknown): InterestType => {
  const normalized = String(value ?? '').trim().toUpperCase();
  if (normalized === 'PRICE') return 'PRICE';
  if (normalized === 'SPLIT') return 'SPLIT';
  if (normalized === 'SIMPLE') return 'SIMPLE';
  return 'SIMPLES';
};

const parseLoanStatus = (value: unknown): LoanStatus => {
  const normalized = String(value ?? '').trim().toUpperCase();
  if (normalized === 'CANCELADO' || normalized === 'CANCELLED') return 'CANCELADO';
  if (normalized === 'QUITADO' || normalized === 'COMPLETED') return 'QUITADO';
  if (normalized === 'ATRASADO' || normalized === 'OVERDUE') return 'ATRASADO';
  return 'ATIVO';
};

export const normalizeInstallment = (raw: unknown, fallbackNumber = 1): Installment => {
  const payload = isRecord(raw) ? raw : {};
  const amount = toNumber(payload.amount ?? payload.value, 0);
  const paidAmount = toNumber(payload.paidAmount ?? payload.partialPaid, 0);

  return {
    id: toOptionalString(payload.id),
    number: Math.max(1, Math.trunc(toNumber(payload.number, fallbackNumber))),
    amount,
    value: amount,
    dueDate: toString(payload.dueDate, getLocalISODate()),
    status: parseInstallmentStatus(payload.status),
    paymentDate: toOptionalString(payload.paymentDate ?? payload.paidAt ?? payload.lastPaymentDate),
    paidAt: toOptionalString(payload.paidAt),
    lastPaymentDate: toOptionalString(payload.lastPaymentDate),
    partialPaid: paidAmount,
    paidAmount,
    lastPaidValue: toNumber(payload.lastPaidValue, 0) || undefined,
    originalValue: toNumber(payload.originalValue, 0) || undefined,
  };
};

export const parseLoan = (id: string, raw: unknown): Loan => {
  const payload = isRecord(raw) ? raw : {};
  const installmentsRaw = Array.isArray(payload.installments) ? payload.installments : [];
  const installments = installmentsRaw.map((installment, index) => normalizeInstallment(installment, index + 1));
  const installmentsCount = Math.max(
    0,
    Math.trunc(toNumber(payload.installmentsCount ?? payload.installmentCount, installments.length)),
  );
  const amount = toNumber(payload.amount, 0);
  const interestRate = toNumber(payload.interestRate, 0);

  return {
    id,
    contractNumber: toOptionalString(payload.contractNumber),
    customerId: toString(payload.customerId, ''),
    customerName: toString(payload.customerName, ''),
    customerPhone: toOptionalString(payload.customerPhone),
    amount,
    interestRate,
    installmentCount: installmentsCount,
    installmentsCount,
    frequency: parseFrequency(payload.frequency),
    interestType: parseInterestType(payload.interestType),
    monthlyPaidInterestRate: toNumber(payload.monthlyPaidInterestRate, 0) || undefined,
    monthlyAccruedInterestRate: toNumber(payload.monthlyAccruedInterestRate, 0) || undefined,
    totalToReturn: toNumber(payload.totalToReturn, 0) || undefined,
    installmentValue: toNumber(payload.installmentValue, 0) || undefined,
    startDate: toString(payload.startDate, getLocalISODate()),
    dueDate: toOptionalString(payload.dueDate),
    createdAt: payload.createdAt as Loan['createdAt'],
    notes: toOptionalString(payload.notes),
    installments,
    status: parseLoanStatus(payload.status),
    paidAmount: toNumber(payload.paidAmount, 0) || undefined,
  };
};

export const parseCustomer = (id: string, raw: unknown): Customer => {
  const payload = isRecord(raw) ? raw : {};

  return {
    id,
    name: toString(payload.name, ''),
    cpf: toOptionalString(payload.cpf),
    rg: toOptionalString(payload.rg),
    email: toOptionalString(payload.email),
    phone: toOptionalString(payload.phone),
    address: toOptionalString(payload.address),
    notes: toOptionalString(payload.notes),
    observations: toOptionalString(payload.observations),
    avatar: toOptionalString(payload.avatar),
    photoUrl: toOptionalString(payload.photoUrl),
    birthDate: toOptionalString(payload.birthDate),
    documents: Array.isArray(payload.documents)
      ? payload.documents.filter(isRecord).map((docItem) => ({
          id: toOptionalString(docItem.id),
          name: toString(docItem.name, ''),
          type: toString(docItem.type, ''),
          data: toOptionalString(docItem.data),
          url: toOptionalString(docItem.url),
          uploadedAt: toOptionalString(docItem.uploadedAt),
        }))
      : undefined,
    createdAt: toNumber(payload.createdAt, 0) || undefined,
  };
};

export const isInstallmentOverdue = (installment: Installment, todayIso = getLocalISODate()): boolean => {
  const status = parseInstallmentStatus(installment.status);
  if (status === 'PAGO') return false;
  return installment.dueDate < todayIso;
};

export const resolveCashDelta = (movement: CashMovement): number => {
  const amount = toNumber(movement.amount ?? movement.value, 0);
  if (amount === 0) return 0;

  // Compatibilidade: movimentacoes antigas podem estar com valor negativo.
  if (amount < 0) return amount;

  return ENTRY_MOVEMENT_TYPES.has(parseMovementType(movement.type)) ? amount : -amount;
};
