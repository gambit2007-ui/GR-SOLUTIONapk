import { auth } from '../firebase';
import type { CreatedLoanResult, LoanDraft } from '../types';
import type { CreditRiskAssessment } from '../utils/creditRisk';

export interface CreditRiskDecisionInput {
  type: 'CONFIRM_EXPOSURE' | 'EXCEPTION';
  justification?: string;
}

export class CreditRiskServiceError extends Error {
  constructor(public readonly code: string, message: string, public readonly details?: unknown) {
    super(message);
    this.name = 'CreditRiskServiceError';
  }
}

const request = async <T>(path: string, init?: RequestInit): Promise<T> => {
  const user = auth.currentUser;
  if (!user) throw new CreditRiskServiceError('AUTH_REQUIRED', 'Faca login novamente.');
  const response = await fetch(path, {
    ...init,
    headers: {
      Authorization: `Bearer ${await user.getIdToken()}`,
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init?.headers || {}),
    },
  });
  const payload = await response.json().catch(() => ({})) as T & {
    error?: string;
    message?: string;
    details?: unknown;
  };
  if (!response.ok) {
    throw new CreditRiskServiceError(
      payload.error || `HTTP_${response.status}`,
      payload.message || 'Nao foi possivel concluir a analise de credito.',
      payload.details,
    );
  }
  return payload;
};

export const getCustomerCreditRisk = async (customerId: string): Promise<CreditRiskAssessment> => {
  const result = await request<{ risk: CreditRiskAssessment }>(`/api/loans?customerId=${encodeURIComponent(customerId)}`, { cache: 'no-store' });
  return result.risk;
};

export const createDirectLoanWithRisk = (
  loan: LoanDraft,
  requestId: string,
  decision?: CreditRiskDecisionInput,
): Promise<CreatedLoanResult> => request<CreatedLoanResult>('/api/loans', {
  method: 'POST',
  body: JSON.stringify({ loan, requestId, decision }),
});
