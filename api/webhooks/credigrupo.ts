import type { VercelRequest, VercelResponse } from '@vercel/node';
import { waitUntil } from '@vercel/functions';
import { getCredigrupoServerConfig } from '../_lib/env.js';
import {
  buildCredigrupoWebhookEventId,
  parseCredigrupoWebhookEvent,
  verifyCredigrupoWebhookSignature,
} from '../_lib/credit-providers/credigrupo/webhook.js';
import {
  processStoredCredigrupoEvent,
  registerCredigrupoWebhookEvent,
} from '../_lib/credit-providers/credigrupo/webhookProcessor.js';
import { ApiError, handleApiError, readRawBody, sendJson } from '../_lib/http.js';

export const config = { api: { bodyParser: false } };

export default async function handler(request: VercelRequest, response: VercelResponse) {
  try {
    if (request.method !== 'POST') return sendJson(response, 405, { error: 'METHOD_NOT_ALLOWED' });
    let webhookSecret: string;
    try {
      webhookSecret = getCredigrupoServerConfig({ allowWhenDisabled: true }).webhookSecret;
    } catch {
      throw new ApiError(503, 'WEBHOOK_NOT_CONFIGURED', 'Webhook indisponivel.');
    }
    const rawBody = await readRawBody(request);
    const signature = String(request.headers['x-webhook-signature'] || '');
    if (!signature || !verifyCredigrupoWebhookSignature(rawBody, webhookSecret, signature)) {
      throw new ApiError(401, 'INVALID_WEBHOOK_SIGNATURE', 'Assinatura invalida.');
    }

    const event = parseCredigrupoWebhookEvent(rawBody);
    const eventId = buildCredigrupoWebhookEventId(rawBody);
    const registration = await registerCredigrupoWebhookEvent(eventId, event);
    if (registration.shouldProcess) {
      waitUntil(processStoredCredigrupoEvent(registration.eventRef, event));
    }
    return sendJson(response, 200, { received: true, duplicate: registration.duplicate });
  } catch (error) {
    return handleApiError(response, error);
  }
}
