import { auth } from '../firebase';
import type {
  CreateBancarizedLoanRequest,
  CreateBancarizedLoanResult,
  CredigrupoBorrowerState,
  CredigrupoIntegrationStatus,
  CredigrupoInvestorSummary,
  CredigrupoOperationSummary,
  CredigrupoSimulationRequest,
  CredigrupoSimulationResult,
  EnsureCredigrupoBorrowerRequest,
} from '../lib/creditProviders/types';

interface ApiFailure {
  error?: string;
  message?: string;
  details?: unknown;
}

export class CredigrupoServiceError extends Error {
  constructor(public readonly code: string, message: string, public readonly details?: unknown) {
    super(message);
    this.name = 'CredigrupoServiceError';
  }
}

const request = async <T>(path: string, init?: RequestInit): Promise<T> => {
  const user = auth.currentUser;
  if (!user) throw new CredigrupoServiceError('AUTH_REQUIRED', 'Faca login novamente.');
  const token = await user.getIdToken();
  const response = await fetch(path, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init?.headers || {}),
    },
  });
  const payload = await response.json().catch(() => ({})) as T & ApiFailure;
  if (!response.ok) {
    throw new CredigrupoServiceError(
      payload.error || `HTTP_${response.status}`,
      payload.message || 'Nao foi possivel concluir a operacao bancarizada.',
      payload.details,
    );
  }
  return payload;
};

export const getCredigrupoStatus = () => request<CredigrupoIntegrationStatus>('/api/credigrupo/status');

export const syncCredigrupoInvestors = async () => {
  const result = await request<{ investors: CredigrupoInvestorSummary[] }>('/api/credigrupo/investors');
  return result.investors;
};

export const ensureCredigrupoBorrower = (payload: EnsureCredigrupoBorrowerRequest) =>
  request<CredigrupoBorrowerState>('/api/credigrupo/borrowers', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
export const simulateCredigrupoLoan = (payload: CredigrupoSimulationRequest) =>
  request<CredigrupoSimulationResult>('/api/credigrupo/simulate', {
    method: 'POST',
    body: JSON.stringify(payload),
  });

export const createBancarizedLoan = (payload: CreateBancarizedLoanRequest) =>
  request<CreateBancarizedLoanResult>('/api/credigrupo/loans', {
    method: 'POST',
    body: JSON.stringify(payload),
  });

export const listCredigrupoOperations = async () => {
  const result = await request<{ operations: CredigrupoOperationSummary[] }>('/api/credigrupo/operations');
  return result.operations;
};

export const reconcileCredigrupoOperation = (operationId: string) =>
  request<{ reconciled: boolean; externalStatus: string; installments: number }>('/api/credigrupo/reconcile', {
    method: 'POST',
    body: JSON.stringify({ operationId }),
  });

export const cancelCredigrupoOperation = (operationId: string) =>
  request<{ cancelled: boolean }>('/api/credigrupo/cancel', {
    method: 'POST',
    body: JSON.stringify({ operationId }),
  });
