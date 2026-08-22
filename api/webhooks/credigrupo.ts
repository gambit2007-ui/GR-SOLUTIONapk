import crypto from 'node:crypto';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { FieldValue } from 'firebase-admin/firestore';
import { getCredigrupoServerConfig } from '../_lib/env';
import { processCredigrupoEvent, CredigrupoWebhookEvent } from '../_lib/credit-providers/credigrupo/events';
import { adminDb } from '../_lib/firebaseAdmin';
import { ApiError, handleApiError, readRawBody, sendJson } from '../_lib/http';

export const config = { api: { bodyParser: false } };

const verifySignature = (rawBody: Buffer, secret: string, received: string): boolean => {
  const expected = `sha256=${crypto.createHmac('sha256', secret).update(rawBody).digest('hex')}`;
  const expectedBuffer = Buffer.from(expected, 'utf8');
  const receivedBuffer = Buffer.from(received, 'utf8');
  return expectedBuffer.length === receivedBuffer.length && crypto.timingSafeEqual(expectedBuffer, receivedBuffer);
};

const parseEvent = (rawBody: Buffer): CredigrupoWebhookEvent => {
  let payload: unknown;
  try {
    payload = JSON.parse(rawBody.toString('utf8'));
  } catch {
    throw new ApiError(400, 'INVALID_WEBHOOK_JSON', 'Payload de webhook invalido.');
  }
  if (!payload || typeof payload !== 'object') throw new ApiError(400, 'INVALID_WEBHOOK', 'Webhook invalido.');
  const event = payload as Record<string, unknown>;
  if (typeof event.event !== 'string' || typeof event.timestamp !== 'string' || !event.data || typeof event.data !== 'object') {
    throw new ApiError(400, 'INVALID_WEBHOOK_ENVELOPE', 'Envelope de webhook invalido.');
  }
  return {
    event: event.event,
    partnerId: String(event.partnerId || ''),
    timestamp: event.timestamp,
    data: event.data as Record<string, unknown>,
  };
};

export default async function handler(request: VercelRequest, response: VercelResponse) {
  try {
    if (request.method !== 'POST') return sendJson(response, 405, { error: 'METHOD_NOT_ALLOWED' });
    const config = getCredigrupoServerConfig({ allowWhenDisabled: true });
    if (!config.webhookSecret || config.webhookSecret.length < 32) {
      throw new ApiError(503, 'WEBHOOK_SECRET_NOT_CONFIGURED', 'Webhook indisponivel.');
    }
    const rawBody = await readRawBody(request);
    const signature = String(request.headers['x-webhook-signature'] || '');
    if (!signature || !verifySignature(rawBody, config.webhookSecret, signature)) {
      throw new ApiError(401, 'INVALID_WEBHOOK_SIGNATURE', 'Assinatura invalida.');
    }

    const event = parseEvent(rawBody);
    const fingerprint = crypto.createHash('sha256').update(rawBody).digest('hex');
    const eventRef = adminDb.doc(`creditWebhookEvents/${fingerprint}`);
    const existing = await eventRef.get();
    if (existing.exists && existing.data()?.status === 'PROCESSED') {
      return sendJson(response, 200, { received: true, duplicate: true });
    }

    await eventRef.set({
      fingerprint,
      event: event.event,
      partnerId: event.partnerId,
      proposalId: event.data.proposalId || null,
      installmentId: event.data.installmentId || null,
      providerTimestamp: event.timestamp,
      status: 'RECEIVED',
      receivedAt: FieldValue.serverTimestamp(),
      payload: event,
    }, { merge: true });

    await processCredigrupoEvent(eventRef, event);
    return sendJson(response, 200, { received: true, duplicate: existing.exists });
  } catch (error) {
    return handleApiError(response, error);
  }
}
