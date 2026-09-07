import { describe, expect, it } from 'vitest';
import { buildHomologationAuditSummary, buildSandboxHomologationAuditSummary } from '../homologationAudit.js';

describe('buildHomologationAuditSummary', () => {
  it('preserva apenas metadados operacionais seguros da homologacao', () => {
    const summary = buildHomologationAuditSummary({
      customerId: 'customer-test',
      customer: { environment: 'sandbox', testData: true, name: 'Dado que nao deve sair' },
      borrowers: [{ id: 'borrower-link', data: { borrowerId: 'borrower-123456', kycStatus: 'approved', document: '123' } }],
      simulations: [{ id: 'simulation-1', data: { response: { externalId: 'SIM-123' }, testData: true } }],
      operations: [{ id: 'operation-1', data: { proposalId: 'proposal-1', status: 'CREATE_FAILED' } }],
      loans: [],
      cashMovements: [],
      ledgerEntries: [{ id: 'ledger-1', data: { document: 'nao deve sair' } }],
    });

    expect(summary.customer).toEqual({ id: 'customer-test', exists: true, name: 'Dado que nao deve sair', environment: 'sandbox', testData: true, archived: false });
    expect(summary.borrowerLinks[0]).toMatchObject({ id: 'borrower-link', borrowerId: 'borrower-123456' });
    expect(JSON.stringify(summary)).toContain('Dado que nao deve sair');
    expect(JSON.stringify(summary)).not.toContain('"document"');
    expect(summary.linkedCounts).toEqual({
      contracts: 0,
      cashMovements: 0,
      ledgerEntries: 1,
      realContracts: 0,
      realCashMovements: 0,
      realLedgerEntries: 1,
    });
  });

  it('consolida apenas identificadores e denuncia efeitos reais vinculados', () => {
    const first = buildHomologationAuditSummary({
      customerId: 'customer-1',
      customer: { name: 'Cliente Teste', environment: 'sandbox', testData: true },
      borrowers: [{ id: 'borrower-link-1', data: { borrowerId: 'borrower-1', environment: 'sandbox', testData: true } }],
      simulations: [{ id: 'simulation-1', data: { response: { externalId: 'SIM-1' }, environment: 'sandbox', testData: true } }],
      operations: [{ id: 'operation-1', data: { proposalId: 'proposal-1', environment: 'sandbox', testData: true } }],
      loans: [],
      cashMovements: [],
      ledgerEntries: [],
    });
    const second = buildHomologationAuditSummary({
      customerId: 'customer-2',
      customer: { name: 'Robson Leandro', environment: 'sandbox', testData: true },
      borrowers: [],
      simulations: [],
      operations: [],
      loans: [{ id: 'loan-1', data: {} }],
      cashMovements: [{ id: 'cash-1', data: {} }],
      ledgerEntries: [{ id: 'ledger-1', data: {} }],
    });

    expect(buildSandboxHomologationAuditSummary([first, second])).toMatchObject({
      robsonLeandro: { hasSeparateLocalCustomer: true, localCustomerIds: ['customer-2'] },
      totals: {
        customerIds: 2,
        borrowerIds: 1,
        simulations: 1,
        operations: 1,
        proposals: 1,
        realContractsAffected: 1,
        realCashMovementsAffected: 1,
        realLedgerEntriesAffected: 1,
      },
    });
  });
});
