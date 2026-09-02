import { waitUntil } from '@vercel/functions';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import {
  buildCredigrupoWebhookEventId,
  parseCredigrupoWebhookEvent,
  verifyCredigrupoWebhookSignature,
} from '../_lib/credit-providers/credigrupo/webhook.js';
import {
  processStoredCredigrupoEvent,
  registerCredigrupoWebhookEvent,
} from '../_lib/credit-providers/credigrupo/webhookProcessor.js';
import type { CredigrupoWebhookEvent } from '../_lib/credit-providers/credigrupo/webhook.js';
import { ApiError, readRawNodeRequestBody } from '../_lib/http.js';

export const config = { api: { bodyParser: false } };

type RegisteredWebhookEvent = Awaited<ReturnType<typeof registerCredigrupoWebhookEvent>>;

export interface CredigrupoWebhookDependencies {
  getWebhookSecret: () => string;
  registerEvent: (eventId: string, event: CredigrupoWebhookEvent) => Promise<RegisteredWebhookEvent>;
  processEvent: typeof processStoredCredigrupoEvent;
  schedule: (work: Promise<unknown>) => void;
}

const productionDependencies: CredigrupoWebhookDependencies = {
  getWebhookSecret: () => {
    const webhookSecret = String(process.env.CREDIGRUPO_WEBHOOK_SECRET || '');
    if (!webhookSecret) throw new Error('CREDIGRUPO_WEBHOOK_SECRET_INVALID');
    return webhookSecret;
  },
  registerEvent: registerCredigrupoWebhookEvent,
  processEvent: processStoredCredigrupoEvent,
  schedule: waitUntil,
};

const errorResponse = (error: unknown): Response => {
  if (error instanceof ApiError) {
    return Response.json({ error: error.code, message: error.message, details: error.details }, { status: error.status });
  }

  const message = error instanceof Error ? error.message : 'UNKNOWN_ERROR';
  const safeMessage = message.startsWith('CREDIGRUPO_') ? message : 'INTERNAL_ERROR';
  console.error('[Credigrupo]', { error: safeMessage, timestamp: new Date().toISOString() });
  return Response.json({ error: safeMessage, message: 'Nao foi possivel concluir a operacao.' }, { status: 500 });
};

const processCredigrupoWebhook = async (
  rawBody: Buffer,
  signature: string,
  dependencies: CredigrupoWebhookDependencies = productionDependencies,
): Promise<Response> => {
  try {
    let webhookSecret: string;
    try {
      webhookSecret = dependencies.getWebhookSecret();
    } catch {
      throw new ApiError(503, 'WEBHOOK_NOT_CONFIGURED', 'Webhook indisponivel.');
    }
    if (!signature || !verifyCredigrupoWebhookSignature(rawBody, webhookSecret, signature)) {
      throw new ApiError(401, 'INVALID_WEBHOOK_SIGNATURE', 'Assinatura invalida.');
    }

    const event = parseCredigrupoWebhookEvent(rawBody);
    const eventId = buildCredigrupoWebhookEventId(rawBody);
    const registration = await dependencies.registerEvent(eventId, event);
    if (registration.shouldProcess) {
      dependencies.schedule(dependencies.processEvent(registration.eventRef, event));
    }
    return Response.json({ received: true, duplicate: registration.duplicate });
  } catch (error) {
    return errorResponse(error);
  }
};

const sendResponse = async (response: VercelResponse, result: Response) => {
  result.headers.forEach((value, name) => response.setHeader(name, value));
  return response.status(result.status).send(await result.text());
};

export const handleCredigrupoWebhookRequest = async (
  request: VercelRequest,
  response: VercelResponse,
  dependencies: CredigrupoWebhookDependencies = productionDependencies,
) => {
  if (request.method !== 'POST') {
    return sendResponse(response, Response.json({ error: 'METHOD_NOT_ALLOWED' }, { status: 405 }));
  }

  try {
    const rawBody = await readRawNodeRequestBody(request);
    const signatureHeader = request.headers['x-webhook-signature'];
    const signature = Array.isArray(signatureHeader) ? signatureHeader[0] : String(signatureHeader || '');
    return sendResponse(response, await processCredigrupoWebhook(rawBody, signature, dependencies));
  } catch (error) {
    return sendResponse(response, errorResponse(error));
  }
};

export default async function handler(request: VercelRequest, response: VercelResponse) {
  return handleCredigrupoWebhookRequest(request, response);
}
