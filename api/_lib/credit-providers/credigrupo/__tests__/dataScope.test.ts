import { describe, expect, it } from 'vitest';
import { isSandboxTestCustomer, permitsRealFinancialEffects } from '../../../../../src/lib/creditProviders/dataScope';
import { assertSandboxTestPay, requireSandboxTestCustomer } from '../dataScope';

describe('separacao de dados Credigrupo', () => {
  it('exige identificacao explicita de teste e sandbox', () => {
    expect(isSandboxTestCustomer({ environment: 'sandbox', testData: true })).toBe(true);
    for (const data of [{}, { testData: true }, { environment: 'sandbox' as const },
      { environment: 'production' as const, testData: true },
      { environment: 'sandbox' as const, testData: true, archived: true }]) {
      expect(() => requireSandboxTestCustomer(data)).toThrow();
    }
  });
  it('permite efeitos reais somente com proveniencia production e runtime production', () => {
    expect(permitsRealFinancialEffects({ environment: 'production' }, 'production')).toBe(true);
    for (const runtime of [undefined, 'sandbox', 'live']) {
      expect(permitsRealFinancialEffects({ environment: 'production' }, runtime)).toBe(false);
    }
    for (const data of [{}, { environment: 'sandbox' as const },
      { environment: 'production' as const, testData: true },
      { environment: 'production' as const, archived: true }]) {
      expect(permitsRealFinancialEffects(data, 'production')).toBe(false);
    }
  });
  it('bloqueia test-pay fora de sandbox com chave test', () => {
    expect(() => assertSandboxTestPay('sandbox', 'wl_test_fixture')).not.toThrow();
    for (const [environment, key] of [['production', 'wl_live_fixture'], ['production', 'wl_test_fixture'],
      ['sandbox', 'wl_live_fixture'], ['sandbox', ''], ['live', 'wl_test_fixture']]) {
      expect(() => assertSandboxTestPay(environment, key)).toThrow();
    }
  });
});
