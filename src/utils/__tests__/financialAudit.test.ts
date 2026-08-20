import { describe, expect, it } from 'vitest';
import type { CashMovement, Loan } from '../../types';
import { buildFinancialAudit } from '../financialAudit';

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
