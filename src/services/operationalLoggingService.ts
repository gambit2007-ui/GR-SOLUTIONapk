import { addDoc, collection, getDocs, limit, orderBy, query, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase';
import type { MovementActor } from './cashService';

const normalizeErrorCode = (error: unknown): string => {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = String((error as { code?: unknown }).code || '').trim();
    if (code) return code.slice(0, 120);
  }
  if (error instanceof Error && error.name) return error.name.slice(0, 120);
  return 'UNKNOWN_ERROR';
};

export const reportOperationalError = async (
  source: string,
  error: unknown,
  actor?: MovementActor,
): Promise<void> => {
  const uid = String(actor?.uid || '').trim();
  if (!uid) return;

  try {
    await addDoc(collection(db, 'diagnosticEvents'), {
      source: String(source || 'unknown').slice(0, 120),
      errorCode: normalizeErrorCode(error),
      severity: 'ERROR',
      createdByUid: uid,
      recordedAt: serverTimestamp(),
    });
  } catch (loggingError) {
    console.warn('[diagnosticEvents] Falha ao registrar diagnostico:', loggingError);
  }
};

export interface OperationalDiagnosticEvent {
  id: string;
  source: string;
  errorCode: string;
  createdByUid: string;
  recordedAt?: string;
}

export const listRecentOperationalErrors = async (maxItems = 25): Promise<OperationalDiagnosticEvent[]> => {
  const snapshot = await getDocs(query(
    collection(db, 'diagnosticEvents'),
    orderBy('recordedAt', 'desc'),
    limit(Math.min(Math.max(Math.trunc(maxItems), 1), 100)),
  ));

  return snapshot.docs.map((item) => {
    const data = item.data();
    const recordedAt = data.recordedAt && typeof data.recordedAt.toDate === 'function'
      ? data.recordedAt.toDate().toISOString()
      : undefined;
    return {
      id: item.id,
      source: String(data.source || 'unknown'),
      errorCode: String(data.errorCode || 'UNKNOWN_ERROR'),
      createdByUid: String(data.createdByUid || ''),
      recordedAt,
    };
  });
};
