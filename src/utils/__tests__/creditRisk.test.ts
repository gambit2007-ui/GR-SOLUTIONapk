import { describe, expect, it } from 'vitest';
import type { Installment, Loan } from '../../types';
import { assessCustomerCreditRisk, nextMaxHistoricalOverdueDays } from '../creditRisk';

const referenceDate = new Date('2026-09-22T12:00:00Z');
const installment = (overrides: Partial<Installment> = {}): Installment => ({
  number: 1,
  amount: 100,
  dueDate: '2026-09-01',
  status: 'PENDENTE',
  ...overrides,
});
const loan = (id: string, installments: Installment[], overrides: Partial<Loan> = {}): Loan => ({
  id,
  customerId: 'customer-1',
  customerName: 'Cliente Teste',
  amount: 100,
  interestRate: 10,
  frequency: 'MENSAL',
  interestType: 'SIMPLES',
  startDate: '2026-08-01',
  status: 'ATIVO',
  installments,
  ...overrides,
});

describe('assessCustomerCreditRisk', () => {
  it('keeps 18 days after payment and after a later 7-day delay', () => {
    const before = loan('loan-1', [installment({ dueDate: '2026-09-04' })]);
    const paid = loan('loan-1', [installment({
      dueDate: '2026-09-04', status: 'PAGO', paidAmount: 100,
      paymentDate: '2026-09-22T12:00:00Z',
    })], { status: 'QUITADO' });
    const recorded = nextMaxHistoricalOverdueDays(before, paid, referenceDate);
    expect(recorded).toBe(18);
    const later = loan('loan-1', [installment({ dueDate: '2026-09-15' })], {
      maxHistoricalOverdueDays: recorded,
    });
    expect(nextMaxHistoricalOverdueDays(later, later, referenceDate)).toBe(18);
  });

  it('raises a recorded 18 days to 24 when the new delay is proven', () => {
    const before = loan('loan-1', [installment({ dueDate: '2026-08-29' })], {
      maxHistoricalOverdueDays: 18,
    });
    expect(nextMaxHistoricalOverdueDays(before, before, referenceDate)).toBe(24);
  });

  it('keeps red policy after a paid historical 16-day delay', () => {
    const completed = loan('loan-1', [installment({
      dueDate: '2026-09-01', status: 'PAGO', paidAmount: 100,
    })], { status: 'QUITADO', maxHistoricalOverdueDays: 16 });
    expect(assessCustomerCreditRisk('customer-1', [completed], referenceDate, 0).level).toBe('RED');
  });

  it('does not invent zero for an undated legacy payment', () => {
    const legacy = loan('legacy', [installment({ status: 'PAGO', paidAmount: 100 })], {
      status: 'QUITADO',
    });
    expect(nextMaxHistoricalOverdueDays(legacy, legacy, referenceDate)).toBeUndefined();
    expect(assessCustomerCreditRisk('customer-1', [legacy], referenceDate, 0).historyIncomplete).toBe(true);
  });

  it('does not erase 18 days on partial payment, reversal, renewal, or redistribution', () => {
    const before = loan('loan-1', [installment({ dueDate: '2026-09-04' })], {
      maxHistoricalOverdueDays: 18,
    });
    const partial = loan('loan-1', [installment({
      dueDate: '2026-09-04', paidAmount: 50, status: 'PENDENTE',
      paymentDate: '2026-09-22T12:00:00Z',
    })], { maxHistoricalOverdueDays: 18 });
    const renewed = loan('loan-1', [installment({ dueDate: '2026-10-04' })], {
      maxHistoricalOverdueDays: 18,
      renewalHistory: [{
        id: 'renewal', type: 'interest_only_renewal', amount: 10,
        paymentDate: '2026-09-22T12:00:00Z', previousDueDate: '2026-09-04', newDueDate: '2026-10-04',
      }],
    });
    const redistributed = loan('loan-1', [installment({ dueDate: '2026-10-04' })], {
      maxHistoricalOverdueDays: 18,
      fiscalPaymentEntries: [{
        id: 'fiscal', recordedAt: '2026-09-22T12:00:00Z', kind: 'PAYMENT',
        principalPaid: 10, interestPaid: 0, lateFeePaid: 0,
        serviceFeePaid: 0, discountApplied: 0, totalPaid: 10,
      }],
    });
    expect(nextMaxHistoricalOverdueDays(before, partial, referenceDate)).toBe(18);
    expect(nextMaxHistoricalOverdueDays(partial, before, referenceDate)).toBe(18);
    expect(nextMaxHistoricalOverdueDays(before, renewed, referenceDate)).toBe(18);
    expect(nextMaxHistoricalOverdueDays(before, redistributed, referenceDate)).toBe(18);
  });
  it('preserva atraso comprovado depois da quitacao', () => {
    const result = assessCustomerCreditRisk('customer-1', [loan('old', [installment({
      dueDate: '2026-08-01',
      status: 'PAGO',
      paidAmount: 100,
      paymentDate: '2026-08-28T12:00:00Z',
    })], { status: 'QUITADO' })], referenceDate, 0);
    expect(result).toMatchObject({ level: 'RED', completedContracts: 1, maxHistoricalOverdueDays: 27 });
  });

  it('usa o dia civil brasileiro no limite de 15 dias e preserva historico de cancelados', () => {
    const result = assessCustomerCreditRisk('customer-1', [loan('cancelled', [installment({
      dueDate: '2026-09-01', status: 'PAGO', paidAmount: 100,
      paymentDate: '2026-09-17T01:00:00Z',
    })], { status: 'CANCELADO' })], referenceDate, 0);
    expect(result.maxHistoricalOverdueDays).toBe(15);
    expect(result.level).toBe('GREEN');
  });

  it('distingue 15 dias de 16 dias e exige alerta para exposicao ativa', () => {
    const fifteenDays = loan('active', [installment({ dueDate: '2026-09-07' })]);
    expect(assessCustomerCreditRisk('customer-1', [fifteenDays], referenceDate, 0).level).toBe('ORANGE');
    const sixteenDays = loan('active', [installment({ dueDate: '2026-09-06' })]);
    expect(assessCustomerCreditRisk('customer-1', [sixteenDays], referenceDate, 0).level).toBe('RED');
    expect(assessCustomerCreditRisk('customer-1', [loan('active', [installment({ dueDate: '2026-10-01' })])], referenceDate, 0).level).toBe('YELLOW');
  });

  it('recupera o vencimento anterior de uma renovacao e marca pagamento legado sem data', () => {
    const renewed = loan('renewed', [installment({ dueDate: '2026-10-01', status: 'PAGO', paidAmount: 100 })], {
      status: 'QUITADO',
      renewCount: 1,
      renewalHistory: [{
        id: 'renewal-1', type: 'interest_only_renewal', amount: 10,
        paymentDate: '2026-08-21T12:00:00Z', previousDueDate: '2026-08-01', newDueDate: '2026-10-01',
      }],
    });
    const result = assessCustomerCreditRisk('customer-1', [renewed], referenceDate, 0);
    expect(result.maxHistoricalOverdueDays).toBe(20);
    expect(result.historyIncomplete).toBe(true);
    expect(result.level).toBe('RED');
  });

  it('ignora pagamento estornado ao calcular atraso historico', () => {
    const result = assessCustomerCreditRisk('customer-1', [loan('reversed', [installment({
      dueDate: '2026-09-01',
      paymentEntries: [
        { id: 'pay-1', kind: 'PAYMENT', recordedAt: '2026-09-20T12:00:00Z', principalPaid: 100, interestPaid: 0, lateFeePaid: 0, serviceFeePaid: 0, discountApplied: 0, totalPaid: 100 },
        { id: 'reverse-1', kind: 'REVERSAL', recordedAt: '2026-09-21T12:00:00Z', principalPaid: -100, interestPaid: 0, lateFeePaid: 0, serviceFeePaid: 0, discountApplied: 0, totalPaid: -100 },
      ],
    })])], referenceDate, 0);
    expect(result.maxHistoricalOverdueDays).toBe(0);
    expect(result.maxCurrentOverdueDays).toBe(21);
  });
});
