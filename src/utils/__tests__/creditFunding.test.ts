import { describe, expect, it } from 'vitest';
import { resolveBancarizedCashDelta } from '../creditFunding';

describe('resolveBancarizedCashDelta', () => {
  it('movimenta apenas o caixa proprio da GR', () => {
    expect(resolveBancarizedCashDelta('GR', 'LOAN_FUNDED', 1000)).toBe(-1000);
    expect(resolveBancarizedCashDelta('GR', 'INVESTOR_REPAID', 325.5)).toBe(325.5);
    expect(resolveBancarizedCashDelta('GR', 'INSTALLMENT_PAID', 325.5)).toBe(0);
  });

  it('nao mistura capital de investidor externo com o caixa da GR', () => {
    expect(resolveBancarizedCashDelta('EXTERNAL', 'LOAN_FUNDED', 1000)).toBe(0);
    expect(resolveBancarizedCashDelta('EXTERNAL', 'INSTALLMENT_PAID', 325.5)).toBe(0);
    expect(resolveBancarizedCashDelta('EXTERNAL', 'INVESTOR_REPAID', 325.5)).toBe(0);
  });
});
