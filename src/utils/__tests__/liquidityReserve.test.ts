import { describe, expect, it } from 'vitest';
import { assessLiquidityReserve } from '../liquidityReserve';

describe('reserva minima de caixa', () => {
  it('nao alerta quando o caixa projetado fica acima de R$ 3.000', () => {
    expect(assessLiquidityReserve(8000, 4000)).toEqual({
      projectedCash: 4000,
      availableToLend: 5000,
      shouldWarn: false,
    });
  });

  it('alerta ao atingir exatamente a reserva, sem impedir a concessao', () => {
    expect(assessLiquidityReserve(8000, 5000)).toEqual({
      projectedCash: 3000,
      availableToLend: 5000,
      shouldWarn: true,
    });
  });

  it('alerta quando o caixa ja esta abaixo da reserva', () => {
    expect(assessLiquidityReserve(2500, 500)).toEqual({
      projectedCash: 2000,
      availableToLend: 0,
      shouldWarn: true,
    });
  });
});
