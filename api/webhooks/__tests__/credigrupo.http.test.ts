import crypto from 'node:crypto';
import { Readable } from 'node:stream';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { describe, expect, it, vi } from 'vitest';
import {
  handleCredigrupoWebhookRequest,
  type CredigrupoWebhookDependencies,
} from '../credigrupo';

const secret = 'official-short-secret';
const payload = {
  event: 'kyc.approved',
  partnerId: 'partner-probe',
  timestamp: '2026-08-26T12:00:00.000Z',
  data: { userId: 'raw-body-probe-user', role: 'borrower', reason: null },
};

const sign = (rawBody: Buffer) =>
  `sha256=${crypto.createHmac('sha256', secret).update(rawBody).digest('hex')}`;

const invokeWebhook = async (
  rawBody: Buffer,
  dependencies: CredigrupoWebhookDependencies,
  signature = sign(rawBody),
) => {
  const request = Readable.from([rawBody]) as unknown as VercelRequest;
  request.method = 'POST';
  request.headers = {
    'content-type': 'application/json',
    'x-webhook-signature': signature,
  };

  let status = 200;
  let responseBody = '';
  const headers = new Headers();
  const response = {
    setHeader(name: string, value: string | number | readonly string[]) {
      headers.set(name, Array.isArray(value) ? value.join(', ') : String(value));
      return this;
    },
    status(code: number) {
      status = code;
      return this;
    },
    send(body: unknown) {
      responseBody = String(body);
      return this;
    },
  } as unknown as VercelResponse;

  await handleCredigrupoWebhookRequest(request, response, dependencies);
  return new Response(responseBody, { status, headers });
};

const createDependencies = (options?: { duplicate?: boolean; webhookSecret?: string }) => {
  const registerEvent = vi.fn(async () => ({
    eventRef: {} as never,
    shouldProcess: !options?.duplicate,
    duplicate: Boolean(options?.duplicate),
  }));
  const processEvent = vi.fn(async () => ({ processed: true, duplicate: false }));
  const schedule = vi.fn((_work: Promise<unknown>) => undefined);
  const dependencies: CredigrupoWebhookDependencies = {
    getWebhookSecret: () => options?.webhookSecret ?? secret,
    registerEvent: registerEvent as CredigrupoWebhookDependencies['registerEvent'],
    processEvent: processEvent as CredigrupoWebhookDependencies['processEvent'],
    schedule,
  };
  return { dependencies, registerEvent, processEvent, schedule };
};

describe('HTTP webhook Credigrupo com raw body', () => {
  it('A. aceita application/json bruto com HMAC valido', async () => {
    const rawBody = Buffer.from(JSON.stringify(payload));
    const { dependencies, registerEvent, processEvent, schedule } = createDependencies();

    const response = await invokeWebhook(rawBody, dependencies);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ received: true, duplicate: false });
    expect(registerEvent).toHaveBeenCalledOnce();
    expect(processEvent).toHaveBeenCalledOnce();
    expect(schedule).toHaveBeenCalledOnce();
  });

  it('B. rejeita assinatura invalida', async () => {
    const rawBody = Buffer.from(JSON.stringify(payload));
    const context = createDependencies();
    const signature = `sha256=${'0'.repeat(64)}`;

    const response = await invokeWebhook(rawBody, context.dependencies, signature);

    expect(response.status).toBe(401);
    expect(context.registerEvent).not.toHaveBeenCalled();
  });

  it('rejeita assinatura criada com secret diferente do cadastrado', async () => {
    const rawBody = Buffer.from(JSON.stringify(payload));
    const context = createDependencies({ webhookSecret: 'different-official-secret' });

    const response = await invokeWebhook(rawBody, context.dependencies);

    expect(response.status).toBe(401);
    expect(context.registerEvent).not.toHaveBeenCalled();
    expect(context.processEvent).not.toHaveBeenCalled();
    expect(context.schedule).not.toHaveBeenCalled();
  });

  it('C. rejeita body alterado em um byte depois da assinatura', async () => {
    const original = Buffer.from(JSON.stringify(payload));
    const altered = Buffer.from(original);
    altered[altered.length - 2] = altered[altered.length - 2] === 108 ? 109 : 108;
    const context = createDependencies();

    const response = await invokeWebhook(altered, context.dependencies, sign(original));

    expect(response.status).toBe(401);
    expect(context.registerEvent).not.toHaveBeenCalled();
  });

  it('D. rejeita JSON textual diferente com a assinatura do original', async () => {
    const original = Buffer.from(JSON.stringify(payload));
    const reformatted = Buffer.from(JSON.stringify(payload, null, 2));
    const context = createDependencies();

    const response = await invokeWebhook(reformatted, context.dependencies, sign(original));

    expect(response.status).toBe(401);
    expect(context.registerEvent).not.toHaveBeenCalled();
  });

  it('E. rejeita o stream ao ultrapassar 1 MB', async () => {
    const rawBody = Buffer.from('x'.repeat(1_000_001));
    const context = createDependencies();

    const response = await invokeWebhook(rawBody, context.dependencies);

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toMatchObject({ error: 'PAYLOAD_TOO_LARGE' });
    expect(context.registerEvent).not.toHaveBeenCalled();
  });

  it('F. rejeita JSON invalido mesmo com HMAC valido', async () => {
    const rawBody = Buffer.from('{"event":');
    const context = createDependencies();

    const response = await invokeWebhook(rawBody, context.dependencies);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: 'INVALID_WEBHOOK_JSON' });
    expect(context.registerEvent).not.toHaveBeenCalled();
    expect(context.processEvent).not.toHaveBeenCalled();
  });

  it('G. reconhece evento valido duplicado sem novo processamento', async () => {
    const rawBody = Buffer.from(JSON.stringify(payload));
    const context = createDependencies({ duplicate: true });

    const response = await invokeWebhook(rawBody, context.dependencies);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ received: true, duplicate: true });
    expect(context.registerEvent).toHaveBeenCalledOnce();
    expect(context.processEvent).not.toHaveBeenCalled();
    expect(context.schedule).not.toHaveBeenCalled();
  });

  it('H. nao agenda nem persiste efeito quando a assinatura e invalida', async () => {
    const rawBody = Buffer.from(JSON.stringify(payload));
    const context = createDependencies();

    const response = await invokeWebhook(rawBody, context.dependencies, `sha256=${'f'.repeat(64)}`);

    expect(response.status).toBe(401);
    expect(context.registerEvent).not.toHaveBeenCalled();
    expect(context.processEvent).not.toHaveBeenCalled();
    expect(context.schedule).not.toHaveBeenCalled();
  });

  it('aceita exclusivamente o prefixo e digest no formato oficial', async () => {
    const rawBody = Buffer.from(JSON.stringify(payload));
    const digest = sign(rawBody).slice('sha256='.length);
    const malformedSignatures = [
      `SHA256=${digest}`,
      digest,
      `sha256=${digest.slice(1)}`,
      `sha256=${'g'.repeat(64)}`,
    ];

    for (const malformedSignature of malformedSignatures) {
      const context = createDependencies();
      const response = await invokeWebhook(rawBody, context.dependencies, malformedSignature);
      expect(response.status).toBe(401);
      expect(context.registerEvent).not.toHaveBeenCalled();
    }
  });
});
