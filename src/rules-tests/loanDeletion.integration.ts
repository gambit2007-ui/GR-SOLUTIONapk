import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, deleteDoc, type Firestore } from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ db: null as unknown as Firestore,
  afterLedgerRead: undefined as (() => Promise<void>) | undefined }));
vi.mock('../firebase', () => ({ get db() { return state.db; }, auth: { currentUser: null } }));
vi.mock('firebase/firestore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('firebase/firestore')>();
  return { ...actual, getDocsFromServer: async (...args: Parameters<typeof actual.getDocsFromServer>) => {
    const snapshot = await actual.getDocsFromServer(...args);
    const hook = state.afterLedgerRead;
    state.afterLedgerRead = undefined;
    if (hook) await hook();
    return snapshot;
  } };
});
let environment: RulesTestEnvironment;
let service: typeof import('../services/loanService');
const loanId = 'synthetic-deletion';
const originalId = `loan-created-${loanId}`;
const reversalId = `loan-deletion-reversal-${loanId}`;
const auditId = `loan-deleted-${loanId}`;

beforeAll(async () => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error('FIRESTORE_EMULATOR_REQUIRED');
  environment = await initializeTestEnvironment({ projectId: 'demo-gr-loan-deletion',
    // Read-only snapshot of the rules already deployed on 2026-11-27:
    // fd4fe9e2-c1b4-4558-8120-e85c7c509aef. Never deploy this test fixture.
    firestore: { rules: readFileSync('src/rules-tests/fixtures/deployed-deletion.rules', 'utf8') } });
  state.db = environment.authenticatedContext('admin').firestore() as unknown as Firestore;
  service = await import('../services/loanService');
});
beforeEach(async () => {
  state.afterLedgerRead = undefined;
  await environment.clearFirestore();
  await environment.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, 'settings', 'accessControl'), { enforced: true });
    await setDoc(doc(db, 'authorizedUsers', 'admin'), { role: 'ADMIN' });
    await setDoc(doc(db, 'settings', 'caixa'), { value: 500 });
    await setDoc(doc(db, 'loans', loanId), {
      customerId: 'fixture', customerName: 'Synthetic fixture', amount: 1000,
      interestRate: 30, frequency: 'MENSAL', interestType: 'SIMPLES', startDate: '2026-11-27',
      status: 'ATIVO', formalizationType: 'DIRECT', provider: 'GR', version: 0,
      hasFinancialHistory: false, paidAmount: 0, contractNumber: '2026001',
      lastOperationId: originalId, lastOperationType: 'LOAN_CREATED',
      installments: [{ number: 1, amount: 1300, dueDate: '2026-11-27', status: 'PENDENTE', paidAmount: 0 }],
    });
    await setDoc(doc(db, 'cashMovement', originalId), {
      type: 'RETIRADA', amount: 1000, value: 1000, loanId, operationId: originalId,
      description: 'Synthetic grant', date: '2026-11-27', createdByUid: 'admin',
    });
  });
});
afterAll(async () => { await environment?.cleanup(); });

describe('exclusao pela funcao usada no app', () => {
  it('exclui contrato e retirada sem criar estorno, preservando auditoria e idempotencia', async () => {
    await service.deletePristineDirectLoan(loanId, { uid: 'admin' });
    expect((await getDoc(doc(state.db, 'loans', loanId))).exists()).toBe(false);
    expect((await getDoc(doc(state.db, 'cashMovement', originalId))).exists()).toBe(false);
    expect((await getDoc(doc(state.db, 'cashMovement', reversalId))).exists()).toBe(false);
    expect((await getDoc(doc(state.db, 'financialAuditEvents', auditId))).data()?.newCash).toBe(1500);
    expect((await getDoc(doc(state.db, 'settings', 'caixa'))).data()?.value).toBe(1500);
    await expect(service.deletePristineDirectLoan(loanId, { uid: 'admin' })).rejects.toThrow();
    expect((await getDoc(doc(state.db, 'settings', 'caixa'))).data()?.value).toBe(1500);
  });

  const patchLoan = async (data: Record<string, unknown>) => environment.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), 'loans', loanId), data, { merge: true });
  });
  const expectUnchanged = async (cash = 500) => {
    expect((await getDoc(doc(state.db, 'loans', loanId))).exists()).toBe(true);
    expect((await getDoc(doc(state.db, 'cashMovement', originalId))).exists()).toBe(true);
    expect((await getDoc(doc(state.db, 'cashMovement', reversalId))).exists()).toBe(false);
    expect((await getDoc(doc(state.db, 'financialAuditEvents', auditId))).exists()).toBe(false);
    expect((await getDoc(doc(state.db, 'settings', 'caixa'))).data()?.value).toBe(cash);
  };

  it('permite cancelamento imediato sem historico', async () => {
    await patchLoan({ status: 'CANCELADO', version: 1, lastOperationType: 'CANCELLATION', cancellationReason: 'Duplicado' });
    await service.deletePristineDirectLoan(loanId, { uid: 'admin' });
    expect((await getDoc(doc(state.db, 'loans', loanId))).exists()).toBe(false);
    expect((await getDoc(doc(state.db, 'settings', 'caixa'))).data()?.value).toBe(1500);
  });

  it.each([
    { paidAmount: 10 }, { hasFinancialHistory: true }, { renewCount: 1 },
    { renewalHistory: [{ amount: 30 }] }, { fiscalPaymentEntries: [{ legacy: true }] },
    { maxHistoricalOverdueDays: 1 }, { version: 1, lastOperationType: 'CONTRACT_EDIT' },
    { status: 'CANCELADO', version: 2, lastOperationType: 'CANCELLATION', cancellationReason: 'Duplicado' },
    { installments: [{ number: 1, amount: 1300, status: 'PENDENTE', paymentEntries: [{ legacy: true }] }] },
    { installments: [{ number: 1, amount: 1300, status: 'PAGO', paidAmount: 0 }] },
  ])('bloqueia historico ou alteracao anterior: %j', async (data) => {
    await patchLoan(data);
    await expect(service.deletePristineDirectLoan(loanId, { uid: 'admin' })).rejects.toThrow('CONTRATO_NAO_ELEGIVEL');
    await expectUnchanged();
  });

  it('bloqueia contrato bancarizado', async () => {
    await patchLoan({ formalizationType: 'BANCARIZED', provider: 'CREDIGRUPO' });
    await expect(service.deletePristineDirectLoan(loanId, { uid: 'admin' })).rejects.toThrow('CONTRATO_BANCARIZADO');
    await expectUnchanged();
  });

  it('bloqueia retirada com valor divergente', async () => {
    await environment.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'cashMovement', originalId), { amount: 999 }, { merge: true });
    });
    await expect(service.deletePristineDirectLoan(loanId, { uid: 'admin' })).rejects.toThrow('MOVIMENTO_ORIGINAL_INVALIDO');
    await expectUnchanged();
  });

  it('preserva mes fechado', async () => {
    await environment.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'monthlySnapshots', '2026-11'), { month: '2026-11', status: 'CLOSED' });
    });
    await expect(service.deletePristineDirectLoan(loanId, { uid: 'admin' })).rejects.toThrow('MOVIMENTO_EM_MES_FECHADO');
    await expectUnchanged();
  });

  it('bloqueia retirada ausente sem modificar saldo nem excluir contrato', async () => {
    await environment.withSecurityRulesDisabled(async (context) => { await deleteDoc(doc(context.firestore(), 'cashMovement', originalId)); });
    await expect(service.deletePristineDirectLoan(loanId, { uid: 'admin' })).rejects.toThrow('MOVIMENTO_ORIGINAL_NAO_ENCONTRADO');
    expect((await getDoc(doc(state.db, 'loans', loanId))).exists()).toBe(true);
    expect((await getDoc(doc(state.db, 'settings', 'caixa'))).data()?.value).toBe(500);
  });

  const addLinkedMovement = async () => environment.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), 'cashMovement', 'extra'), { loanId, type: 'SAIDA', amount: 50, date: '2026-11-27' });
    await setDoc(doc(context.firestore(), 'settings', 'caixa'), { value: 450 });
  });
  it('bloqueia outras movimentacoes vinculadas', async () => {
    await addLinkedMovement();
    await expect(service.deletePristineDirectLoan(loanId, { uid: 'admin' })).rejects.toThrow('CONTRATO_POSSUI_MOVIMENTACOES');
    await expectUnchanged(450);
  });
  it('bloqueia exclusao parcial quando ha movimentacao concorrente', async () => {
    state.afterLedgerRead = addLinkedMovement;
    const error = await service.deletePristineDirectLoan(loanId, { uid: 'admin' }).then(
      () => null, (failure: { code?: string; message?: string }) => failure,
    );
    // Depending on Rules evaluation order, Firestore may deny the stale commit
    // before retrying. Both paths must preserve the concurrent movement and cash.
    expect(error?.code === 'permission-denied' || error?.message === 'CONTRATO_POSSUI_MOVIMENTACOES_VINCULADAS').toBe(true);
    await expectUnchanged(450);
    expect((await getDoc(doc(state.db, 'cashMovement', 'extra'))).data()?.amount).toBe(50);
  });
  it('duas solicitacoes nao recompoem o saldo duas vezes', async () => {
    const results = await Promise.allSettled([
      service.deletePristineDirectLoan(loanId, { uid: 'admin' }),
      service.deletePristineDirectLoan(loanId, { uid: 'admin' }),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect((await getDoc(doc(state.db, 'settings', 'caixa'))).data()?.value).toBe(1500);
    expect((await getDoc(doc(state.db, 'loans', loanId))).exists()).toBe(false);
    expect((await getDoc(doc(state.db, 'cashMovement', originalId))).exists()).toBe(false);
    expect((await getDoc(doc(state.db, 'financialAuditEvents', auditId))).exists()).toBe(true);
  });
  it('respeita as permissoes existentes sem alterar dados', async () => {
    await environment.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'authorizedUsers', 'admin'), { role: 'USER' });
    });
    await expect(service.deletePristineDirectLoan(loanId, { uid: 'admin' })).rejects.toMatchObject({ code: 'permission-denied' });
    expect((await getDoc(doc(state.db, 'loans', loanId))).exists()).toBe(true);
    expect((await getDoc(doc(state.db, 'settings', 'caixa'))).data()?.value).toBe(500);
  });
});
