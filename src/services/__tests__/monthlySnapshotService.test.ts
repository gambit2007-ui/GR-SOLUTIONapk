import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { canCloseMonth } from '../../utils/dateTime';
import { generateMonthlySnapshot, saveMonthlySnapshot } from '../monthlySnapshotService';

const mocks = vi.hoisted(() => ({ get: vi.fn(), set: vi.fn() }));
vi.mock('../../firebase', () => ({ db: {} }));
vi.mock('firebase/firestore', async (importOriginal) => ({
  ...await importOriginal<typeof import('firebase/firestore')>(),
  doc: (_db: unknown, ...path: string[]) => path.join('/'),
  serverTimestamp: () => 'server-time',
  runTransaction: async (_db: unknown, callback: (tx: typeof mocks) => Promise<void>) => callback(mocks),
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 7, 20, 12));
  mocks.get.mockResolvedValue({ exists: () => false });
});
afterEach(() => vi.useRealTimers());

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

  it('persiste receita, lucro liquido e a mesma versao gerada, sem reabrir o fechamento', async () => {
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
    const original = structuredClone(snapshot);
    await saveMonthlySnapshot(snapshot);
    expect(mocks.set).toHaveBeenCalledWith('monthlySnapshots/2026-07', expect.objectContaining({
      schemaVersion: 3, financialRevenue: 135, netProfit: 100, netRoi: 10, status: 'CLOSED',
    }));
    expect(snapshot).toEqual(original);

    mocks.set.mockClear();
    mocks.get.mockResolvedValue({ exists: () => true });
    await expect(saveMonthlySnapshot(snapshot)).rejects.toThrow('MES_JA_FECHADO');
    expect(mocks.set).not.toHaveBeenCalled();
  });
});
