import { describe, expect, it } from 'vitest';
import type { CredigrupoOperationSummary } from '../types';
import {
  canCancelCredigrupoOperation,
  canConfirmExistingCredigrupoLoan,
  canDiscoverExistingCredigrupoLoan,
  canReconcileCredigrupoOperation,
  canTestCredigrupoFunding,
} from '../operationActions';

const operation = (overrides: Partial<CredigrupoOperationSummary> = {}): CredigrupoOperationSummary => ({
  id: 'operation-1',
  customerId: 'customer-1',
  customerName: 'Cliente',
  investorName: 'GR SOLUTION',
  fundingSource: 'GR',
  status: 'AWAITING_LENDER_PAYMENT',
  amountCents: 10000,
  installments: 2,
  ...overrides,
});

describe('acoes administrativas de operacoes Credigrupo', () => {
  it('bloqueia conciliacao, cancelamento e test-pay sem proposalId', () => {
    const failed = operation({ status: 'CREATE_FAILED' });
    expect(canReconcileCredigrupoOperation(failed, true)).toBe(false);
    expect(canCancelCredigrupoOperation(failed, true)).toBe(false);
    expect(canTestCredigrupoFunding(failed, true, true)).toBe(false);
  });

  it('libera apenas as acoes compativeis quando existe proposta', () => {
    const created = operation({ proposalId: 'proposal-1', externalStatus: 'proposed' });
    expect(canReconcileCredigrupoOperation(created, true)).toBe(true);
    expect(canCancelCredigrupoOperation(created, true)).toBe(true);
    expect(canTestCredigrupoFunding(created, true, true)).toBe(true);
  });

  it('libera descoberta somente para admin quando a criacao ficou ambigua e sem proposta', () => {
    const ambiguous = operation({ status: 'RECONCILIATION_REQUIRED', proposalId: undefined });
    expect(canDiscoverExistingCredigrupoLoan(ambiguous, true)).toBe(true);
    expect(canConfirmExistingCredigrupoLoan(ambiguous, true)).toBe(true);
    expect(canDiscoverExistingCredigrupoLoan(ambiguous, false)).toBe(false);
    expect(canDiscoverExistingCredigrupoLoan(operation({ status: 'CREATE_FAILED' }), true)).toBe(false);
    expect(canDiscoverExistingCredigrupoLoan(operation({
      status: 'RECONCILIATION_REQUIRED',
      proposalId: 'proposal-1',
    }), true)).toBe(false);
    expect(canConfirmExistingCredigrupoLoan(operation({ status: 'CREATE_FAILED' }), true)).toBe(false);
  });

  it('bloqueia nova tentativa de test-pay depois da reserva', () => {
    const requested = operation({ proposalId: 'proposal-1', testPayStatus: 'REQUESTING' });
    const completed = operation({ proposalId: 'proposal-1', testPayStatus: 'SUCCEEDED' });
    expect(canTestCredigrupoFunding(requested, true, true)).toBe(false);
    expect(canTestCredigrupoFunding(completed, true, true)).toBe(false);
  });
});
