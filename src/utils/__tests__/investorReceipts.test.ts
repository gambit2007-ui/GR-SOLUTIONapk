import { describe, expect, it } from 'vitest';
import { CashMovement, Loan } from '../../types';
import {
  calculateNetReceivedFromCashMovements,
  groupReceivedCashByInvestor,
} from '../investorReceipts';

const makeLoan = (id: string, investor?: { id: string; name: string }): Loan => ({
  id,
  customerId: `customer-${id}`,
  customerName: `Cliente ${id}`,
  amount: 1000,
  interestRate: 10,
  frequency: 'MENSAL',
  interestType: 'SIMPLES',
  startDate: '2026-08-01',
  installments: [],
  status: 'ATIVO',
  funding: investor
    ? { source: 'EXTERNAL', investorId: investor.id, investorName: investor.name }
    : undefined,
});

const makeMovement = (
  type: CashMovement['type'],
  amount: number,
  loanId?: string,
): CashMovement => ({
  type,
  amount,
  loanId,
  description: type,
  date: '2026-08-23T12:00:00.000Z',
});

describe('investor receipts', () => {
  it('reconcilia pagamentos e estornos com o total líquido do caixa', () => {
    const loans = [makeLoan('gr-loan'), makeLoan('external-loan', { id: 'partner-1', name: 'Parceiro 1' })];
    const movements = [
      makeMovement('PAGAMENTO', 520, 'gr-loan'),
      makeMovement('PAGAMENTO', 300, 'external-loan'),
      makeMovement('ESTORNO', 50, 'external-loan'),
    ];

    const groups = groupReceivedCashByInvestor(loans, movements);

    expect(groups.find((group) => group.investorId === 'GR-SOLUTION')?.received).toBe(520);
    expect(groups.find((group) => group.investorId === 'partner-1')?.received).toBe(250);
    expect(groups.reduce((total, group) => total + group.received, 0)).toBe(
      calculateNetReceivedFromCashMovements(movements),
    );
  });

  it('mantém renovações e movimentos legados sem vínculo na carteira GR', () => {
    const movements = [
      makeMovement('PAGAMENTO', 120),
      makeMovement('PAGAMENTO', 80, 'contrato-removido'),
      makeMovement('ESTORNO', 20),
      makeMovement('SAIDA', 500),
    ];

    expect(groupReceivedCashByInvestor([], movements)).toEqual([
      expect.objectContaining({ investorId: 'GR-SOLUTION', received: 180 }),
    ]);
    expect(calculateNetReceivedFromCashMovements(movements)).toBe(180);
  });
});
