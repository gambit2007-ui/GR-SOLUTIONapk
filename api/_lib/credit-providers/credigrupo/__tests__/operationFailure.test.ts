import { describe, expect, it } from 'vitest';
import { ApiError } from '../../../http';
import {
  buildCredigrupoCreateFailurePatch,
  buildHistoricalCreateFailurePatch,
} from '../operationFailure';
import { sanitizeCredigrupoProviderError } from '../providerError';

const providerFailure = (status: number) => new ApiError(
  status,
  `CREDIGRUPO_HTTP_${status}`,
  'Falha segura.',
  { providerError: sanitizeCredigrupoProviderError({ httpStatus: status, payload: { code: 'INVALID' }, requestId: 'request-1' }) },
);

describe('classificacao de falha na criacao Credigrupo', () => {
  it.each([400, 401, 403, 404, 422, 429])('classifica resposta HTTP %s inequivoca como CREATE_FAILED', (status) => {
    const patch = buildCredigrupoCreateFailurePatch(providerFailure(status));
    expect(patch).toMatchObject({
      status: 'CREATE_FAILED',
      failureClassification: 'DETERMINISTIC',
      lastErrorCode: `CREDIGRUPO_HTTP_${status}`,
      providerError: { httpStatus: status, requestId: 'request-1' },
    });
    expect(patch).not.toHaveProperty('cashMovement');
    expect(patch).not.toHaveProperty('financialEntry');
  });

  it.each([
    new ApiError(408, 'CREDIGRUPO_HTTP_408', 'Timeout remoto'),
    new ApiError(409, 'CREDIGRUPO_HTTP_409', 'Conflito potencialmente duplicado'),
    new ApiError(504, 'CREDIGRUPO_TIMEOUT', 'Timeout'),
    new ApiError(502, 'CREDIGRUPO_UNAVAILABLE', 'Rede indisponivel'),
    new ApiError(500, 'CREDIGRUPO_HTTP_500', 'Erro remoto'),
  ])('mantem falhas ambiguas em RECONCILIATION_REQUIRED', (error) => {
    expect(buildCredigrupoCreateFailurePatch(error)).toMatchObject({
      status: 'RECONCILIATION_REQUIRED',
      failureClassification: 'AMBIGUOUS',
      lastErrorCode: error.code,
    });
  });

  it('migra somente falha historica 400/422 sem proposalId', () => {
    expect(buildHistoricalCreateFailurePatch(
      { status: 'RECONCILIATION_REQUIRED', lastErrorCode: 'CREDIGRUPO_HTTP_400' },
      { requestId: 'request-123', occurredAt: '2026-09-01T17:26:16.669Z' },
    )).toEqual({
      status: 'CREATE_FAILED',
      failureClassification: 'DETERMINISTIC',
      providerError: {
        httpStatus: 400,
        requestId: 'request-123',
        occurredAt: '2026-09-01T17:26:16.669Z',
      },
    });
  });

  it('recusa migracao quando existe proposalId ou o erro e ambiguo', () => {
    expect(() => buildHistoricalCreateFailurePatch(
      { status: 'RECONCILIATION_REQUIRED', proposalId: 'proposal-1', lastErrorCode: 'CREDIGRUPO_HTTP_400' },
      { requestId: 'request-123', occurredAt: '2026-09-01T17:26:16.669Z' },
    )).toThrowError('A operacao nao atende aos criterios da migracao.');
    expect(() => buildHistoricalCreateFailurePatch(
      { status: 'RECONCILIATION_REQUIRED', lastErrorCode: 'CREDIGRUPO_TIMEOUT' },
      { requestId: 'request-123', occurredAt: '2026-09-01T17:26:16.669Z' },
    )).toThrowError('A falha registrada nao e deterministica.');
  });
});
