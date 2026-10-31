import { describe, expect, it } from 'vitest';
import type { Loan } from '../../types';
import { calculateCustomerFinancialSummary } from '../customerFinancialSummary';

const loan = (overrides: Partial<Loan> = {}): Loan => ({
  id: 'loan-1', customerId: 'customer-1', customerName: 'Cliente', amount: 1000,
  interestRate: 10, frequency: 'MENSAL', interestType: 'SIMPLES',
  startDate: '2026-08-01', status: 'QUITADO',
  installments: [{
    number: 1, amount: 1100, dueDate: '2026-09-01', status: 'PAGO', paidAmount: 1060,
    paymentBreakdown: {
      principalPaid: 1000, interestPaid: 50, lateFeePaid: 10,
      serviceFeePaid: 0, discountApplied: 40, totalPaid: 1060,
    },
  }],
  ...overrides,
});

describe('resumo gerencial por cliente', () => {
  it('separa principal, receitas, descontos e renovacoes', () => {
    const result = calculateCustomerFinancialSummary('customer-1', [loan({ renewCount: 2 })], 0);
    expect(result).toMatchObject({
      totalBorrowed: 1000, totalReceived: 1060, principalRecovered: 1000,
      realProfit: 60, discountsGranted: 40, renewals: 2, roi: 6,
    });
  });

  it('nao inventa principal recuperado para pagamento legado sem discriminacao', () => {
    const result = calculateCustomerFinancialSummary('customer-1', [loan({
      installments: [{ number: 1, amount: 1100, dueDate: '2026-09-01', status: 'PAGO', paidAmount: 1100 }],
    })], 0);
    expect(result.totalReceived).toBe(1100);
    expect(result.principalRecovered).toBe(0);
  });
});
