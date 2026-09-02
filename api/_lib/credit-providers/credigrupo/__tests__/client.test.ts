import { afterEach, describe, expect, it, vi } from 'vitest';
import { CredigrupoClient } from '../client';

const configureSandbox = () => {
  vi.stubEnv('CREDIGRUPO_ENABLED', 'true');
  vi.stubEnv('CREDIGRUPO_ENV', 'sandbox');
  vi.stubEnv('CREDIGRUPO_ACCOUNT_MODE', 'OWN_INVESTOR_KEY');
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

  it('preserva erro HTTP 400 sanitizado e identificadores seguros', async () => {
    configureSandbox();
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      code: 'INVALID_BORROWER',
      error: 'validation_failed',
      message: 'Revise o borrower',
      errors: [{ field: 'display_name', message: 'Nome invalido' }],
      correlationId: 'correlation-1',
    }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', 'X-Request-ID': 'request-1' },
    }));
    await expect(new CredigrupoClient().createInstallmentPix('proposal-1', 'installment-1'))
      .rejects.toMatchObject({
        code: 'CREDIGRUPO_HTTP_400',
        message: 'Revise os dados enviados e o status do KYC.',
        details: {
          providerError: {
            httpStatus: 400,
            code: 'INVALID_BORROWER',
            error: 'validation_failed',
            message: 'Revise o borrower',
            errors: [{ field: 'display_name', message: 'Nome invalido' }],
            requestId: 'request-1',
            correlationId: 'correlation-1',
          },
        },
      });
  });

  it('preserva erro HTTP 422 sanitizado', async () => {
    configureSandbox();
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      code: 'LIMIT_EXCEEDED', issues: [{ field: 'amountCents', message: 'Valor acima do limite' }],
    }), { status: 422, headers: { 'Content-Type': 'application/json' } }));
    await expect(new CredigrupoClient().createInstallmentPix('proposal-1', 'installment-1'))
      .rejects.toMatchObject({
        code: 'CREDIGRUPO_HTTP_422',
        details: { providerError: { httpStatus: 422, code: 'LIMIT_EXCEEDED' } },
      });
  });
});

describe('client Credigrupo de investidores', () => {
  it('bloqueia os endpoints de investidores antes de chamar a rede', async () => {
    configureSandbox();
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    const client = new CredigrupoClient();
    await expect(client.listInvestors()).rejects.toMatchObject({ code: 'ACCOUNT_MODE_NOT_APPLICABLE' });
    expect(() => client.getInvestor('external-1')).toThrowError('A chave propria da GR ja representa a investidora Credigrupo.');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('contrato oficial de operacoes Credigrupo', () => {
  it('descobre negociacoes somente com GET na primeira pagina e consulta individual', async () => {
    configureSandbox();
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [], total: 0 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        data: { id: 'proposal-1', status: 'accepted', formalization_status: 'awaiting_lender_payment' },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }));

    const client = new CredigrupoClient();
    await client.listLoansPage();
    await client.getLoan('proposal/1');

    expect(fetchMock.mock.calls[0][0]).toContain('/loans?page=1&pageSize=50');
    expect(fetchMock.mock.calls[1][0]).toContain('/loans/proposal%2F1');
    expect(fetchMock.mock.calls[0][1]?.method).toBeUndefined();
    expect(fetchMock.mock.calls[1][1]?.method).toBeUndefined();
    expect(fetchMock.mock.calls[0][1]?.body).toBeUndefined();
    expect(fetchMock.mock.calls[1][1]?.body).toBeUndefined();
  });

  it('executa test-pay do funding uma vez e preserva HTTP e requestId seguros', async () => {
    configureSandbox();
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      proposalId: 'proposal-1',
      status: 'accepted',
      formalization_status: 'lender_paid',
      message: 'ok',
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'X-Request-ID': 'request-test-pay' },
    }));

    const response = await new CredigrupoClient().testPayLoan('proposal/1');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toContain('/loans/proposal%2F1/test-pay');
    expect(fetchMock.mock.calls[0][1]?.method).toBe('POST');
    expect(fetchMock.mock.calls[0][1]?.body).toBeUndefined();
    expect(response).toMatchObject({
      httpStatus: 200,
      requestId: 'request-test-pay',
      proposalId: 'proposal-1',
    });
  });

  it('atualiza somente display_name do borrower existente pelo PATCH oficial', async () => {
    configureSandbox();
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      success: true,
      borrowerId: 'borrower-1',
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));

    const response = await new CredigrupoClient().updateBorrowerDisplayName('borrower/1', 'Robson Leandro');

    expect(response).toEqual({ success: true, borrowerId: 'borrower-1' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toContain('/borrowers/borrower%2F1');
    expect(fetchMock.mock.calls[0][1]?.method).toBe('PATCH');
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({
      display_name: 'Robson Leandro',
    });
  });

  it('omite investorId de borrower, simulacao e criacao no modo de chave propria', async () => {
    configureSandbox();
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ borrowerId: 'borrower-1', status: 'approved', message: 'ok' }), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ externalId: 'simulation-1', interestRate: 10, simulation: { installments: [] } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ requestId: 'request-1', proposalId: 'proposal-1', status: 'accepted', pix: {} }), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      }));
    const client = new CredigrupoClient();
    await client.registerBorrower({
      email: 'sandbox@example.com',
      display_name: 'Tomador Sandbox',
      phone: '21999999999',
      document: '00000000000',
      birth_date: '1990-01-01',
      kyc_data: {} as never,
    });
    await client.simulateLoan({
      borrowerId: 'borrower-1',
      amountCents: 10000,
      installments: 1,
      interestRate: 10,
      firstPaymentDate: '2026-09-01',
      frequency: 'monthly',
      interestType: 'simple',
    });
    await client.createLoan({
      borrowerId: 'borrower-1',
      amountCents: 10000,
      installments: 1,
      interestRate: 10,
      firstPaymentDate: '2026-09-01',
      frequency: 'monthly',
      interestType: 'simple',
      ccbSimulationData: { simulation: { netAmount: 10000, grossAmount: 11000, totalAmount: 11000, totalInterest: 1000, totalIof: 0, totalFee: 0, installments: [] } },
    });

    const payloads = fetchMock.mock.calls.map((call) => JSON.parse(String(call[1]?.body)) as Record<string, unknown>);
    expect(payloads).toHaveLength(3);
    expect(payloads.every((payload) => !Object.hasOwn(payload, 'investorId'))).toBe(true);
  });

  it('preserva status accepted separado do formalization_status', async () => {
    configureSandbox();
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      data: {
        id: 'proposal-1',
        status: 'accepted',
        formalization_status: 'pending_signatures',
      },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));

    const response = await new CredigrupoClient().getLoan('proposal-1');
    expect(response.data.status).toBe('accepted');
    expect(response.data.formalization_status).toBe('pending_signatures');
  });

  it('preserva macrostatus futuro da consulta sem transformar o HTTP 2xx em erro', async () => {
    configureSandbox();
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      data: { id: 'proposal-1', status: 'awaiting_signature', formalization_status: 'pending_signatures' },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));

    const response = await new CredigrupoClient().getLoan('proposal-1');
    expect(response.data.status).toBe('awaiting_signature');
    expect(response.data.formalization_status).toBe('pending_signatures');
  });

  it('aceita awaiting_lender_payment documentado na criacao da operacao', async () => {
    configureSandbox();
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      requestId: 'request-1', proposalId: 'proposal-1', status: 'awaiting_lender_payment', pix: {},
    }), { status: 201, headers: { 'Content-Type': 'application/json' } }));

    const response = await new CredigrupoClient().createLoan({
      borrowerId: 'borrower-1', amountCents: 10000,
      installments: 1, interestRate: 10, firstPaymentDate: '2026-09-01',
      frequency: 'monthly', interestType: 'simple',
      ccbSimulationData: { simulation: { netAmount: 10000, grossAmount: 11000, totalAmount: 11000, totalInterest: 1000, totalIof: 0, totalFee: 0, installments: [] } },
    });
    expect(response.status).toBe('awaiting_lender_payment');
    expect(response.httpStatus).toBe(201);
  });

  it('preserva status futuro da criacao e o proposalId sem gerar erro 502', async () => {
    configureSandbox();
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      requestId: 'request-2', proposalId: 'proposal-2', status: 'future_provider_status', pix: {},
    }), { status: 201, headers: { 'Content-Type': 'application/json' } }));

    const response = await new CredigrupoClient().createLoan({
      borrowerId: 'borrower-1', amountCents: 30000,
      installments: 2, interestRate: 2.5, firstPaymentDate: '2026-10-02',
      frequency: 'monthly', interestType: 'simple',
      ccbSimulationData: { simulation: { netAmount: 30000, grossAmount: 31437, totalAmount: 32620, totalInterest: 1183, totalIof: 237, totalFee: 1200, installments: [] } },
    });

    expect(response).toMatchObject({
      httpStatus: 201,
      proposalId: 'proposal-2',
      requestId: 'request-2',
      status: 'future_provider_status',
    });
  });

  it('cancela com DELETE sem body', async () => {
    configureSandbox();
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));
    await new CredigrupoClient().cancelLoan('proposal/1');
    expect(fetchMock.mock.calls[0][0]).toContain('/loans/proposal%2F1');
    expect(fetchMock.mock.calls[0][1]?.method).toBe('DELETE');
    expect(fetchMock.mock.calls[0][1]?.body).toBeUndefined();
  });

  it('aceita cachedAt na elegibilidade sem usa-lo como criterio', async () => {
    configureSandbox();
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      eligible: true, errors: [], cachedAt: '2026-08-26T12:00:00.000Z',
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    const response = await new CredigrupoClient().getBorrowerEligibility('borrower-1');
    expect(response).toEqual({ eligible: true, errors: [], cachedAt: '2026-08-26T12:00:00.000Z' });
  });

  it.each([
    {
      name: 'elegivel',
      payload: { eligible: true, errors: [], cachedAt: '2026-08-27T10:00:00.000Z' },
      expected: { eligible: true, errors: [], cachedAt: '2026-08-27T10:00:00.000Z' },
    },
    {
      name: 'inelegivel com motivos',
      payload: { eligible: false, errors: ['Data de nascimento invalida'], cachedAt: '2026-08-27T11:00:00.000Z' },
      expected: { eligible: false, errors: ['Data de nascimento invalida'], cachedAt: '2026-08-27T11:00:00.000Z' },
    },
    {
      name: 'inelegivel sem motivos',
      payload: { eligible: false, errors: [], cachedAt: '2026-08-27T12:00:00.000Z' },
      expected: { eligible: false, errors: [], cachedAt: '2026-08-27T12:00:00.000Z' },
    },
    {
      name: 'resultado ainda desconhecido',
      payload: { errors: [], cachedAt: '2026-08-27T13:00:00.000Z' },
      expected: { eligible: undefined, errors: [], cachedAt: '2026-08-27T13:00:00.000Z' },
    },
    {
      name: 'envelope data retornado pelo provider',
      payload: { data: { eligible: false, errors: ['Campo obrigatorio ausente'], cachedAt: '2026-08-27T14:00:00.000Z' } },
      expected: { eligible: false, errors: ['Campo obrigatorio ausente'], cachedAt: '2026-08-27T14:00:00.000Z' },
    },
  ])('propaga $name sem converter ausencia em false', async ({ payload, expected }) => {
    configureSandbox();
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(payload), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));

    const response = await new CredigrupoClient().getBorrowerEligibility('borrower-1');
    expect(response).toEqual(expected);
  });
});
