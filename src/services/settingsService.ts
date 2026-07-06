import { doc, getDoc, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase';
import type { FeeSettings } from '../types';
import { DEFAULT_DAILY_LATE_FEE_RATE, normalizeDailyLateFeeRate } from '../utils/lateFee';

export const parseFeeSettings = (raw: unknown): FeeSettings => {
  const payload = typeof raw === 'object' && raw !== null ? raw as Record<string, unknown> : {};
  return {
    dailyLateFeeRate: normalizeDailyLateFeeRate(payload.dailyLateFeeRate),
  };
};

export const getFeeSettings = async (): Promise<FeeSettings> => {
  const snapshot = await getDoc(doc(db, 'settings', 'fees'));
  return snapshot.exists() ? parseFeeSettings(snapshot.data()) : { dailyLateFeeRate: DEFAULT_DAILY_LATE_FEE_RATE };
};

export const subscribeFeeSettings = (
  onChange: (settings: FeeSettings) => void,
  onError?: (error: unknown) => void,
) =>
  onSnapshot(
    doc(db, 'settings', 'fees'),
    (snapshot) => {
      onChange(snapshot.exists() ? parseFeeSettings(snapshot.data()) : { dailyLateFeeRate: DEFAULT_DAILY_LATE_FEE_RATE });
    },
    onError,
  );
