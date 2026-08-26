import crypto from 'node:crypto';
import { ApiError } from '../../http.js';

export const CREDIGRUPO_WEBHOOK_EVENTS = [
  'kyc.approved',
  'kyc.rejected',
  'ccb_ready_for_signature',
  'loan.signed',
  'loan.funded',
  'loan.cancelled',
  'installment.pix_created',
  'installment.paid',
  'installment.investor_repaid',
] as const;

export type CredigrupoWebhookEventType = typeof CREDIGRUPO_WEBHOOK_EVENTS[number];

export interface CredigrupoWebhookEvent {
  event: string;
  partnerId: string;
  timestamp: string;
  data: Record<string, unknown>;
}

const asText = (value: unknown): string => String(value || '').trim();
const hasPositiveNumber = (value: unknown): boolean => Number.isFinite(Number(value)) && Number(value) > 0;

export const isSupportedCredigrupoWebhookEvent = (event: string): event is CredigrupoWebhookEventType =>
  CREDIGRUPO_WEBHOOK_EVENTS.includes(event as CredigrupoWebhookEventType);

const requireFields = (data: Record<string, unknown>, fields: string[]): void => {
  if (fields.some((field) => !asText(data[field]))) {
    throw new ApiError(400, 'INVALID_WEBHOOK_DATA', 'Dados obrigatorios do webhook ausentes.');
  }
};

const validateEventData = (event: CredigrupoWebhookEvent): void => {
  const { data } = event;
  switch (event.event) {
    case 'kyc.approved':
    case 'kyc.rejected':
      requireFields(data, ['userId', 'role']);
      if (!['user', 'borrower'].includes(asText(data.role))) {
        throw new ApiError(400, 'INVALID_WEBHOOK_DATA', 'Perfil KYC invalido no webhook.');
      }
      return;
    case 'ccb_ready_for_signature':
      requireFields(data, ['proposalId', 'borrowerSignUrl', 'investorSignUrl']);
      return;
    case 'loan.signed':
      requireFields(data, ['proposalId', 'requestId', 'signedAt']);
      return;
    case 'loan.funded':
      requireFields(data, ['proposalId', 'borrowerId']);
      if (!hasPositiveNumber(data.amountCents)) throw new ApiError(400, 'INVALID_WEBHOOK_DATA', 'Valor financiado invalido.');
      return;
    case 'loan.cancelled':
      requireFields(data, ['proposalId', 'requestId', 'cancelledAt']);
      return;
    case 'installment.pix_created':
      requireFields(data, ['installmentId', 'dueDate', 'pixBrcode', 'pixQrCode']);
      if (!hasPositiveNumber(data.installmentNumber)
        || !hasPositiveNumber(data.amountCents)
        || !hasPositiveNumber(data.totalCents)) {
        throw new ApiError(400, 'INVALID_WEBHOOK_DATA', 'Dados da parcela PIX invalidos.');
      }
      return;
    case 'installment.paid':
      requireFields(data, ['proposalId', 'installmentId', 'dueDate', 'paidAt']);
      if (!hasPositiveNumber(data.installmentNumber) || !hasPositiveNumber(data.amountCents)) {
        throw new ApiError(400, 'INVALID_WEBHOOK_DATA', 'Dados do pagamento invalidos.');
      }
      return;
    case 'installment.investor_repaid':
      requireFields(data, ['proposalId', 'installmentId']);
      if (!hasPositiveNumber(data.amountCents)) throw new ApiError(400, 'INVALID_WEBHOOK_DATA', 'Valor do repasse invalido.');
      return;
    default:
      return;
  }
};

export const validateCredigrupoWebhookEvent = (payload: unknown): CredigrupoWebhookEvent => {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new ApiError(400, 'INVALID_WEBHOOK', 'Webhook invalido.');
  }
  const event = payload as Record<string, unknown>;
  const eventName = asText(event.event);
  const partnerId = asText(event.partnerId);
  const timestamp = asText(event.timestamp);
  if (!eventName || !partnerId || !timestamp || !Number.isFinite(Date.parse(timestamp))
    || !event.data || typeof event.data !== 'object' || Array.isArray(event.data)) {
    throw new ApiError(400, 'INVALID_WEBHOOK_ENVELOPE', 'Envelope de webhook invalido.');
  }
  const parsed: CredigrupoWebhookEvent = {
    event: eventName,
    partnerId,
    timestamp,
    data: event.data as Record<string, unknown>,
  };
  validateEventData(parsed);
  return parsed;
};

export const parseCredigrupoWebhookEvent = (rawBody: Buffer): CredigrupoWebhookEvent => {
  let payload: unknown;
  try {
    payload = JSON.parse(rawBody.toString('utf8'));
  } catch {
    throw new ApiError(400, 'INVALID_WEBHOOK_JSON', 'Payload de webhook invalido.');
  }
  return validateCredigrupoWebhookEvent(payload);
};

export const verifyCredigrupoWebhookSignature = (rawBody: Buffer, secret: string, received: string): boolean => {
  const expected = `sha256=${crypto.createHmac('sha256', secret).update(rawBody).digest('hex')}`;
  const expectedBuffer = Buffer.from(expected, 'utf8');
  const receivedBuffer = Buffer.from(received, 'utf8');
  return expectedBuffer.length === receivedBuffer.length && crypto.timingSafeEqual(expectedBuffer, receivedBuffer);
};

export const buildCredigrupoWebhookEventId = (rawBody: Buffer): string =>
  crypto.createHash('sha256').update(rawBody).digest('hex');
