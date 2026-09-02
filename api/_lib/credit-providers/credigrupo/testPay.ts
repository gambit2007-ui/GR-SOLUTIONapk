import { ApiError } from '../../http.js';
import type { StoredCredigrupoOperation } from './store.js';

interface SafeCredigrupoTestPayResult {
  httpStatus: number;
  requestId?: string;
  proposalId?: string;
  status?: string;
  formalizationStatus?: string;
  message?: string;
}

const asRecord = (value: unknown): Record<string, unknown> | undefined => (
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
);

const safeText = (value: unknown, maxLength = 300): string | undefined => {
  const text = typeof value === 'string' ? value.trim() : '';
  return text && text.length <= maxLength ? text : undefined;
};

export const assertCredigrupoFundingTestPayReady = (operation: StoredCredigrupoOperation) => {
  if (operation.formalizationType !== 'BANCARIZED' || operation.provider !== 'CREDIGRUPO') {
    throw new ApiError(409, 'INVALID_OPERATION_PROVIDER', 'Operacao nao pertence a Credigrupo.');
  }
  if (operation.fundingSource !== 'GR') {
    throw new ApiError(409, 'INVALID_FUNDING_SOURCE', 'O test-pay desta etapa exige capital GR.');
  }
  if (operation.status !== 'AWAITING_LENDER_PAYMENT'
    || operation.externalStatus !== 'accepted'
    || operation.formalizationStatus !== 'awaiting_lender_payment') {
    throw new ApiError(409, 'TEST_PAY_NOT_ALLOWED', 'A proposta nao esta aguardando o pagamento sandbox da taxa.');
  }
  if (!Number.isSafeInteger(operation.pix?.amountCents) || Number(operation.pix?.amountCents) <= 0) {
    throw new ApiError(409, 'FUNDING_PIX_NOT_CONFIRMED', 'O valor do PIX da taxa ainda nao foi confirmado.');
  }
  if (operation.testPayStatus) {
    throw new ApiError(409, 'TEST_PAY_ALREADY_REQUESTED', 'O test-pay desta proposta ja foi solicitado.');
  }
};

export const normalizeCredigrupoTestPaySuccess = (
  response: unknown,
  fallbackProposalId: string,
): SafeCredigrupoTestPayResult => {
  const root = asRecord(response) || {};
  const nested = asRecord(root.data) || {};
  const httpStatus = Number(root.httpStatus || 0);
  if (!Number.isSafeInteger(httpStatus) || httpStatus < 200 || httpStatus >= 300) {
    throw new ApiError(500, 'INVALID_TEST_PAY_RESPONSE', 'Resposta de test-pay invalida.');
  }
  return {
    httpStatus,
    requestId: safeText(root.requestId ?? nested.requestId, 200),
    proposalId: safeText(root.proposalId ?? nested.proposalId, 200) || fallbackProposalId,
    status: safeText(root.status ?? nested.status, 100),
    formalizationStatus: safeText(
      root.formalization_status ?? root.formalizationStatus
      ?? nested.formalization_status ?? nested.formalizationStatus,
      100,
    ),
    message: safeText(root.message ?? nested.message),
  };
};
