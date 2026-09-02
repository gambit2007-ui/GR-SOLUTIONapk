import { ApiError } from '../../http.js';
import { extractSafeCredigrupoProviderError, sanitizeCredigrupoProviderError } from './providerError.js';
import type { SafeCredigrupoProviderError } from './providerError.js';

export const CREDIGRUPO_CREATE_FAILED = 'CREATE_FAILED' as const;
export const CREDIGRUPO_RECONCILIATION_REQUIRED = 'RECONCILIATION_REQUIRED' as const;
const DETERMINISTIC_PROVIDER_HTTP_STATUSES = new Set([400, 401, 403, 404, 422, 429]);

interface FailedOperationSnapshot {
  status?: string;
  proposalId?: string;
  lastErrorCode?: string;
}

export const isDeterministicCredigrupoCreateFailure = (error: unknown): boolean => (
  error instanceof ApiError
  && error.code === `CREDIGRUPO_HTTP_${error.status}`
  && DETERMINISTIC_PROVIDER_HTTP_STATUSES.has(error.status)
);

export const buildCredigrupoCreateFailurePatch = (error: unknown): {
  status: typeof CREDIGRUPO_CREATE_FAILED | typeof CREDIGRUPO_RECONCILIATION_REQUIRED;
  failureClassification: 'DETERMINISTIC' | 'AMBIGUOUS';
  lastErrorCode: string;
  providerError?: SafeCredigrupoProviderError;
} => {
  const deterministic = isDeterministicCredigrupoCreateFailure(error);
  const providerError = extractSafeCredigrupoProviderError(error);
  return {
    status: deterministic ? CREDIGRUPO_CREATE_FAILED : CREDIGRUPO_RECONCILIATION_REQUIRED,
    failureClassification: deterministic ? 'DETERMINISTIC' : 'AMBIGUOUS',
    lastErrorCode: error instanceof ApiError ? error.code : 'UNKNOWN_PROVIDER_ERROR',
    ...(providerError ? { providerError } : {}),
  };
};

export const buildHistoricalCreateFailurePatch = (
  operation: FailedOperationSnapshot,
  input: { requestId: string; occurredAt: string },
) => {
  if (operation.status !== CREDIGRUPO_RECONCILIATION_REQUIRED || operation.proposalId) {
    throw new ApiError(409, 'MIGRATION_NOT_APPLICABLE', 'A operacao nao atende aos criterios da migracao.');
  }
  const match = /^CREDIGRUPO_HTTP_(400|422)$/.exec(String(operation.lastErrorCode || ''));
  if (!match) throw new ApiError(409, 'MIGRATION_NOT_DETERMINISTIC', 'A falha registrada nao e deterministica.');

  const requestId = input.requestId.trim();
  if (!/^[A-Za-z0-9_-]{8,200}$/.test(requestId)) {
    throw new ApiError(400, 'INVALID_PROVIDER_REQUEST_ID', 'Request ID da Credigrupo invalido.');
  }
  if (!input.occurredAt || Number.isNaN(Date.parse(input.occurredAt))) {
    throw new ApiError(400, 'INVALID_PROVIDER_ERROR_DATE', 'Data do erro da Credigrupo invalida.');
  }

  return {
    status: CREDIGRUPO_CREATE_FAILED,
    failureClassification: 'DETERMINISTIC' as const,
    providerError: sanitizeCredigrupoProviderError({
      httpStatus: Number(match[1]),
      payload: {},
      requestId,
      occurredAt: input.occurredAt,
    }),
  };
};
