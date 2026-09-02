import { afterEach, describe, expect, it, vi } from 'vitest';
import { sanitizeCredigrupoProviderError } from '../providerError';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('sanitizacao de erros Credigrupo', () => {
  it('preserva somente campos permitidos e remove credenciais e dados pessoais recursivamente', () => {
    vi.stubEnv('CREDIGRUPO_API_KEY', 'wl_test_super_secret_key');
    vi.stubEnv('CREDIGRUPO_WEBHOOK_SECRET', 'webhook-super-secret');
    const result = sanitizeCredigrupoProviderError({
      httpStatus: 400,
      requestId: 'request-header-1',
      occurredAt: '2026-09-01T17:26:16.669Z',
      payload: {
        code: 'INVALID_DATA',
        message: 'Bearer token-value wl_test_super_secret_key CPF 123.456.789-00 user@example.com',
        details: {
          safeReason: 'Nome invalido',
          Authorization: 'Bearer hidden',
          apiKey: 'wl_test_hidden',
          document: '12345678900',
          bankAccount: '12345-6',
          pixKey: 'secret-pix',
          nested: [{ field: 'display_name', message: 'Obrigatorio', cpf: '12345678900' }],
        },
        errors: [{ field: 'document', message: 'Documento 123.456.789-00 invalido' }],
        issues: [{ path: ['kyc_data', 'bankAccount'], message: 'webhook-super-secret' }],
        correlationId: 'correlation-1',
        headers: { cookie: 'session' },
      },
    });
    const serialized = JSON.stringify(result);

    expect(result).toMatchObject({
      httpStatus: 400,
      code: 'INVALID_DATA',
      requestId: 'request-header-1',
      correlationId: 'correlation-1',
      occurredAt: '2026-09-01T17:26:16.669Z',
    });
    expect(serialized).not.toContain('token-value');
    expect(serialized).not.toContain('wl_test_super_secret_key');
    expect(serialized).not.toContain('webhook-super-secret');
    expect(serialized).not.toContain('123.456.789-00');
    expect(serialized).not.toContain('12345678900');
    expect(serialized).not.toContain('12345-6');
    expect(serialized).not.toContain('secret-pix');
    expect(serialized).not.toContain('user@example.com');
    expect(serialized).not.toContain('cookie');
    expect(serialized).toContain('Nome invalido');
    expect(serialized).toContain('display_name');
  });

  it('aceita arrays, objetos e campos opcionais sem falhar', () => {
    const result = sanitizeCredigrupoProviderError({
      httpStatus: 422,
      payload: { error: { type: 'validation' }, errors: ['Campo invalido'], field: 'amountCents', path: ['loan'] },
    });
    expect(result).toMatchObject({
      httpStatus: 422,
      error: { type: 'validation' },
      errors: ['Campo invalido'],
      field: 'amountCents',
      path: ['loan'],
    });
  });
});
