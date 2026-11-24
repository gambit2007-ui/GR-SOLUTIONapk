import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, getDoc, getDocsFromServer, collection, setDoc } from 'firebase/firestore';
import type { Firestore } from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  db: null as unknown as Firestore,
  afterLedgerRead: undefined as (() => Promise<void>) | undefined,
  reads: 0,
}));
vi.mock('../firebase', () => ({ get db() { return state.db; } }));
vi.mock('firebase/firestore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('firebase/firestore')>();
  return {
    ...actual,
    getDocsFromServer: async (...args: Parameters<typeof actual.getDocsFromServer>) => {
      const snapshot = await actual.getDocsFromServer(...args);
      state.reads += 1;
      const hook = state.afterLedgerRead;
      state.afterLedgerRead = undefined;
      if (hook) await hook();
      return snapshot;
    },
  };
});

let environment: RulesTestEnvironment;
let service: typeof import('../services/cashService');

beforeAll(async () => {
  // Never initialize this test against a configured production project.
  if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error('FIRESTORE_EMULATOR_REQUIRED');
  environment = await initializeTestEnvironment({
    projectId: 'demo-gr-cash-reconciliation',
    firestore: { rules: readFileSync('firestore.rules', 'utf8') },
  });
  state.db = environment.authenticatedContext('admin').firestore() as unknown as Firestore;
  service = await import('../services/cashService');
});

beforeEach(async () => {
  await environment.clearFirestore();
  state.reads = 0;
  state.afterLedgerRead = undefined;
  await environment.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, 'settings', 'accessControl'), { enforced: true });
    await setDoc(doc(db, 'authorizedUsers', 'admin'), { role: 'ADMIN' });
    await setDoc(doc(db, 'settings', 'caixa'), { value: 999 });
    await setDoc(doc(db, 'cashMovement', 'original'), {
      type: 'APORTE', amount: 100, date: '2026-11-01', description: 'Synthetic opening deposit',
    });
  });
});

afterAll(async () => { await environment?.cleanup(); });

describe('reconciliacao concorrente no emulador', () => {
  it('refaz o calculo se um movimento for confirmado entre a leitura e o commit', async () => {
    state.afterLedgerRead = () => service.addCashMovement({
      type: 'APORTE', amount: 50, description: 'Synthetic concurrent deposit', actor: { uid: 'admin' },
    });
    const result = await service.recalculateCashBalance({ uid: 'admin' });
    expect(result).toBe(150);
    expect(state.reads).toBeGreaterThanOrEqual(2);
    expect((await getDoc(doc(state.db, 'settings', 'caixa'))).data()?.value).toBe(150);
    const ledger = await getDocsFromServer(collection(state.db, 'cashMovement'));
    expect(ledger.size).toBe(2);
    expect((await getDoc(doc(state.db, 'cashMovement', 'original'))).data()?.amount).toBe(100);
  });

  it('reconcilia sem criar ou alterar registros do livro', async () => {
    expect(await service.recalculateCashBalance({ uid: 'admin' })).toBe(100);
    expect((await getDocsFromServer(collection(state.db, 'cashMovement'))).size).toBe(1);
  });
});
