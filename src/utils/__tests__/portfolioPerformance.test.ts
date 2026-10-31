import { describe, expect, it } from 'vitest';
import type { CashMovement, Loan } from '../../types';
import { calculatePortfolioPerformance } from '../portfolioPerformance';

const loan = (overrides: Partial<Loan> = {}): Loan => ({
  id: 'L1', customerId: 'C1', customerName: 'Cliente', amount: 1000,
  interestRate: 10, frequency: 'MENSAL', interestType: 'SIMPLES',
  startDate: '2026-01-01', status: 'ATIVO',
  installments: [{
    number: 1, amount: 1100, dueDate: '2026-02-01', status: 'PAGO',
    paymentEntries: [{ id: 'P1', operationId: 'P1', recordedAt: '2026-02-03',
      principalPaid: 900, interestPaid: 80, lateFeePaid: 20,
      serviceFeePaid: 0, discountApplied: 100, totalPaid: 1000 }],
  }],
  ...overrides,
});
const movement = (type: CashMovement['type'], amount: number, operationId: string): CashMovement => ({
  type, amount, operationId, loanId: 'L1', date: '2026-02-03', description: type === 'RETIRADA' ? 'EMPRESTIMO' : 'PAGAMENTO',
});

describe('desempenho da carteira', () => {
  it('separa origem, principal, multas, desconto e renovacao', () => {
    const result = calculatePortfolioPerformance([
      loan(), loan({ id: 'L2', formalizationType: 'BANCARIZED', provider: 'CREDIGRUPO',
        renewalHistory: [{ id: 'R1', type: 'interest_only_renewal', amount: 50, interestPaid: 50,
          paymentDate: '2026-05-01' }], installments: [] }),
    ], [movement('RETIRADA', 1000, 'loan-created-L1'), movement('PAGAMENTO', 1000, 'P1')], 2026);
    expect(result).toMatchObject({
      directRevenue: 100, bancarizedRevenue: 50, principalRecovered: 900,
      lateFeesReceived: 20, discountsGranted: 100, renewalRevenue: 50,
      principalLent: 1000, recoveryOnConcessionsPercent: 90,
    });
  });
});
