import { describe, expect, it } from 'vitest';
import type { StoredCredigrupoOperation } from '../store';
import {
  assertCredigrupoFundingTestPayReady,
  normalizeCredigrupoTestPaySuccess,
} from '../testPay';

const operation = (overrides: Partial<StoredCredigrupoOperation> = {}) => ({
  formalizationType: 'BANCARIZED',
  provider: 'CREDIGRUPO',
  customerId: 'customer-1',
  customerName: 'Cliente Teste',
  borrowerId: 'borrower-1',
  investorName: 'GR SOLUTION',
  fundingSource: 'GR',
  amountCents: 30000,
  installments: 2,
  interestRate: 2.5,
  firstPaymentDate: '2026-10-02',
  frequency: 'monthly',
  interestType: 'simple',
  simulation: {
    netAmount: 30000,
    grossAmount: 31437,
    totalAmount: 32620,
    totalInterest: 1183,
    totalIof: 237,
    totalFee: 1200,
    installments: [],
  },
  simulationExternalId: 'SIM-784362',
  status: 'AWAITING_LENDER_PAYMENT',
  externalStatus: 'accepted',
  formalizationStatus: 'awaiting_lender_payment',
  proposalId: 'proposal-1',
  pix: { amountCents: 1437 },
  createdByUid: 'admin-1',
  ...overrides,
} satisfies StoredCredigrupoOperation);

describe('preflight do test-pay de funding', () => {
  it('aceita somente proposta reconciliada em sandbox operacional', () => {
    expect(() => assertCredigrupoFundingTestPayReady(operation())).not.toThrow();
  });

  it.each([
    { fundingSource: 'EXTERNAL' as const },
    { status: 'RECONCILIATION_REQUIRED' },
    { externalStatus: 'funded' },
    { formalizationStatus: 'lender_paid' },
    { pix: undefined },
    { testPayStatus: 'REQUESTING' as const },
    { testPayStatus: 'SUCCEEDED' as const },
  ])('bloqueia estado incompativel ou segunda tentativa', (override) => {
    expect(() => assertCredigrupoFundingTestPayReady(operation(override))).toThrow();
  });
});

describe('resposta segura do test-pay', () => {
  it('preserva somente campos operacionais permitidos', () => {
    const result = normalizeCredigrupoTestPaySuccess({
      httpStatus: 200,
      requestId: 'request-1',
      proposalId: 'proposal-1',
      status: 'accepted',
      formalization_status: 'lender_paid',
      message: 'Pagamento sandbox recebido',
      brCode: '000201-secret',
      apiKey: 'wl_test_secret',
      document: '12345678909',
    }, 'proposal-1');

    expect(result).toEqual({
      httpStatus: 200,
      requestId: 'request-1',
      proposalId: 'proposal-1',
      status: 'accepted',
      formalizationStatus: 'lender_paid',
      message: 'Pagamento sandbox recebido',
    });
    expect(JSON.stringify(result)).not.toContain('000201-secret');
    expect(JSON.stringify(result)).not.toContain('wl_test_secret');
    expect(JSON.stringify(result)).not.toContain('12345678909');
  });
});
