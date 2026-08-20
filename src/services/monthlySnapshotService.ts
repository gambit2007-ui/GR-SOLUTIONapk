import {
  collection,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
} from 'firebase/firestore';
import { db } from '../firebase';
import type { MonthlySnapshot } from '../types';
import { sanitizeFirestorePayload } from '../utils/firestoreSanitizer';
import { canCloseMonth } from '../utils/dateTime';

export type MonthlySnapshotInput = Omit<MonthlySnapshot, 'id' | 'createdAt' | 'updatedAt'>;

const roundMoney = (value: number): number =>
  Number((Number.isFinite(value) ? value : 0).toFixed(2));

const toNumber = (value: unknown): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const toOptionalString = (value: unknown): string | undefined => {
  const parsed = String(value ?? '').trim();
  return parsed.length > 0 ? parsed : undefined;
};

export const generateMonthlySnapshot = (input: MonthlySnapshotInput): MonthlySnapshot => ({
  id: input.month,
  month: input.month,
  openingCash: roundMoney(input.openingCash),
  closingCash: roundMoney(input.closingCash),
  totalIncome: roundMoney(input.totalIncome),
  totalExpense: roundMoney(input.totalExpense),
  principalReceived: roundMoney(input.principalReceived),
  interestReceived: roundMoney(input.interestReceived),
  lateFeesReceived: roundMoney(input.lateFeesReceived),
  serviceFeesReceived: roundMoney(input.serviceFeesReceived),
  realProfit: roundMoney(input.realProfit),
  lentAmount: roundMoney(input.lentAmount),
  roi: Number((Number.isFinite(input.roi) ? input.roi : 0).toFixed(2)),
  movementCount: Math.max(0, Math.trunc(toNumber(input.movementCount))),
  createdLoansCount: Math.max(0, Math.trunc(toNumber(input.createdLoansCount))),
  totalReceived: roundMoney(toNumber(input.totalReceived)),
  projectedReceipts: roundMoney(toNumber(input.projectedReceipts)),
  projectedProfit: roundMoney(toNumber(input.projectedProfit)),
  manualWithdrawals: roundMoney(toNumber(input.manualWithdrawals)),
  loanOutflows: roundMoney(toNumber(input.loanOutflows)),
  reversals: roundMoney(toNumber(input.reversals)),
  overdueAmount: roundMoney(toNumber(input.overdueAmount)),
  outflowCategoryTotals: input.outflowCategoryTotals,
  schemaVersion: 2,
  status: 'CLOSED',
  closedByUid: toOptionalString(input.closedByUid),
});

export const parseMonthlySnapshot = (id: string, raw: unknown): MonthlySnapshot => {
  const payload = typeof raw === 'object' && raw !== null ? raw as Record<string, unknown> : {};
  return {
    id,
    month: String(payload.month || id),
    openingCash: roundMoney(toNumber(payload.openingCash)),
    closingCash: roundMoney(toNumber(payload.closingCash)),
    totalIncome: roundMoney(toNumber(payload.totalIncome)),
    totalExpense: roundMoney(toNumber(payload.totalExpense)),
    principalReceived: roundMoney(toNumber(payload.principalReceived)),
    interestReceived: roundMoney(toNumber(payload.interestReceived)),
    lateFeesReceived: roundMoney(toNumber(payload.lateFeesReceived)),
    serviceFeesReceived: roundMoney(toNumber(payload.serviceFeesReceived)),
    realProfit: roundMoney(toNumber(payload.realProfit)),
    lentAmount: roundMoney(toNumber(payload.lentAmount)),
    roi: Number(toNumber(payload.roi).toFixed(2)),
    movementCount: Math.max(0, Math.trunc(toNumber(payload.movementCount))),
    createdLoansCount: Math.max(0, Math.trunc(toNumber(payload.createdLoansCount))),
    totalReceived: payload.totalReceived === undefined ? undefined : roundMoney(toNumber(payload.totalReceived)),
    projectedReceipts: payload.projectedReceipts === undefined ? undefined : roundMoney(toNumber(payload.projectedReceipts)),
    projectedProfit: payload.projectedProfit === undefined ? undefined : roundMoney(toNumber(payload.projectedProfit)),
    manualWithdrawals: payload.manualWithdrawals === undefined ? undefined : roundMoney(toNumber(payload.manualWithdrawals)),
    loanOutflows: payload.loanOutflows === undefined ? undefined : roundMoney(toNumber(payload.loanOutflows)),
    reversals: payload.reversals === undefined ? undefined : roundMoney(toNumber(payload.reversals)),
    overdueAmount: payload.overdueAmount === undefined ? undefined : roundMoney(toNumber(payload.overdueAmount)),
    outflowCategoryTotals:
      typeof payload.outflowCategoryTotals === 'object' && payload.outflowCategoryTotals !== null
        ? payload.outflowCategoryTotals as MonthlySnapshot['outflowCategoryTotals']
        : undefined,
    schemaVersion: Math.max(1, Math.trunc(toNumber(payload.schemaVersion) || 1)),
    status: payload.status === 'CLOSED' ? 'CLOSED' : undefined,
    closedAt: payload.closedAt as MonthlySnapshot['closedAt'],
    createdAt: payload.createdAt as MonthlySnapshot['createdAt'],
    updatedAt: payload.updatedAt as MonthlySnapshot['updatedAt'],
    closedByUid: toOptionalString(payload.closedByUid),
  };
};

export const saveMonthlySnapshot = async (snapshot: MonthlySnapshot): Promise<void> => {
  if (!canCloseMonth(snapshot.month)) throw new Error('MES_ATUAL_OU_FUTURO_NAO_PODE_SER_FECHADO');
  const snapshotRef = doc(db, 'monthlySnapshots', snapshot.month);
  const { id: _id, ...snapshotPayload } = snapshot;
  await runTransaction(db, async (tx) => {
    const existingSnapshot = await tx.get(snapshotRef);
    if (existingSnapshot.exists()) throw new Error('MES_JA_FECHADO');
    tx.set(snapshotRef, sanitizeFirestorePayload({
      ...snapshotPayload,
      schemaVersion: 2,
      status: 'CLOSED',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      closedAt: serverTimestamp(),
    }));
  });
};

export const getMonthlySnapshot = async (month: string): Promise<MonthlySnapshot | null> => {
  const snapshot = await getDoc(doc(db, 'monthlySnapshots', month));
  return snapshot.exists() ? parseMonthlySnapshot(snapshot.id, snapshot.data()) : null;
};

export const listMonthlySnapshots = async (): Promise<MonthlySnapshot[]> => {
  const snapshot = await getDocs(query(collection(db, 'monthlySnapshots'), orderBy('month', 'desc')));
  return snapshot.docs.map((docSnap) => parseMonthlySnapshot(docSnap.id, docSnap.data()));
};
