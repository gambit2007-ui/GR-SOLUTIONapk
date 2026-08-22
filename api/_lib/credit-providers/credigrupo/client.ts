import { ApiError } from '../../http';
import { getCredigrupoServerConfig } from '../../env';
import type {
  CredigrupoKycData,
  CredigrupoSimulationInstallment,
  CredigrupoSimulationValues,
} from '../../../../src/lib/creditProviders/types';

interface CredigrupoInvestorResponse {
  id: string;
  name: string;
  email?: string;
  kyc_status: string;
}

interface CredigrupoBorrowerResponse {
  data: {
    id: string;
    kyc_status: string;
    ccb_eligible?: boolean;
    ccb_eligible_errors?: string[];
  };
}

interface CredigrupoLoanDetailsResponse {
  data: {
    id: string;
    status: string;
    formalization_status: string;
    hiperbanco_ccb_number?: string | null;
    ccb_url?: string | null;
    borrower_signature_link?: string | null;
    lender_signature_link?: string | null;
  };
}

export interface CredigrupoExternalInstallment {
  id: string;
  installment_number: number;
  amount: number;
  due_date: string;
  status: string;
  payment_date?: string | null;
  investor_payout_status?: string | null;
}

export interface CredigrupoCreateLoanResponse {
  requestId: string;
  proposalId: string;
  status: string;
  pix: {
    brcode: string;
    qrCodeImage: string;
    expiresAt: string;
    amountCents: number;
    correlationId: string;
  };
}

export interface CredigrupoSimulationResponse {
  externalId: string;
  interestRate: number;
  simulation: CredigrupoSimulationValues;
}

const toFriendlyMessage = (status: number): string => {
  if (status === 400) return 'Revise os dados enviados e o status do KYC.';
  if (status === 401 || status === 403) return 'Integracao Credigrupo nao autorizada.';
  if (status === 404) return 'Registro nao encontrado na Credigrupo.';
  if (status === 409) return 'O registro ja existe na Credigrupo.';
  if (status === 422) return 'A operacao nao atende aos requisitos da Credigrupo.';
  if (status === 429) return 'Limite temporario da Credigrupo atingido. Tente novamente depois.';
  if (status >= 500) return 'Credigrupo temporariamente indisponivel.';
  return 'Falha na integracao Credigrupo.';
};

export class CredigrupoClient {
  private readonly config;

  constructor(options?: { allowWhenDisabled?: boolean }) {
    this.config = getCredigrupoServerConfig(options);
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 25_000);
    try {
      const response = await fetch(`${this.config.baseUrl}${path}`, {
        ...init,
        signal: controller.signal,
        headers: {
          'X-API-Key': this.config.apiKey,
          ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
          ...(init?.headers || {}),
        },
      });
      const requestId = response.headers.get('X-Request-ID') || undefined;
      const payload = await response.json().catch(() => ({})) as Record<string, unknown>;

      if (!response.ok) {
        console.warn('[Credigrupo]', {
          operation: `${init?.method || 'GET'} ${path}`,
          status: response.status,
          requestId,
          timestamp: new Date().toISOString(),
        });
        throw new ApiError(response.status, `CREDIGRUPO_HTTP_${response.status}`, toFriendlyMessage(response.status), {
          requestId,
          retryAfterSeconds: payload.retryAfterSeconds,
        });
      }

      return payload as T;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      if (error instanceof Error && error.name === 'AbortError') {
        throw new ApiError(504, 'CREDIGRUPO_TIMEOUT', 'A Credigrupo demorou para responder.');
      }
      throw new ApiError(502, 'CREDIGRUPO_UNAVAILABLE', 'Nao foi possivel conectar a Credigrupo.');
    } finally {
      clearTimeout(timeout);
    }
  }

  async listInvestors(): Promise<CredigrupoInvestorResponse[]> {
    const first = await this.request<{ data: CredigrupoInvestorResponse[]; total: number }>('/investors?page=1&pageSize=50');
    const investors = [...first.data];
    const pages = Math.ceil(first.total / 50);
    for (let page = 2; page <= pages; page += 1) {
      const next = await this.request<{ data: CredigrupoInvestorResponse[]; total: number }>(`/investors?page=${page}&pageSize=50`);
      investors.push(...next.data);
    }
    return investors;
  }

  registerBorrower(payload: {
    investorId: string;
    email: string;
    display_name: string;
    phone: string;
    document: string;
    birth_date: string;
    kyc_data: CredigrupoKycData;
  }) {
    return this.request<{ borrowerId: string; status: string; message: string }>('/borrowers', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  getBorrower(borrowerId: string) {
    return this.request<CredigrupoBorrowerResponse>(`/borrowers/${encodeURIComponent(borrowerId)}`);
  }

  getBorrowerEligibility(borrowerId: string) {
    return this.request<{ eligible: boolean; errors: string[]; cachedAt: string }>(
      `/borrowers/${encodeURIComponent(borrowerId)}/ccb-eligibility`,
    );
  }

  simulateLoan(payload: {
    investorId: string;
    borrowerId: string;
    amountCents: number;
    installments: number;
    interestRate: number;
    firstPaymentDate: string;
    frequency: 'monthly' | 'weekly';
    interestType: 'simple' | 'compound';
  }) {
    return this.request<CredigrupoSimulationResponse>('/loans/simulate', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  createLoan(payload: {
    investorId: string;
    borrowerId: string;
    amountCents: number;
    installments: number;
    interestRate: number;
    firstPaymentDate: string;
    ccbSimulationData: { simulation: CredigrupoSimulationValues };
    frequency: 'monthly' | 'weekly';
    interestType: 'simple' | 'compound';
    notes?: string;
  }) {
    return this.request<CredigrupoCreateLoanResponse>('/loans', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  getLoan(proposalId: string) {
    return this.request<CredigrupoLoanDetailsResponse>(`/loans/${encodeURIComponent(proposalId)}`);
  }

  listInstallments(proposalId: string) {
    return this.request<{ data: CredigrupoExternalInstallment[] }>(
      `/loans/${encodeURIComponent(proposalId)}/installments`,
    );
  }

  cancelLoan(proposalId: string) {
    return this.request<Record<string, unknown>>(`/loans/${encodeURIComponent(proposalId)}`, { method: 'DELETE' });
  }

  getEarnings() {
    return this.request<{ totalPartnerFeeCents: number; totalAgencyFeeCents: number; subAccountBalanceCents: number }>('/earnings');
  }
}

export const isCredigrupoSimulationInstallment = (value: unknown): value is CredigrupoSimulationInstallment => {
  if (!value || typeof value !== 'object') return false;
  const item = value as Record<string, unknown>;
  return Number.isFinite(Number(item.installmentNumber)) && Number.isFinite(Number(item.amount)) && typeof item.dueDate === 'string';
};
