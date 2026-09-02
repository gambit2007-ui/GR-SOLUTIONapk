import type { CredigrupoOperationSummary } from './types';
import { isCredigrupoLoanCancelable } from './loanStatus';

export const hasCredigrupoProposal = (operation: CredigrupoOperationSummary): boolean => (
  Boolean(String(operation.proposalId || '').trim())
);

export const canReconcileCredigrupoOperation = (
  operation: CredigrupoOperationSummary,
  isAdmin: boolean,
): boolean => isAdmin && hasCredigrupoProposal(operation);

export const canDiscoverExistingCredigrupoLoan = (
  operation: CredigrupoOperationSummary,
  isAdmin: boolean,
): boolean => (
  isAdmin
  && operation.status === 'RECONCILIATION_REQUIRED'
  && !hasCredigrupoProposal(operation)
);

export const canConfirmExistingCredigrupoLoan = canDiscoverExistingCredigrupoLoan;

export const canCancelCredigrupoOperation = (
  operation: CredigrupoOperationSummary,
  isAdmin: boolean,
): boolean => (
  isAdmin
  && hasCredigrupoProposal(operation)
  && !['SIGNED', 'FUNDED', 'CANCELLED', 'CANCELLATION_REQUESTED', 'CREATE_FAILED'].includes(operation.status)
  && (!operation.externalStatus || isCredigrupoLoanCancelable(operation.externalStatus))
);

export const canTestCredigrupoFunding = (
  operation: CredigrupoOperationSummary,
  isAdmin: boolean,
  isSandbox: boolean,
): boolean => (
  isAdmin
  && isSandbox
  && hasCredigrupoProposal(operation)
  && operation.status === 'AWAITING_LENDER_PAYMENT'
  && !operation.testPayStatus
);
