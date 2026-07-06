import {
  collection,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
} from 'firebase/firestore';
import { db } from '../firebase';
import type { MonthlySnapshot } from '../types';
import { sanitizeFirestorePayload } from '../utils/firestoreSanitizer';

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
    createdAt: payload.createdAt as MonthlySnapshot['createdAt'],
    updatedAt: payload.updatedAt as MonthlySnapshot['updatedAt'],
    closedByUid: toOptionalString(payload.closedByUid),
  };
};

export const saveMonthlySnapshot = async (snapshot: MonthlySnapshot): Promise<void> => {
  const snapshotRef = doc(db, 'monthlySnapshots', snapshot.month);
  const existingSnapshot = await getDoc(snapshotRef);
  const { id: _id, ...snapshotPayload } = snapshot;
  const payload: Record<string, unknown> = {
    ...snapshotPayload,
    updatedAt: serverTimestamp(),
  };

  if (!existingSnapshot.exists()) {
    payload.createdAt = serverTimestamp();
  }

  await setDoc(snapshotRef, sanitizeFirestorePayload(payload), { merge: true });
};

export const getMonthlySnapshot = async (month: string): Promise<MonthlySnapshot | null> => {
  const snapshot = await getDoc(doc(db, 'monthlySnapshots', month));
  return snapshot.exists() ? parseMonthlySnapshot(snapshot.id, snapshot.data()) : null;
};

export const listMonthlySnapshots = async (): Promise<MonthlySnapshot[]> => {
  const snapshot = await getDocs(query(collection(db, 'monthlySnapshots'), orderBy('month', 'desc')));
  return snapshot.docs.map((docSnap) => parseMonthlySnapshot(docSnap.id, docSnap.data()));
};

export const updateMonthlySnapshot = async (
  month: string,
  payload: Partial<MonthlySnapshotInput>,
): Promise<void> => {
  const { id: _id, createdAt: _createdAt, ...cleanPayload } = payload as Partial<MonthlySnapshot>;
  await updateDoc(
    doc(db, 'monthlySnapshots', month),
    sanitizeFirestorePayload({
      ...cleanPayload,
      updatedAt: serverTimestamp(),
    }),
  );
};
