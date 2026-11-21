import { describe, expect, it } from 'vitest';
import { calculateNetProfit, calculateNetRoi } from '../netProfit';

describe('lucro liquido realizado', () => {
  it('deduz despesas operacionais e custo de captacao da receita financeira', () => {
    expect(calculateNetProfit(19330.41, 2102.96, 500)).toBe(16727.45);
  });

  it('calcula ROI liquido somente quando houve capital emprestado no periodo', () => {
    expect(calculateNetRoi(16727.45, 45000)).toBe(37.17);
    expect(calculateNetRoi(100, 0)).toBeNull();
  });
});
