import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '../../firebaseAdmin.js';
import { ApiError } from '../../http.js';
import { processCredigrupoEvent } from './events.js';
import { removeUndefined } from './store.js';
import type { CredigrupoWebhookEvent } from './webhook.js';

export type CredigrupoWebhookEventStatus = 'RECEIVED' | 'PROCESSING' | 'PROCESSED' | 'FAILED';

const safeErrorCode = (error: unknown): string => {
  if (error instanceof ApiError) return error.code;
  const message = error instanceof Error ? error.message : '';
  return /^CREDIGRUPO_[A-Z0-9_]+$/.test(message) ? message : 'EVENT_PROCESSING_FAILED';
};

export const registerCredigrupoWebhookEvent = async (
  eventId: string,
  event: CredigrupoWebhookEvent,
): Promise<{ eventRef: FirebaseFirestore.DocumentReference; shouldProcess: boolean; duplicate: boolean }> => {
  const eventRef = adminDb.doc(`creditWebhookEvents/${eventId}`);
  return adminDb.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(eventRef);
    const status = snapshot.data()?.status as CredigrupoWebhookEventStatus | undefined;
    const duplicate = snapshot.exists;
    const processingStartedAt = snapshot.data()?.processingStartedAt as { toMillis?: () => number } | undefined;
    const processingAge = processingStartedAt?.toMillis ? Date.now() - processingStartedAt.toMillis() : Number.POSITIVE_INFINITY;
    const processingIsFresh = status === 'PROCESSING' && processingAge < 90_000;
    if (status === 'PROCESSED' || processingIsFresh) {
      transaction.set(eventRef, {
        lastReceivedAt: FieldValue.serverTimestamp(),
        deliveryAttempts: FieldValue.increment(1),
      }, { merge: true });
      return { eventRef, shouldProcess: false, duplicate };
    }
    transaction.set(eventRef, removeUndefined({
      eventId,
      eventType: event.event,
      partnerId: event.partnerId,
      timestamp: event.timestamp,
      proposalId: event.data.proposalId || null,
      installmentId: event.data.installmentId || null,
      providerTimestamp: event.timestamp,
      status: 'RECEIVED' satisfies CredigrupoWebhookEventStatus,
      errorCode: FieldValue.delete(),
      processingStartedAt: FieldValue.delete(),
      receivedAt: snapshot.exists ? undefined : FieldValue.serverTimestamp(),
      lastReceivedAt: FieldValue.serverTimestamp(),
      deliveryAttempts: FieldValue.increment(1),
      payload: event,
      hmacValidated: true,
      hmacValidatedAt: snapshot.exists ? undefined : FieldValue.serverTimestamp(),
    }), { merge: true });
    return { eventRef, shouldProcess: true, duplicate };
  });
};

export const processStoredCredigrupoEvent = async (
  eventRef: FirebaseFirestore.DocumentReference,
  event: CredigrupoWebhookEvent,
  options?: { force?: boolean },
): Promise<{ processed: boolean; duplicate: boolean }> => {
  const claimed = await adminDb.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(eventRef);
    if (!snapshot.exists) throw new Error('CREDIGRUPO_EVENT_NOT_FOUND');
    const status = snapshot.data()?.status as CredigrupoWebhookEventStatus | undefined;
    if (status === 'PROCESSED') return false;
    if (status === 'PROCESSING' && !options?.force) return false;
    transaction.set(eventRef, {
      status: 'PROCESSING' satisfies CredigrupoWebhookEventStatus,
      processingStartedAt: FieldValue.serverTimestamp(),
      processAttempts: FieldValue.increment(1),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    return true;
  });
  if (!claimed) return { processed: false, duplicate: true };

  try {
    await processCredigrupoEvent(eventRef, event);
    await eventRef.set({
      status: 'PROCESSED' satisfies CredigrupoWebhookEventStatus,
      processedAt: FieldValue.serverTimestamp(),
      errorCode: FieldValue.delete(),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    return { processed: true, duplicate: false };
  } catch (error) {
    const errorCode = safeErrorCode(error);
    await eventRef.set({
      status: 'FAILED' satisfies CredigrupoWebhookEventStatus,
      errorCode,
      failedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    console.error('[Credigrupo webhook]', {
      eventType: event.event,
      proposalId: String(event.data.proposalId || ''),
      installmentId: String(event.data.installmentId || ''),
      status: 'FAILED',
      errorCode,
      timestamp: new Date().toISOString(),
    });
    return { processed: false, duplicate: false };
  }
};
