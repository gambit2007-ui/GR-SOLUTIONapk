import { describe, expect, it } from 'vitest';
import { ApiError } from '../_lib/http';
import { requireDirectLoanDraft } from '../loans';
import type { LoanDraft } from '../../src/types';

const directWeeklyLoan: LoanDraft = {
  customerId: 'customer-1',
  customerName: 'Cliente Teste',
  customerPhone: '',
  amount: 2000,
  interestRate: 25,
  interestType: 'SIMPLES',
  frequency: 'SEMANAL',
  installmentCount: 4,
  installmentsCount: 4,
  totalToReturn: 2500,
  installmentValue: 625,
  startDate: '2026-11-17',
  dueDate: '2026-12-08',
  status: 'ATIVO',
  installments: [1, 2, 3, 4].map((number) => ({
    number,
    amount: 625,
    dueDate: `2026-11-${String(17 + number * 7).padStart(2, '0')}`,
    status: 'PENDENTE',
  })),
};

describe('criacao de contrato direto', () => {
  it('aceita o contrato semanal informado no formulario', () => {
    expect(() => requireDirectLoanDraft(directWeeklyLoan)).not.toThrow();
  });

  it('recusa uma solicitacao que tente usar o fluxo Credigrupo', () => {
    expect(() => requireDirectLoanDraft({
      ...directWeeklyLoan,
      formalizationType: 'BANCARIZED',
      provider: 'CREDIGRUPO',
    })).toThrow(ApiError);
  });

  it('exige dias validos para contrato diario', () => {
    expect(() => requireDirectLoanDraft({
      ...directWeeklyLoan,
      frequency: 'DIARIO',
      dailyChargeDays: [],
    })).toThrow(ApiError);
  });
});
