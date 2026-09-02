import { ApiError } from '../../http.js';

export const requireCredigrupoProposalId = (operation: { proposalId?: string }): string => {
  const proposalId = String(operation.proposalId || '').trim();
  if (!proposalId) {
    throw new ApiError(
      409,
      'PROPOSAL_NOT_AVAILABLE',
      'A operacao nao possui proposta externa e nao permite esta acao.',
    );
  }
  return proposalId;
};
