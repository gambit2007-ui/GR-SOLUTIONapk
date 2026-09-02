import { describe, expect, it } from 'vitest';
import { evaluateCredigrupoConfiguration } from '../../../env';

const validEnvironment = {
  CREDIGRUPO_ENABLED: 'true',
  CREDIGRUPO_ENV: 'sandbox',
  CREDIGRUPO_ACCOUNT_MODE: 'OWN_INVESTOR_KEY',
  CREDIGRUPO_API_KEY: 'wl_test_example',
  CREDIGRUPO_WEBHOOK_SECRET: 'official-short-secret',
};

describe('configuracao Credigrupo', () => {
  it('considera pronta somente a configuracao sandbox completa', () => {
    const result = evaluateCredigrupoConfiguration(validEnvironment);
    expect(validEnvironment.CREDIGRUPO_WEBHOOK_SECRET.length).toBeLessThan(32);
    expect(result.configured).toBe(true);
    expect(result.issues).toEqual([]);
  });

  it('normaliza espacos no indicador de integracao habilitada', () => {
    const result = evaluateCredigrupoConfiguration({
      ...validEnvironment,
      CREDIGRUPO_ENABLED: ' true ',
    });
    expect(result.requestedEnabled).toBe(true);
  });

  it('bloqueia somente segredo ausente, sem impor tamanho minimo', () => {
    const missing = evaluateCredigrupoConfiguration({ ...validEnvironment, CREDIGRUPO_WEBHOOK_SECRET: '' });
    const short = evaluateCredigrupoConfiguration({ ...validEnvironment, CREDIGRUPO_WEBHOOK_SECRET: 'curto' });
    expect(missing.issues).toContain('CREDIGRUPO_WEBHOOK_SECRET_MISSING');
    expect(short.configured).toBe(true);
    expect(short.issues).toEqual([]);
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

  it('exige explicitamente o modo de chave propria', () => {
    const missing = evaluateCredigrupoConfiguration({ ...validEnvironment, CREDIGRUPO_ACCOUNT_MODE: '' });
    const different = evaluateCredigrupoConfiguration({ ...validEnvironment, CREDIGRUPO_ACCOUNT_MODE: 'PARTNER' });
    expect(missing.issues).toContain('CREDIGRUPO_ACCOUNT_MODE_INVALID');
    expect(different.issues).toContain('CREDIGRUPO_ACCOUNT_MODE_INVALID');
  });
});
