import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getDocsFromServer: vi.fn(),
  runTransaction: vi.fn(),
  get: vi.fn(),
  set: vi.fn(),
}));
vi.mock('../../firebase', () => ({ db: {} }));
vi.mock('firebase/firestore', () => ({
  collection: (_db: unknown, path: string) => path,
  doc: (_db: unknown, ...path: string[]) => path.join('/'),
  getDocsFromServer: mocks.getDocsFromServer,
  runTransaction: mocks.runTransaction,
  serverTimestamp: () => 'server-time',
}));

import { recalculateCashBalance } from '../cashService';

const ledger = (amount: number) => ({
  metadata: { fromCache: false, hasPendingWrites: false },
  docs: [{ id: 'deposit', data: () => ({ type: 'APORTE', amount, date: '2026-11-01', description: 'Fixture' }) }],
});

beforeEach(() => {
  vi.resetAllMocks();
  mocks.get.mockResolvedValue({ exists: () => true, data: () => ({ value: 999 }) });
  mocks.getDocsFromServer.mockResolvedValue(ledger(100));
  mocks.runTransaction.mockImplementation(async (_db, callback) => callback({ get: mocks.get, set: mocks.set }));
});

describe('reconciliacao protegida do caixa', () => {
  it('le o caixa antes do livro e grava somente o saldo em transacao', async () => {
    expect(await recalculateCashBalance({ uid: 'admin' })).toBe(100);
    expect(mocks.get).toHaveBeenCalledWith('settings/caixa');
    expect(mocks.get.mock.invocationCallOrder[0]).toBeLessThan(mocks.getDocsFromServer.mock.invocationCallOrder[0]);
    expect(mocks.set).toHaveBeenCalledExactlyOnceWith('settings/caixa', {
      value: 100, reconciledByUid: 'admin', reconciledAt: 'server-time', updatedAt: 'server-time',
    }, { merge: true });
  });

  it('refaz a consulta do livro quando o Firestore repete a transacao', async () => {
    mocks.getDocsFromServer.mockResolvedValueOnce(ledger(100)).mockResolvedValueOnce(ledger(150));
    const discardedWrite = vi.fn();
    mocks.runTransaction.mockImplementation(async (_db, callback) => {
      await callback({ get: mocks.get, set: discardedWrite });
      return callback({ get: mocks.get, set: mocks.set });
    });
    expect(await recalculateCashBalance({ uid: 'admin' })).toBe(150);
    expect(mocks.getDocsFromServer).toHaveBeenCalledTimes(2);
    expect(mocks.set.mock.calls[0][1].value).toBe(150);
  });

  it.each([
    { fromCache: true, hasPendingWrites: false },
    { fromCache: false, hasPendingWrites: true },
  ])('nao grava a partir de dados nao confirmados: %j', async (metadata) => {
    mocks.getDocsFromServer.mockResolvedValue({ ...ledger(100), metadata });
    await expect(recalculateCashBalance({ uid: 'admin' })).rejects.toThrow('CAIXA_AGUARDANDO_SINCRONIZACAO');
    expect(mocks.set).not.toHaveBeenCalled();
  });

  it('nao grava se a consulta ao servidor falhar', async () => {
    mocks.getDocsFromServer.mockRejectedValue(new Error('unavailable'));
    await expect(recalculateCashBalance({ uid: 'admin' })).rejects.toThrow('unavailable');
    expect(mocks.set).not.toHaveBeenCalled();
  });
});
