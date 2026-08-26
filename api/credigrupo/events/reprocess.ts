import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireAuthorizedActor } from '../../_lib/auth';
import { validateCredigrupoWebhookEvent } from '../../_lib/credit-providers/credigrupo/webhook';
import { processStoredCredigrupoEvent } from '../../_lib/credit-providers/credigrupo/webhookProcessor';
import { adminDb } from '../../_lib/firebaseAdmin';
import { ApiError, handleApiError, parseJsonBody, sendJson } from '../../_lib/http';

export default async function handler(request: VercelRequest, response: VercelResponse) {
  try {
    if (request.method !== 'POST') return sendJson(response, 405, { error: 'METHOD_NOT_ALLOWED' });
    const actor = await requireAuthorizedActor(request);
    if (!actor.admin) throw new ApiError(403, 'ADMIN_REQUIRED', 'Somente administradores podem reprocessar webhooks.');
    const input = parseJsonBody<{ eventId?: string }>(request);
    const eventId = String(input.eventId || '').trim();
    if (!/^[a-zA-Z0-9_-]{1,128}$/.test(eventId)) throw new ApiError(400, 'EVENT_ID_REQUIRED', 'Evento obrigatorio.');
    const eventRef = adminDb.doc(`creditWebhookEvents/${eventId}`);
    const snapshot = await eventRef.get();
    if (!snapshot.exists) throw new ApiError(404, 'EVENT_NOT_FOUND', 'Evento nao encontrado.');
    const event = validateCredigrupoWebhookEvent(snapshot.data()?.payload);
    const result = await processStoredCredigrupoEvent(eventRef, event, { force: true });
    const updated = await eventRef.get();
    return sendJson(response, 200, { ...result, status: updated.data()?.status || 'FAILED' });
  } catch (error) {
    return handleApiError(response, error);
  }
}
