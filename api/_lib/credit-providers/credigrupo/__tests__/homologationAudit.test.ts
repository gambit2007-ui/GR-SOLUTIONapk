import { describe, expect, it } from 'vitest';
import { buildHomologationAuditSummary } from '../homologationAudit.js';

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

    expect(summary.customer).toEqual({ id: 'customer-test', exists: true, environment: 'sandbox', testData: true, archived: false });
    expect(summary.borrowerLinks[0]).toMatchObject({ id: 'borrower-link', borrowerId: '***123456', kycStatus: 'approved' });
    expect(JSON.stringify(summary)).not.toContain('Dado que nao deve sair');
    expect(JSON.stringify(summary)).not.toContain('"document"');
    expect(summary.ledgerEntries).toEqual([{ id: 'ledger-1' }]);
  });
});
