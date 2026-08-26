import { describe, expect, it } from 'vitest';
import type { Loan } from '../../../../../src/types';
import {
  assertBancarizedCredigrupoLoan,
  findRequestedInstallmentIndex,
  validateCredigrupoInstallmentPix,
} from '../installments';

const loan = (overrides: Partial<Loan> = {}): Loan => ({
  id: 'loan-1',
  customerId: 'customer-1',
  customerName: 'Cliente',
  amount: 100,
  interestRate: 10,
  frequency: 'MENSAL',
  interestType: 'SIMPLES',
  startDate: '2026-08-25',
  status: 'ATIVO',
  installments: [{ id: 'local-1', number: 1, amount: 110, dueDate: '2026-09-25', status: 'PENDENTE', credigrupo: { installmentId: 'external-1' } }],
  ...overrides,
});

describe('parcelas Credigrupo', () => {
  it('bloqueia contrato DIRECT e aceita somente BANCARIZED da Credigrupo', () => {
    expect(() => assertBancarizedCredigrupoLoan(loan({ formalizationType: 'DIRECT', provider: 'GR' }))).toThrow('Contrato GR Direto');
    expect(() => assertBancarizedCredigrupoLoan(loan({ formalizationType: 'BANCARIZED', provider: 'GR' }))).toThrow('nao pertence');
    expect(() => assertBancarizedCredigrupoLoan(loan({ formalizationType: 'BANCARIZED', provider: 'CREDIGRUPO', credigrupo: { proposalId: 'proposal-1' } }))).not.toThrow();
  });

  it('localiza parcela pelo ID local, externo ou numero', () => {
    const installments = loan().installments;
    expect(findRequestedInstallmentIndex(installments, 'local-1')).toBe(0);
    expect(findRequestedInstallmentIndex(installments, 'external-1')).toBe(0);
    expect(findRequestedInstallmentIndex(installments, '1')).toBe(0);
    expect(findRequestedInstallmentIndex(installments, 'missing')).toBe(-1);
  });

  it('aceita somente a resposta PIX oficial e URL Woovi segura', () => {
    const valid = validateCredigrupoInstallmentPix({
      brCode: '000201',
      qrCodeImage: 'https://api.woovi.com/openpix/charge/qr.png',
      correlationID: 'correlation-1',
      amountCents: 11000,
      totalCents: 12000,
      serviceFee: 1000,
    });
    expect(valid.totalCents).toBe(12000);
    expect(() => validateCredigrupoInstallmentPix({ ...valid, qrCodeImage: 'https://example.com/qr.png' })).toThrow('Resposta de PIX invalida');
  });
});
