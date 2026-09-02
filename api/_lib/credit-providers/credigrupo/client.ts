import { ApiError } from '../../http.js';
import { CREDIGRUPO_ACCOUNT_MODE, getCredigrupoServerConfig } from '../../env.js';
import type {
  CreateCredigrupoInvestorRequest,
  CredigrupoInvestorDocumentType,
  CredigrupoInstallmentPixResult,
  CredigrupoKycData,
  CredigrupoSimulationInstallment,
  CredigrupoSimulationValues,
} from '../../../../src/lib/creditProviders/types.js';
import { sanitizeCredigrupoProviderError } from './providerError.js';

export interface CredigrupoInvestorResponse {
  id: string;
  name: string;
  email?: string;
  document?: string;
  phone?: string;
  birth_date?: string;
  kyc_status: string;
  created_at?: string;
}

export interface CredigrupoCreateInvestorResponse {
  investorId: string;
  status: string;
  message?: string;
}

type CredigrupoInvestorDocumentsPayload = Partial<Record<CredigrupoInvestorDocumentType, string>>;

interface CredigrupoBorrowerResponse {
  data: {
    id: string;
    name?: string;
    kyc_status: string;
    ccb_eligible?: boolean;
    ccb_eligible_errors?: string[];
  };
}

interface CredigrupoUpdateBorrowerResponse {
  success: boolean;
  borrowerId: string;
}

export interface CredigrupoBorrowerEligibilityResponse {
  eligible?: boolean;
  errors?: string[];
  cachedAt?: string;
}

const asRecord = (value: unknown): Record<string, unknown> | undefined => (
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
);

export const parseBorrowerEligibilityResponse = (payload: unknown): CredigrupoBorrowerEligibilityResponse => {
  const root = asRecord(payload) || {};
  const nested = asRecord(root.data);
  const source = typeof root.eligible === 'boolean' || Object.hasOwn(root, 'errors') || Object.hasOwn(root, 'cachedAt')
    ? root
    : nested || {};

  return {
    eligible: typeof source.eligible === 'boolean' ? source.eligible : undefined,
    errors: Array.isArray(source.errors)
      ? source.errors.filter((item): item is string => typeof item === 'string')
      : undefined,
    cachedAt: typeof source.cachedAt === 'string' ? source.cachedAt : undefined,
  };
};

export interface CredigrupoLoanDetailsResponse {
  httpStatus: number;
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

export interface CredigrupoLoanListResponse {
  httpStatus: number;
  data: unknown[];
  total: number;
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
  httpStatus: number;
  requestId?: string;
  proposalId?: string;
  status?: string;
  formalization_status?: string;
  correlationId?: string;
  pix?: {
    brcode?: string;
    qrCodeImage?: string;
    expiresAt?: string;
    amountCents?: number;
    correlationId?: string;
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

  private async request<T>(
    path: string,
    init?: RequestInit,
    options?: { onSuccessStatus?: (status: number, requestId?: string) => void },
  ): Promise<T> {
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
        const providerError = sanitizeCredigrupoProviderError({
          httpStatus: response.status,
          payload,
          requestId,
        });
        console.warn('[Credigrupo]', {
          operation: `${init?.method || 'GET'} ${path}`,
          status: response.status,
          providerError,
          timestamp: new Date().toISOString(),
        });
        throw new ApiError(response.status, `CREDIGRUPO_HTTP_${response.status}`, toFriendlyMessage(response.status), {
          providerError,
        });
      }

      options?.onSuccessStatus?.(response.status, requestId);
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

  private assertInvestorManagementAvailable() {
    if (this.config.accountMode === CREDIGRUPO_ACCOUNT_MODE) {
      throw new ApiError(
        403,
        'ACCOUNT_MODE_NOT_APPLICABLE',
        'A chave propria da GR ja representa a investidora Credigrupo.',
      );
    }
  }

  async listInvestors(): Promise<CredigrupoInvestorResponse[]> {
    this.assertInvestorManagementAvailable();
    const first = await this.request<{ data: CredigrupoInvestorResponse[]; total: number }>('/investors?page=1&pageSize=50');
    const investors = [...first.data];
    const pages = Math.ceil(first.total / 50);
    for (let page = 2; page <= pages; page += 1) {
      const next = await this.request<{ data: CredigrupoInvestorResponse[]; total: number }>(`/investors?page=${page}&pageSize=50`);
      investors.push(...next.data);
    }
    return investors;
  }

  createInvestor(payload: CreateCredigrupoInvestorRequest) {
    this.assertInvestorManagementAvailable();
    return this.request<CredigrupoCreateInvestorResponse>('/investors', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  getInvestor(investorId: string) {
    this.assertInvestorManagementAvailable();
    return this.request<{ data: CredigrupoInvestorResponse }>(
      `/investors/${encodeURIComponent(investorId)}`,
    );
  }

  uploadInvestorDocuments(investorId: string, payload: CredigrupoInvestorDocumentsPayload) {
    this.assertInvestorManagementAvailable();
    return this.request<{ success: boolean; kyc_documents: Record<string, string> }>(
      `/investors/${encodeURIComponent(investorId)}/documents`,
      {
        method: 'POST',
        body: JSON.stringify(payload),
      },
    );
  }

  registerBorrower(payload: {
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

  updateBorrowerDisplayName(borrowerId: string, displayName: string) {
    return this.request<CredigrupoUpdateBorrowerResponse>(`/borrowers/${encodeURIComponent(borrowerId)}`, {
      method: 'PATCH',
      body: JSON.stringify({ display_name: displayName }),
    });
  }

  async getBorrowerEligibility(borrowerId: string): Promise<CredigrupoBorrowerEligibilityResponse> {
    const payload = await this.request<unknown>(
      `/borrowers/${encodeURIComponent(borrowerId)}/ccb-eligibility`,
    );
    return parseBorrowerEligibilityResponse(payload);
  }

  simulateLoan(payload: {
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

  async createLoan(payload: {
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
    let httpStatus = 0;
    const response = await this.request<Omit<CredigrupoCreateLoanResponse, 'httpStatus'>>('/loans', {
      method: 'POST',
      body: JSON.stringify(payload),
    }, { onSuccessStatus: (status) => { httpStatus = status; } });
    return { ...response, httpStatus };
  }

  async listLoansPage(): Promise<CredigrupoLoanListResponse> {
    let httpStatus = 0;
    const response = await this.request<Omit<CredigrupoLoanListResponse, 'httpStatus'>>(
      '/loans?page=1&pageSize=50',
      undefined,
      { onSuccessStatus: (status) => { httpStatus = status; } },
    );
    return {
      httpStatus,
      data: Array.isArray(response.data) ? response.data : [],
      total: Number.isFinite(Number(response.total)) ? Number(response.total) : 0,
    };
  }

  async getLoan(proposalId: string): Promise<CredigrupoLoanDetailsResponse> {
    let httpStatus = 0;
    const response = await this.request<Omit<CredigrupoLoanDetailsResponse, 'httpStatus'>>(
      `/loans/${encodeURIComponent(proposalId)}`,
      undefined,
      { onSuccessStatus: (status) => { httpStatus = status; } },
    );
    return { ...response, httpStatus };
  }

  listInstallments(proposalId: string) {
    return this.request<{ data: CredigrupoExternalInstallment[] }>(
      `/loans/${encodeURIComponent(proposalId)}/installments`,
    );
  }

  createInstallmentPix(proposalId: string, installmentId: string) {
    return this.request<CredigrupoInstallmentPixResult>(
      `/loans/${encodeURIComponent(proposalId)}/installments/${encodeURIComponent(installmentId)}/pix`,
      { method: 'POST' },
    );
  }

  async testPayLoan(proposalId: string) {
    let httpStatus = 0;
    let headerRequestId: string | undefined;
    const response = await this.request<Record<string, unknown>>(`/loans/${encodeURIComponent(proposalId)}/test-pay`, {
      method: 'POST',
    }, {
      onSuccessStatus: (status, requestId) => {
        httpStatus = status;
        headerRequestId = requestId;
      },
    });
    return { ...response, httpStatus, requestId: response.requestId || headerRequestId };
  }

  testPayInstallment(proposalId: string, installmentId: string) {
    return this.request<Record<string, unknown>>(
      `/loans/${encodeURIComponent(proposalId)}/installments/${encodeURIComponent(installmentId)}/test-pay`,
      { method: 'POST' },
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
