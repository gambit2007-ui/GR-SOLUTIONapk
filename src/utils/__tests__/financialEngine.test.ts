import { describe, expect, it } from 'vitest';
import type { Installment, Loan } from '../../types';
import { addCalendarMonthsClamped, buildInstallmentDueDate } from '../dateTime';
import {
  applyLoanPaymentToCurrentLoan,
  buildEarlySettlementQuote,
  getInstallmentOutstanding,
} from '../financialEngine';
import { calculateInstallmentLateFee } from '../lateFee';
import { buildPriceBreakdown } from '../paymentBreakdown';

const buildLoan = (installments: Installment[], overrides: Partial<Loan> = {}): Loan => ({
  id: 'loan-1',
  customerId: 'customer-1',
  customerName: 'Cliente',
  amount: 100,
  interestRate: 10,
  frequency: 'MENSAL',
  interestType: 'PRICE',
  startDate: '2026-01-01',
  installments,
  status: 'ATIVO',
  ...overrides,
});

describe('motor financeiro', () => {
  it('aloca pagamento PRICE primeiro nos juros e depois no principal', () => {
    const first = buildPriceBreakdown({
      loan: { id: '1', type: 'PRICE', totalAmount: 100, totalReceivable: 130 },
      installment: { amount: 100, expectedPrincipal: 70, expectedInterest: 30 },
      paidAmount: 30,
    });
    expect(first.interestPaid).toBe(30);
    expect(first.principalPaid).toBe(0);

    const second = buildPriceBreakdown({
      loan: { id: '1', type: 'PRICE', totalAmount: 100, totalReceivable: 130 },
      installment: { amount: 100, expectedPrincipal: 70, expectedInterest: 30 },
      paidAmount: 50,
      previousInterestPaid: first.interestPaid,
      previousPrincipalPaid: first.principalPaid,
    });
    expect(second.interestPaid).toBe(0);
    expect(second.principalPaid).toBe(50);
  });

  it('mantem o ultimo dia valido ao avancar meses', () => {
    expect(addCalendarMonthsClamped('2026-01-31', 1)).toBe('2026-02-28');
    expect(buildInstallmentDueDate('2024-01-31', 1, 'MONTHLY')).toBe('2024-02-29');
  });

  it('calcula multa por trechos depois de pagamento parcial', () => {
    const installment: Installment = {
      number: 1,
      amount: 100,
      dueDate: '2026-01-01',
      status: 'PENDENTE',
      paidAmount: 50,
      paymentEntries: [{
        id: 'pay-1',
        recordedAt: '2026-01-11T12:00:00.000Z',
        kind: 'PAYMENT',
        principalPaid: 50,
        interestPaid: 0,
        lateFeePaid: 0,
        serviceFeePaid: 0,
        discountApplied: 0,
        totalPaid: 50,
      }],
    };

    expect(calculateInstallmentLateFee(installment, new Date('2026-01-21T12:00:00'), 0.01)).toBe(15);
    expect(getInstallmentOutstanding(installment, new Date('2026-01-21T12:00:00'), 0.01)).toEqual({
      base: 50,
      lateFee: 15,
      total: 65,
    });
  });

  it('nao concede desconto a parcela vencida na quitacao PRICE', () => {
    const loan = buildLoan([
      { number: 1, amount: 110, expectedPrincipal: 100, expectedInterest: 10, dueDate: '2026-01-01', status: 'PENDENTE' },
      { number: 2, amount: 110, expectedPrincipal: 100, expectedInterest: 10, dueDate: '2026-03-01', status: 'PENDENTE' },
    ], { amount: 200 });
    const quote = buildEarlySettlementQuote(loan, new Date('2026-02-01T12:00:00'), 0);

    expect(quote).not.toBeNull();
    expect(quote?.entries[0].discount).toBe(0);
    expect(quote?.entries[0].payable).toBe(110);
    expect(quote?.entries[1].discount).toBe(10);
    expect(quote?.entries[1].payable).toBe(100);
  });

  it('quita PRICE preservando todo o principal e descontando apenas juros futuros', () => {
    const loan = buildLoan([
      { number: 1, amount: 110, expectedPrincipal: 100, expectedInterest: 10, dueDate: '2026-09-01', status: 'PENDENTE' },
      { number: 2, amount: 110, expectedPrincipal: 100, expectedInterest: 10, dueDate: '2026-10-01', status: 'PENDENTE' },
    ], { amount: 200 });
    const result = applyLoanPaymentToCurrentLoan(loan, {
      operationId: 'settlement-1',
      installmentIndex: 0,
      applyMode: 'EARLY_SETTLEMENT',
      processedAt: '2026-08-19T12:00:00.000Z',
    }, 0);

    expect(result.loan.status).toBe('QUITADO');
    expect(result.discountApplied).toBe(20);
    expect(result.appliedAmount).toBe(200);
    expect(result.loan.installments.reduce(
      (sum, installment) => sum + Number(installment.paymentBreakdown?.principalPaid || 0),
      0,
    )).toBe(200);
  });

  it('registra composicao fiscal ao abater e redividir', () => {
    const loan = buildLoan([
      { number: 1, amount: 110, expectedPrincipal: 100, expectedInterest: 10, dueDate: '2026-09-01', status: 'PENDENTE' },
      { number: 2, amount: 110, expectedPrincipal: 100, expectedInterest: 10, dueDate: '2026-10-01', status: 'PENDENTE' },
    ], { amount: 200 });
    const result = applyLoanPaymentToCurrentLoan(loan, {
      operationId: 'op-1',
      amount: 50,
      installmentIndex: 0,
      applyMode: 'REDISTRIBUTE_BALANCE',
      processedAt: '2026-08-19T12:00:00.000Z',
      redistributionStartDate: '2026-09-01',
      redistributionInstallmentsCount: 2,
    }, 0);

    expect(result.appliedAmount).toBe(50);
    expect(result.loan.fiscalPaymentEntries).toHaveLength(1);
    expect(result.loan.fiscalPaymentEntries?.[0].interestPaid).toBe(10);
    expect(result.loan.fiscalPaymentEntries?.[0].principalPaid).toBe(40);
    expect(result.loan.installments).toHaveLength(2);
    expect(result.loan.installments.reduce((sum, installment) => sum + Number(installment.amount), 0)).toBe(170);
  });

  it('recalcula sobre o estado atual e nao reaplica uma parcela ja quitada', () => {
    const loan = buildLoan([
      { number: 1, amount: 110, expectedPrincipal: 100, expectedInterest: 10, dueDate: '2026-09-01', status: 'PENDENTE' },
    ]);
    const first = applyLoanPaymentToCurrentLoan(loan, {
      operationId: 'payment-first',
      amount: 110,
      installmentIndex: 0,
      applyMode: 'INSTALLMENTS',
      processedAt: '2026-08-19T12:00:00.000Z',
    }, 0);

    expect(() => applyLoanPaymentToCurrentLoan(first.loan, {
      operationId: 'payment-second-tab',
      amount: 110,
      installmentIndex: 0,
      applyMode: 'INSTALLMENTS',
      processedAt: '2026-08-19T12:01:00.000Z',
    }, 0)).toThrow('SEM_SALDO_PENDENTE');
  });
});
