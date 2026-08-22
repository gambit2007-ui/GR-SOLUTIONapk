import { describe, expect, it } from 'vitest';
import { parseLoan } from '../domainParsers';

describe('normalizacao de contratos', () => {
  it('trata contratos legados como GR Direto', () => {
    const loan = parseLoan('legacy', {
      customerId: 'customer-1', customerName: 'Cliente', amount: 100,
      interestRate: 10, frequency: 'MENSAL', interestType: 'SIMPLES',
      startDate: '2026-01-01', status: 'ATIVO', installments: [],
    });

    expect(loan.formalizationType).toBe('DIRECT');
    expect(loan.provider).toBe('GR');
  });

  it('preserva investidor e identificadores da Credigrupo', () => {
    const loan = parseLoan('ccb', {
      customerId: 'customer-1', customerName: 'Cliente', amount: 100,
      interestRate: 10, frequency: 'MENSAL', interestType: 'SIMPLES',
      startDate: '2026-01-01', status: 'ATIVO', formalizationType: 'BANCARIZED',
      provider: 'CREDIGRUPO', funding: { source: 'EXTERNAL', investorId: 'investor-1', investorName: 'Investidor' },
      credigrupo: { proposalId: 'proposal-1', externalStatus: 'funded' },
      installments: [{ number: 1, amount: 110, dueDate: '2026-02-01', status: 'PENDENTE', credigrupo: { installmentId: 'external-1' } }],
    });

    expect(loan).toMatchObject({
      formalizationType: 'BANCARIZED',
      provider: 'CREDIGRUPO',
      funding: { source: 'EXTERNAL', investorId: 'investor-1' },
      credigrupo: { proposalId: 'proposal-1', externalStatus: 'funded' },
    });
    expect(loan.installments[0].credigrupo?.installmentId).toBe('external-1');
  });

  it('preserva identificadores e valores negativos das entradas de estorno', () => {
    const loan = parseLoan('loan-1', {
      customerId: 'customer-1',
      customerName: 'Cliente',
      amount: 100,
      interestRate: 10,
      frequency: 'MENSAL',
      interestType: 'PRICE',
      startDate: '2026-01-01',
      status: 'ATIVO',
      installments: [{
        number: 1,
        amount: 110,
        dueDate: '2026-02-01',
        status: 'PENDENTE',
        paymentEntries: [{
          id: 'reversal-entry',
          operationId: 'reversal-operation',
          installmentNumber: 1,
          recordedAt: '2026-02-02T12:00:00.000Z',
          kind: 'REVERSAL',
          principalPaid: -40,
          interestPaid: -10,
          lateFeePaid: 0,
          serviceFeePaid: 0,
          discountApplied: 0,
          totalPaid: -50,
        }],
      }],
    });

    expect(loan.installments[0].paymentEntries?.[0]).toMatchObject({
      operationId: 'reversal-operation',
      installmentNumber: 1,
      kind: 'REVERSAL',
      principalPaid: -40,
      interestPaid: -10,
      totalPaid: -50,
    });
  });
});
