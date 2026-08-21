import { describe, expect, it } from 'vitest';
import { calculateDelinquencyRate } from '../delinquencyRate';

describe('calculateDelinquencyRate', () => {
  it('calcula a proporcao de contratos ativos em atraso', () => {
    expect(calculateDelinquencyRate(7, 42)).toBe(16.67);
  });

  it('evita divisao por zero', () => {
    expect(calculateDelinquencyRate(3, 0)).toBe(0);
  });

  it('limita resultados inconsistentes ao intervalo entre zero e cem', () => {
    expect(calculateDelinquencyRate(-1, 10)).toBe(0);
    expect(calculateDelinquencyRate(11, 10)).toBe(100);
  });
});
