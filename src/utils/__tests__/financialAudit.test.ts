import { describe, expect, it } from 'vitest';
import type { CashMovement, Loan } from '../../types';
import { buildFinancialAudit } from '../financialAudit';
import { applyLoanPaymentToCurrentLoan } from '../financialEngine';

const loan: Loan = {
  id: 'loan-1',
  customerId: 'customer-1',
  customerName: 'Cliente Teste',
  amount: 100,
  interestRate: 10,
  frequency: 'MENSAL',
  interestType: 'SIMPLES',
  startDate: '2026-01-01',
  status: 'ATIVO',
  installments: [{ number: 1, amount: 110, dueDate: '2026-02-01', status: 'PENDENTE' }],
};

const movements: CashMovement[] = [
  {
    id: 'loan-created-loan-1',
    type: 'RETIRADA',
    amount: 100,
    description: 'EMPRESTIMO: CLIENTE TESTE',
    date: '2026-01-01T12:00:00.000Z',
    recordedAt: '2026-01-01T12:00:00.000Z',
    createdByUid: 'user-1',
    loanId: 'loan-1',
    operationId: 'loan-created-loan-1',
  },
];

describe('buildFinancialAudit', () => {
  const paidAcrossInstallments = () => applyLoanPaymentToCurrentLoan({
    ...loan, amount: 200, interestType: 'PRICE',
    installments: [
      { number: 1, amount: 110, expectedPrincipal: 100, expectedInterest: 10, dueDate: '2026-12-01', status: 'PENDENTE' },
      { number: 2, amount: 110, expectedPrincipal: 100, expectedInterest: 10, dueDate: '2027-01-01', status: 'PENDENTE' },
    ],
  }, {
    operationId: 'payment-both', amount: 220, installmentIndex: 0,
    applyMode: 'INSTALLMENTS', processedAt: '2026-11-01T12:00:00.000Z',
  }, 0).loan;

  it('aceita uma unica operacao distribuida em duas parcelas pelo motor financeiro', () => {
    const paidLoan = paidAcrossInstallments();
    const result = buildFinancialAudit({
      loans: [paidLoan], recordedCashBalance: 20,
      cashMovements: [
        { ...movements[0], amount: 200 },
        { ...movements[0], id: 'payment-both', operationId: 'payment-both', type: 'PAGAMENTO', amount: 220 },
      ],
    });
    expect(result.cashDifference).toBe(0);
    expect(result.errors).toBe(0);
  });

  it('continua detectando a mesma operacao repetida na mesma parcela', () => {
    const paidLoan = paidAcrossInstallments();
    const entries = paidLoan.installments[0].paymentEntries!;
    entries.push({ ...entries[0], id: 'duplicate-new-id' });
    const result = buildFinancialAudit({ loans: [paidLoan], cashMovements: movements, recordedCashBalance: -100 });
    expect(result.issues.some((issue) => issue.code === 'DUPLICATE_PAYMENT_ENTRY')).toBe(true);
  });

  it('detecta um mesmo registro copiado entre parcelas', () => {
    const paidLoan = paidAcrossInstallments();
    paidLoan.installments[1].paymentEntries![0].id = paidLoan.installments[0].paymentEntries![0].id;
    const result = buildFinancialAudit({ loans: [paidLoan], cashMovements: movements, recordedCashBalance: -100 });
    expect(result.issues.some((issue) => issue.code === 'DUPLICATE_PAYMENT_ENTRY')).toBe(true);
  });

  it('confirma um caixa reconciliado', () => {
    const result = buildFinancialAudit({ loans: [loan], cashMovements: movements, recordedCashBalance: -100 });
    expect(result.cashDifference).toBe(0);
    expect(result.errors).toBe(0);
    expect(result.isConsistent).toBe(true);
  });

  it('detecta saldo divergente e operacao duplicada', () => {
    const result = buildFinancialAudit({
      loans: [loan],
      cashMovements: [
        ...movements,
        { ...movements[0], id: 'duplicate-movement' },
      ],
      recordedCashBalance: -50,
    });

    expect(result.issues.some((issue) => issue.code === 'CASH_BALANCE_MISMATCH')).toBe(true);
    expect(result.issues.some((issue) => issue.code === 'DUPLICATE_OPERATION_ID')).toBe(true);
    expect(result.isConsistent).toBe(false);
  });
});
