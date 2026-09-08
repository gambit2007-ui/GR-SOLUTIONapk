import { describe, expect, it } from 'vitest';
import { getHomologationArchiveBlocker } from '../homologationArchive.js';
import type { HomologationAuditCustomerSummary } from '../homologationAudit.js';

const audit = (overrides: Partial<HomologationAuditCustomerSummary> = {}): HomologationAuditCustomerSummary => ({
  customer: { id: 'customer-test', exists: true },
  borrowerLinks: [{ id: 'borrower-link', borrowerId: 'borrower-test', environment: 'sandbox', testData: true }],
  simulations: [{ id: 'simulation-test', environment: 'sandbox', testData: true }],
  operations: [{ id: 'operation-test', environment: 'sandbox', testData: true }],
  linkedCounts: {
    contracts: 0,
    cashMovements: 0,
    ledgerEntries: 0,
    realContracts: 0,
    realCashMovements: 0,
    realLedgerEntries: 0,
  },
  ...overrides,
});

describe('getHomologationArchiveBlocker', () => {
  it('permite arquivar homologacao sandbox sem efeito financeiro, inclusive cliente legado sem marcador', () => {
    expect(getHomologationArchiveBlocker(audit())).toBeNull();
  });

  it('bloqueia qualquer vinculo financeiro', () => {
    expect(getHomologationArchiveBlocker(audit({
      linkedCounts: { ...audit().linkedCounts, cashMovements: 1 },
    }))).toBe('FINANCIAL_EFFECT_FOUND');
  });

  it('permite vinculos legados sem marcador quando a operacao sandbox foi confirmada pelo servidor', () => {
    expect(getHomologationArchiveBlocker(audit({
      simulations: [{ id: 'simulation-legacy' }],
    }))).toBeNull();
  });

  it('bloqueia registros Credigrupo com escopo sandbox inconsistente', () => {
    expect(getHomologationArchiveBlocker(audit({
      operations: [{ id: 'operation-test', environment: 'sandbox', testData: false }],
    }))).toBe('UNCONFIRMED_SANDBOX_RECORD');
  });

  it('bloqueia qualquer vinculo marcado como producao', () => {
    expect(getHomologationArchiveBlocker(audit({
      operations: [{ id: 'operation-test', environment: 'production', testData: false }],
    }))).toBe('UNCONFIRMED_SANDBOX_RECORD');
  });
});
