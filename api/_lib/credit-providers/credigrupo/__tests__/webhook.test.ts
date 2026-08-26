import crypto from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  buildCredigrupoWebhookEventId,
  CREDIGRUPO_WEBHOOK_EVENTS,
  isSupportedCredigrupoWebhookEvent,
  parseCredigrupoWebhookEvent,
  verifyCredigrupoWebhookSignature,
} from '../webhook';

const envelope = (event: string, data: Record<string, unknown>) => ({
  event,
  partnerId: 'partner-1',
  timestamp: '2026-08-25T12:00:00.000Z',
  data,
});

const documentedPayloads = [
  envelope('kyc.approved', { userId: 'user-1', role: 'borrower', reason: null }),
  envelope('kyc.rejected', { userId: 'user-1', role: 'user', reason: 'Documento ilegivel' }),
  envelope('ccb_ready_for_signature', { proposalId: 'proposal-1', borrowerSignUrl: 'https://app.zapsign.com.br/a', investorSignUrl: 'https://app.zapsign.com.br/b' }),
  envelope('loan.signed', { proposalId: 'proposal-1', requestId: 'request-1', signedAt: '2026-08-25T12:00:00.000Z' }),
  envelope('loan.funded', { proposalId: 'proposal-1', amountCents: 10000, borrowerId: 'borrower-1' }),
  envelope('loan.cancelled', { proposalId: 'proposal-1', requestId: 'request-1', cancelledAt: '2026-08-25T12:00:00.000Z' }),
  envelope('installment.pix_created', { proposalId: 'proposal-1', installmentId: 'installment-1', installmentNumber: 1, amountCents: 11000, totalCents: 12000, dueDate: '2026-09-25', pixBrcode: '000201', pixQrCode: 'https://api.woovi.com/qr.png' }),
  envelope('installment.paid', { proposalId: 'proposal-1', installmentId: 'installment-1', installmentNumber: 1, amountCents: 11000, dueDate: '2026-09-25', paidAt: '2026-08-25T12:00:00.000Z' }),
  envelope('installment.investor_repaid', { proposalId: 'proposal-1', installmentId: 'installment-1', amountCents: 11000 }),
];

describe('webhook Credigrupo', () => {
  it('aceita payloads dos nove eventos oficiais', () => {
    expect(documentedPayloads).toHaveLength(CREDIGRUPO_WEBHOOK_EVENTS.length);
    documentedPayloads.forEach((payload) => {
      const parsed = parseCredigrupoWebhookEvent(Buffer.from(JSON.stringify(payload)));
      expect(isSupportedCredigrupoWebhookEvent(parsed.event)).toBe(true);
    });
  });

  it('valida HMAC do corpo bruto e rejeita assinatura alterada', () => {
    const raw = Buffer.from(JSON.stringify(documentedPayloads[0]));
    const secret = 's'.repeat(32);
    const signature = `sha256=${crypto.createHmac('sha256', secret).update(raw).digest('hex')}`;
    expect(verifyCredigrupoWebhookSignature(raw, secret, signature)).toBe(true);
    expect(verifyCredigrupoWebhookSignature(Buffer.concat([raw, Buffer.from(' ')]), secret, signature)).toBe(false);
  });

  it('rejeita JSON, envelope e dados obrigatorios invalidos', () => {
    expect(() => parseCredigrupoWebhookEvent(Buffer.from('{'))).toThrow('Payload de webhook invalido');
    expect(() => parseCredigrupoWebhookEvent(Buffer.from(JSON.stringify({ event: 'loan.funded' })))).toThrow('Envelope de webhook invalido');
    expect(() => parseCredigrupoWebhookEvent(Buffer.from(JSON.stringify(envelope('installment.paid', { proposalId: 'proposal-1' }))))).toThrow('Dados obrigatorios');
  });

  it('aceita evento desconhecido para registro seguro e o identifica como nao suportado', () => {
    const parsed = parseCredigrupoWebhookEvent(Buffer.from(JSON.stringify(envelope('future.event', { value: true }))));
    expect(isSupportedCredigrupoWebhookEvent(parsed.event)).toBe(false);
  });

  it('aceita installment.pix_created legado com proposalId nulo para diagnostico', () => {
    const payload = { ...documentedPayloads[6], data: { ...documentedPayloads[6].data, proposalId: null } };
    expect(parseCredigrupoWebhookEvent(Buffer.from(JSON.stringify(payload))).event).toBe('installment.pix_created');
  });

  it('gera a mesma chave idempotente para a mesma entrega', () => {
    const raw = Buffer.from(JSON.stringify(documentedPayloads[7]));
    expect(buildCredigrupoWebhookEventId(raw)).toBe(buildCredigrupoWebhookEventId(raw));
    expect(buildCredigrupoWebhookEventId(raw)).not.toBe(buildCredigrupoWebhookEventId(Buffer.concat([raw, Buffer.from(' ')])));
  });
});
