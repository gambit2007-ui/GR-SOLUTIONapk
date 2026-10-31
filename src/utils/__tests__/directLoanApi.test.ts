import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  documents: new Map<string, Record<string, unknown>>(),
  writes: [] as Array<{ kind: string; path: string; data: Record<string, unknown> }>,
}));

vi.mock('../../../api/_lib/firebaseAdmin.js', () => {
  const doc = (path: string) => ({ path, id: path.split('/').at(-1) });
  return {
    adminDb: {
      doc,
      collection: (name: string) => ({ doc: (id = 'new-loan-1') => doc(`${name}/${id}`) }),
      runTransaction: async (callback: (transaction: unknown) => Promise<unknown>) => callback({
        get: async (reference: { path: string }) => ({
          exists: state.documents.has(reference.path),
          data: () => state.documents.get(reference.path),
        }),
        create: (reference: { path: string }, data: Record<string, unknown>) =>
          state.writes.push({ kind: 'create', path: reference.path, data }),
        set: (reference: { path: string }, data: Record<string, unknown>) =>
          state.writes.push({ kind: 'set', path: reference.path, data }),
      }),
    },
  };
});
vi.mock('../../../api/_lib/auth.js', () => ({
  requireAuthorizedActor: async () => ({ uid: 'admin-1', email: 'admin@example.com', name: 'Admin', admin: true }),
}));
vi.mock('../../../api/_lib/creditRisk.js', () => ({
  getCustomerCreditRisk: async () => ({
    level: 'GREEN', customerId: 'customer-1', totalContracts: 0, completedContracts: 0,
    activeContracts: 0, overdueContracts: 0, activeLoanIds: [], openAmount: 0,
    overdueAmount: 0, maxCurrentOverdueDays: 0, maxHistoricalOverdueDays: 0,
    realProfit: 0, historyIncomplete: false,
  }),
  requireCreditRiskDecision: () => undefined,
  buildCreditRiskAudit: (_risk: unknown, _decision: unknown, _actor: unknown, _operation: unknown, loanId: string) => ({
    action: 'NEW_CREDIT_GRANT', customerId: 'customer-1', actorUid: 'admin-1', loanId,
  }),
}));

import handler from '../../../api/_lib/directLoans';

beforeEach(() => {
  state.documents.clear();
  state.writes.length = 0;
  state.documents.set('clientes/customer-1', { name: 'Cliente Teste' });
  state.documents.set('settings/caixa', { value: 1_000 });
  state.documents.set('settings/contractCounter', { lastNumber: 2026001 });
});

describe('direct loan server transaction', () => {
  it('creates the contract, original outflow, cash adjustment and risk audit together', async () => {
    const response = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    await handler({ method: 'POST', body: {
      requestId: 'operation-123',
      loan: {
        customerId: 'customer-1', customerName: 'Cliente Teste', amount: 100,
        interestRate: 10, interestType: 'SIMPLES', frequency: 'MENSAL',
        installmentCount: 1, installmentsCount: 1, totalToReturn: 110,
        installmentValue: 110, startDate: '2026-09-22', dueDate: '2026-10-22',
        installments: [{ number: 1, amount: 110, dueDate: '2026-10-22', status: 'PENDENTE', paidAmount: 0 }],
      },
    } } as never, response as never);

    expect(response.status).toHaveBeenCalledWith(201);
    expect(response.json).toHaveBeenCalledWith({ id: 'new-loan-1', contractNumber: '2026002' });
    expect(state.writes.map((item) => item.path)).toEqual([
      'cashMovement/loan-created-new-loan-1', 'loans/new-loan-1',
      'settings/caixa', 'settings/contractCounter', 'creditRiskDecisions/operation-123',
    ]);
    expect(state.writes.find((item) => item.path === 'settings/caixa')?.data.value).toBe(900);
    expect(state.writes.find((item) => item.path === 'loans/new-loan-1')?.data.maxHistoricalOverdueDays).toBe(0);
    expect(state.writes.find((item) => item.path === 'creditRiskDecisions/operation-123')?.data.loanId).toBe('new-loan-1');
  });
});
