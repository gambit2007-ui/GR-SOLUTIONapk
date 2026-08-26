import { describe, expect, it } from 'vitest';
import { evaluateCredigrupoConfiguration } from '../../../env';

const validEnvironment = {
  CREDIGRUPO_ENABLED: 'true',
  CREDIGRUPO_ENV: 'sandbox',
  CREDIGRUPO_API_KEY: 'wl_test_example',
  CREDIGRUPO_WEBHOOK_SECRET: 'a'.repeat(32),
};

describe('configuracao Credigrupo', () => {
  it('considera pronta somente a configuracao sandbox completa', () => {
    const result = evaluateCredigrupoConfiguration(validEnvironment);
    expect(result.configured).toBe(true);
    expect(result.issues).toEqual([]);
  });

  it('identifica segredo ausente e segredo curto sem expor seus valores', () => {
    const missing = evaluateCredigrupoConfiguration({ ...validEnvironment, CREDIGRUPO_WEBHOOK_SECRET: '' });
    const short = evaluateCredigrupoConfiguration({ ...validEnvironment, CREDIGRUPO_WEBHOOK_SECRET: 'curto' });
    expect(missing.issues).toContain('CREDIGRUPO_WEBHOOK_SECRET_MISSING');
    expect(short.issues).toContain('CREDIGRUPO_WEBHOOK_SECRET_TOO_SHORT');
  });

  it('bloqueia chave live e ambiente diferente de sandbox', () => {
    const result = evaluateCredigrupoConfiguration({
      ...validEnvironment,
      CREDIGRUPO_ENV: 'production',
      CREDIGRUPO_API_KEY: 'wl_live_blocked',
    });
    expect(result.configured).toBe(false);
    expect(result.issues).toEqual(expect.arrayContaining([
      'CREDIGRUPO_LIVE_KEY_BLOCKED',
      'CREDIGRUPO_ENV_INVALID',
    ]));
  });
});
