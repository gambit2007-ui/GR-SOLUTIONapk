import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireAuthorizedActor } from '../../_lib/auth.js';
import { validateCredigrupoWebhookEvent } from '../../_lib/credit-providers/credigrupo/webhook.js';
import { processStoredCredigrupoEvent } from '../../_lib/credit-providers/credigrupo/webhookProcessor.js';
import { recoverCredigrupoCcbSigningLinksFromInbox } from '../../_lib/credit-providers/credigrupo/signingLinkRecovery.js';
import { adminDb } from '../../_lib/firebaseAdmin.js';
import { ApiError, handleApiError, parseJsonBody, sendJson } from '../../_lib/http.js';

interface ReprocessDependencies {
  requireActor: typeof requireAuthorizedActor;
  recoverCcbSigningLinks: typeof recoverCredigrupoCcbSigningLinksFromInbox;
}

const defaultDependencies: ReprocessDependencies = {
  requireActor: requireAuthorizedActor,
  recoverCcbSigningLinks: recoverCredigrupoCcbSigningLinksFromInbox,
};

export const handleCredigrupoEventReprocess = async (
  request: VercelRequest,
  response: VercelResponse,
  dependencies: ReprocessDependencies = defaultDependencies,
) => {
  try {
    if (request.method !== 'POST') return sendJson(response, 405, { error: 'METHOD_NOT_ALLOWED' });
    const actor = await dependencies.requireActor(request);
    if (!actor.admin) throw new ApiError(403, 'ADMIN_REQUIRED', 'Somente administradores podem reprocessar webhooks.');
    const input = parseJsonBody<{ action?: string; operationId?: string; eventId?: string }>(request);
    if (input.action === 'reprocess_ccb_signing_links') {
      const operationId = String(input.operationId || '').trim();
      if (!/^[a-zA-Z0-9_-]{1,128}$/.test(operationId)) {
        throw new ApiError(400, 'OPERATION_ID_REQUIRED', 'Operacao obrigatoria.');
      }
      const result = await dependencies.recoverCcbSigningLinks(operationId);
      return sendJson(response, 200, result);
    }
    if (input.action) throw new ApiError(400, 'ACTION_NOT_SUPPORTED', 'Acao nao suportada.');

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
};

export default function handler(request: VercelRequest, response: VercelResponse) {
  return handleCredigrupoEventReprocess(request, response);
}
