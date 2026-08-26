import { afterEach, describe, expect, it, vi } from 'vitest';
import { CredigrupoClient } from '../client';

const configureSandbox = () => {
  vi.stubEnv('CREDIGRUPO_ENABLED', 'true');
  vi.stubEnv('CREDIGRUPO_ENV', 'sandbox');
  vi.stubEnv('CREDIGRUPO_API_KEY', 'wl_test_example');
  vi.stubEnv('CREDIGRUPO_WEBHOOK_SECRET', 's'.repeat(32));
};

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('client Credigrupo de parcelas', () => {
  it('usa os endpoints oficiais de PIX e test-pay sem enviar a chave ao navegador', async () => {
    configureSandbox();
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      brCode: '000201', qrCodeImage: 'https://api.woovi.com/qr.png', correlationID: 'c-1', amountCents: 100, totalCents: 110, serviceFee: 10,
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    const client = new CredigrupoClient();
    await client.createInstallmentPix('proposal/1', 'installment/1');
    await client.testPayInstallment('proposal/1', 'installment/1');

    expect(fetchMock.mock.calls[0][0]).toContain('/loans/proposal%2F1/installments/installment%2F1/pix');
    expect(fetchMock.mock.calls[1][0]).toContain('/loans/proposal%2F1/installments/installment%2F1/test-pay');
    expect((fetchMock.mock.calls[0][1]?.headers as Record<string, string>)['X-API-Key']).toBe('wl_test_example');
  });

  it('converte erro externo em mensagem segura', async () => {
    configureSandbox();
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ error: 'detalhe externo' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    }));
    await expect(new CredigrupoClient().createInstallmentPix('proposal-1', 'installment-1'))
      .rejects.toMatchObject({ code: 'CREDIGRUPO_HTTP_400', message: 'Revise os dados enviados e o status do KYC.' });
  });
});
