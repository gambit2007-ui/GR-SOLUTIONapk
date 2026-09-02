import { ApiError } from '../../http.js';
import {
  isCredigrupoFormalizationStatus,
  isKnownCredigrupoProviderStatus,
} from '../../../../src/lib/creditProviders/loanStatus.js';

export interface SafeCredigrupoFundingPix {
  amountCents?: number;
  expiresAt?: string;
  correlationId?: string;
}

export interface SafeCredigrupoCreateSuccess {
  httpStatus: number;
  proposalId?: string;
  requestId?: string;
  externalStatus?: string;
  formalizationStatus?: string;
  correlationId?: string;
  pix?: SafeCredigrupoFundingPix;
  receivedAt: string;
}

export interface CredigrupoCreateSuccessPatch {
  proposalId?: string;
  requestId?: string;
  externalStatus?: string;
  formalizationStatus?: string;
  internalStatus: 'AWAITING_LENDER_PAYMENT' | 'RECONCILIATION_REQUIRED';
  status: 'AWAITING_LENDER_PAYMENT' | 'RECONCILIATION_REQUIRED';
  unknownProviderStatus: boolean;
  providerSuccess: SafeCredigrupoCreateSuccess;
  pix?: SafeCredigrupoFundingPix;
}

const asRecord = (value: unknown): Record<string, unknown> | undefined => (
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
);

const safeIdentifier = (value: unknown): string | undefined => {
  const text = typeof value === 'string' ? value.trim() : '';
  return /^[A-Za-z0-9._:-]{1,200}$/.test(text) ? text : undefined;
};

const safeStatus = (value: unknown): string | undefined => {
  const text = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return /^[a-z0-9_-]{1,100}$/.test(text) ? text : undefined;
};

const safeDate = (value: unknown): string | undefined => {
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) return undefined;
  return value;
};

const safeAmount = (value: unknown): number | undefined => (
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
    ? value
    : undefined
);

const compact = <T extends Record<string, unknown>>(value: T): T => Object.fromEntries(
  Object.entries(value).filter(([, item]) => item !== undefined),
) as T;

const readSafePix = (value: unknown): SafeCredigrupoFundingPix | undefined => {
  const pix = asRecord(value);
  if (!pix) return undefined;
  const safe = compact({
    amountCents: safeAmount(pix.amountCents),
    expiresAt: safeDate(pix.expiresAt),
    correlationId: safeIdentifier(pix.correlationId ?? pix.correlationID),
  });
  return Object.keys(safe).length > 0 ? safe : undefined;
};

export const normalizeCredigrupoCreateSuccess = (
  response: unknown,
  receivedAt = new Date().toISOString(),
): CredigrupoCreateSuccessPatch => {
  const root = asRecord(response) || {};
  const httpStatus = typeof root.httpStatus === 'number' ? root.httpStatus : 0;
  if (httpStatus < 200 || httpStatus >= 300) {
    throw new ApiError(500, 'INVALID_PROVIDER_SUCCESS_HTTP_STATUS', 'Resposta de sucesso Credigrupo invalida.');
  }
  if (Number.isNaN(Date.parse(receivedAt))) {
    throw new ApiError(500, 'INVALID_PROVIDER_SUCCESS_DATE', 'Data da resposta Credigrupo invalida.');
  }

  const proposalId = safeIdentifier(root.proposalId);
  const requestId = safeIdentifier(root.requestId);
  const externalStatus = safeStatus(root.status);
  const explicitFormalizationStatus = safeStatus(root.formalization_status);
  const formalizationStatus = explicitFormalizationStatus
    || (isCredigrupoFormalizationStatus(externalStatus) ? externalStatus : undefined);
  const pix = readSafePix(root.pix);
  const correlationId = pix?.correlationId || safeIdentifier(root.correlationId);
  const unknownProviderStatus = !isKnownCredigrupoProviderStatus(externalStatus);

  // Only the documented creation state and the legacy macrostatus are safe to
  // advance automatically. Every other value remains non-terminal for review.
  const awaitingLenderPayment = externalStatus === 'awaiting_lender_payment'
    || (externalStatus === 'accepted'
      && (!formalizationStatus || formalizationStatus === 'awaiting_lender_payment'));
  const internalStatus = awaitingLenderPayment
    ? 'AWAITING_LENDER_PAYMENT' as const
    : 'RECONCILIATION_REQUIRED' as const;

  const providerSuccess = compact({
    httpStatus,
    proposalId,
    requestId,
    externalStatus,
    formalizationStatus,
    correlationId,
    pix,
    receivedAt,
  });

  return compact({
    proposalId,
    requestId,
    externalStatus,
    formalizationStatus,
    internalStatus,
    status: internalStatus,
    unknownProviderStatus,
    providerSuccess,
    pix,
  });
};

export const prepareManualCredigrupoCreateReconciliation = (input: {
  operationId: string;
  current: { status?: string; proposalId?: string };
  confirmedResponse: unknown;
  receivedAt: string;
}) => {
  const operationId = safeIdentifier(input.operationId);
  if (!operationId) {
    throw new ApiError(400, 'INVALID_OPERATION_ID', 'Identificador da operacao invalido.');
  }
  if (input.current.status !== 'RECONCILIATION_REQUIRED') {
    throw new ApiError(409, 'RECONCILIATION_NOT_APPLICABLE', 'A operacao nao requer conciliacao manual.');
  }

  const normalized = normalizeCredigrupoCreateSuccess(input.confirmedResponse, input.receivedAt);
  if (!normalized.proposalId) {
    throw new ApiError(400, 'CONFIRMED_PROPOSAL_ID_REQUIRED', 'A confirmacao nao possui proposalId valido.');
  }
  if (input.current.proposalId && input.current.proposalId !== normalized.proposalId) {
    throw new ApiError(409, 'PROPOSAL_ID_MISMATCH', 'O proposalId confirmado difere da operacao local.');
  }

  return {
    operationId,
    patch: {
      ...normalized,
      failureClassification: null,
      lastErrorCode: null,
      providerError: null,
      manuallyReconciledAt: input.receivedAt,
    },
  };
};
