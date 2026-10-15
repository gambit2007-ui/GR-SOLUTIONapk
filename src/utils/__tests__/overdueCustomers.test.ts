import { describe, expect, it } from 'vitest';
import type { Installment, Loan } from '../../types';
import { buildOverdueCustomerCards } from '../overdueCustomers';

const referenceDate = new Date('2026-09-22T12:00:00Z');
const installment = (dueDate: string, amount: number, number = 1): Installment => ({
  number, dueDate, amount, paidAmount: 0, status: 'PENDENTE',
});
const loan = (id: string, customerId: string, name: string, installments: Installment[]): Loan => ({
  id, customerId, customerName: name, amount: 100, interestRate: 10,
  frequency: 'MENSAL', interestType: 'SIMPLES', startDate: '2026-08-01',
  status: 'ATIVO', installments,
});

describe('overdue customer cards', () => {
  it('shows 20 days before 1 day', () => {
    const cards = buildOverdueCustomerCards([
      loan('one', 'one', 'Cliente Um', [installment('2026-09-21', 100)]),
      loan('twenty', 'twenty', 'Cliente Vinte', [installment('2026-09-02', 100)]),
    ], referenceDate, 0);
    expect(cards.map((item) => item.maxOverdueDays)).toEqual([20, 1]);
  });

  it('breaks a 5-day tie by overdue amount, then by name', () => {
    const cards = buildOverdueCustomerCards([
      loan('small', 'small', 'Zelia', [installment('2026-09-17', 500)]),
      loan('large', 'large', 'Bruno', [installment('2026-09-17', 2_000)]),
      loan('same', 'same', 'Ana', [installment('2026-09-17', 500)]),
    ], referenceDate, 0);
    expect(cards.map((item) => item.customerId)).toEqual(['large', 'same', 'small']);
  });

  it('uses the largest day and sums overdue installments across a customer’s contracts', () => {
    const cards = buildOverdueCustomerCards([
      loan('a', 'same', 'Cliente', [installment('2026-09-19', 100), installment('2026-09-14', 200, 2)]),
      loan('b', 'same', 'Cliente', [installment('2026-08-31', 300)]),
    ], referenceDate, 0);
    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({
      maxOverdueDays: 22, overdueAmount: 600, overdueInstallmentCount: 3,
      overdueContractCount: 2, navigationLoanId: 'b',
    });
  });

  it('sums the remaining overdue balance after partial payment', () => {
    const cards = buildOverdueCustomerCards([
      loan('partial', 'same', 'Cliente', [{
        ...installment('2026-09-19', 500), paidAmount: 200,
      }, installment('2026-09-01', 700, 2)]),
    ], referenceDate, 0);
    expect(cards[0]).toMatchObject({ overdueAmount: 1_000, maxOverdueDays: 21 });
  });
});
