import { describe, expect, it } from 'vitest';
import {
  maskCredigrupoInvestorId,
  resolveFundingInvestorInternalId,
} from '../grInvestorSettings';

describe('configuracao do investidor Credigrupo da GR', () => {
  it('usa exclusivamente o vinculo configurado para capital GR', () => {
    expect(resolveFundingInvestorInternalId('GR', 'investidor-manual', {
      grInvestorConfigured: true,
      grInvestorInternalId: 'gr-local-1',
      grInvestorId: 'gr-external-1',
    })).toBe('gr-local-1');
  });

  it('bloqueia capital GR quando o vinculo nao esta configurado', () => {
    expect(() => resolveFundingInvestorInternalId('GR', undefined, undefined)).toThrowError(expect.objectContaining({
      code: 'GR_INVESTOR_NOT_CONFIGURED',
      message: 'Investidor Credigrupo da GR ainda nao configurado.',
    }));
  });

  it('mantem obrigatoria a selecao no capital externo', () => {
    expect(resolveFundingInvestorInternalId('EXTERNAL', 'external-local-1')).toBe('external-local-1');
    expect(() => resolveFundingInvestorInternalId('EXTERNAL', '')).toThrowError(expect.objectContaining({
      code: 'INVESTOR_REQUIRED',
    }));
  });

  it('mascara o investorId sem alterar o valor armazenado', () => {
    expect(maskCredigrupoInvestorId('1234567890abcdef')).toBe('1234...cdef');
  });
});
