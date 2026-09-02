import { describe, expect, it } from 'vitest';
import { requireCredigrupoProposalId } from '../operationGuards';

describe('guardas de proposta Credigrupo', () => {
  it('bloqueia qualquer acao externa sem proposalId', () => {
    expect(() => requireCredigrupoProposalId({})).toThrowError(
      'A operacao nao possui proposta externa e nao permite esta acao.',
    );
  });

  it('devolve o proposalId normalizado quando disponivel', () => {
    expect(requireCredigrupoProposalId({ proposalId: ' proposal-1 ' })).toBe('proposal-1');
  });
});
