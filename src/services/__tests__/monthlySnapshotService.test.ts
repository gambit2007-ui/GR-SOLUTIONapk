import { describe, expect, it } from 'vitest';
import { canCloseMonth } from '../../utils/dateTime';
import { generateMonthlySnapshot } from '../monthlySnapshotService';

describe('fechamento mensal', () => {
  const referenceDate = new Date(2026, 7, 20, 12, 0, 0);

  it('permite fechar somente competencias anteriores', () => {
    expect(canCloseMonth('2026-07', referenceDate)).toBe(true);
    expect(canCloseMonth('2026-08', referenceDate)).toBe(false);
    expect(canCloseMonth('2026-09', referenceDate)).toBe(false);
  });

  it('rejeita competencias invalidas', () => {
    expect(canCloseMonth('2026-13', referenceDate)).toBe(false);
    expect(canCloseMonth('agosto-2026', referenceDate)).toBe(false);
  });

  it('persiste receita e lucro liquido com campos distintos no fechamento', () => {
    const snapshot = generateMonthlySnapshot({
      month: '2026-07',
      openingCash: 1000,
      closingCash: 1200,
      totalIncome: 500,
      totalExpense: 300,
      principalReceived: 250,
      interestReceived: 120,
      lateFeesReceived: 10,
      serviceFeesReceived: 5,
      realProfit: 135,
      financialRevenue: 135,
      operatingExpenses: 20,
      fundingCost: 15,
      netProfit: 100,
      netRoi: 10,
      lentAmount: 1000,
      roi: 10,
      movementCount: 3,
      createdLoansCount: 1,
    });

    expect(snapshot).toMatchObject({
      schemaVersion: 3,
      financialRevenue: 135,
      operatingExpenses: 20,
      fundingCost: 15,
      netProfit: 100,
      netRoi: 10,
    });
  });
});
