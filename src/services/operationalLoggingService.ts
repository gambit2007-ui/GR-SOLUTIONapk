import { addDoc, collection, serverTimestamp } from 'firebase/firestore';
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
