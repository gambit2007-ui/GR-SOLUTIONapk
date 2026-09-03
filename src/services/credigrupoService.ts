import { deleteObject, getStorage, ref, uploadBytes } from 'firebase/storage';
import { auth, firebaseApp } from '../firebase';
import type {
  CreateBancarizedLoanRequest,
  CreateBancarizedLoanResult,
  CreateCredigrupoInvestorRequest,
  CreateCredigrupoInvestorResult,
  CredigrupoBorrowerState,
  CredigrupoIntegrationStatus,
  CredigrupoInstallmentActionRequest,
  CredigrupoInstallmentPixResult,
  CredigrupoInvestorSummary,
  CredigrupoInvestorDetails,
  CredigrupoInvestorDocumentReference,
  CredigrupoInvestorDocumentType,
  CredigrupoGrInvestorSettings,
  CredigrupoOperationSummary,
  CredigrupoRuntimeDiagnostics,
  CredigrupoSimulationRequest,
  CredigrupoSimulationResult,
  CredigrupoTestPayRequest,
  EnsureCredigrupoBorrowerRequest,
  FundingSourceType,
  UpdateCredigrupoInvestorRequest,
  UpdateCredigrupoGrInvestorRequest,
  UploadCredigrupoInvestorDocumentsRequest,
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

export const getCredigrupoStatus = () => request<CredigrupoIntegrationStatus>('/api/credigrupo/status', {
  cache: 'no-store',
});
export const getCredigrupoRuntimeDiagnostics = () =>
  request<CredigrupoRuntimeDiagnostics>('/api/credigrupo/status?diagnostic=true');

export const listCredigrupoInvestors = async (options?: {
  eligibleOnly?: boolean;
  capitalOrigin?: FundingSourceType;
}) => {
  const search = new URLSearchParams();
  if (options?.eligibleOnly) search.set('eligibleOnly', 'true');
  if (options?.capitalOrigin) search.set('capitalOrigin', options.capitalOrigin);
  const suffix = search.size > 0 ? `?${search.toString()}` : '';
  const result = await request<{ investors: CredigrupoInvestorSummary[] }>(`/api/credigrupo/investors${suffix}`);
  return result.investors;
};

export const syncCredigrupoInvestors = async () => {
  const result = await request<{ investors: CredigrupoInvestorSummary[] }>('/api/credigrupo/investors?sync=true');
  return result.investors;
};

export const getCredigrupoInvestor = async (id: string) => {
  const result = await request<{ investor: CredigrupoInvestorDetails }>(`/api/credigrupo/investors?id=${encodeURIComponent(id)}`);
  return result.investor;
};

export const createCredigrupoInvestor = (payload: CreateCredigrupoInvestorRequest) =>
  request<CreateCredigrupoInvestorResult>('/api/credigrupo/investors', {
    method: 'POST',
    body: JSON.stringify(payload),
  });

const investorDocumentExtension = (file: File) => {
  if (file.type === 'image/jpeg') return 'jpg';
  if (file.type === 'image/png') return 'png';
  if (file.type === 'image/webp') return 'webp';
  if (file.type === 'application/pdf') return 'pdf';
  return 'bin';
};

export const uploadCredigrupoInvestorDocuments = async (
  investorId: string,
  documents: Partial<Record<CredigrupoInvestorDocumentType, File>>,
) => {
  const user = auth.currentUser;
  if (!user) throw new CredigrupoServiceError('AUTH_REQUIRED', 'Faca login novamente.');
  await user.getIdToken();
  const uploadId = crypto.randomUUID();
  const storage = getStorage(firebaseApp);
  const uploadedReferences: Array<{
    api: CredigrupoInvestorDocumentReference;
    storage: ReturnType<typeof ref>;
  }> = [];

  try {
    for (const [type, file] of Object.entries(documents) as Array<[CredigrupoInvestorDocumentType, File]>) {
      if (!file) continue;
      const storagePath = `credigrupo-kyc/${user.uid}/${uploadId}/${type}.${investorDocumentExtension(file)}`;
      const storageReference = ref(storage, storagePath);
      await uploadBytes(storageReference, file, { contentType: file.type });
      uploadedReferences.push({
        api: { type, storagePath },
        storage: storageReference,
      });
    }

    const payload: UploadCredigrupoInvestorDocumentsRequest = {
      investorId,
      documents: uploadedReferences.map((item) => item.api),
    };
    return await request<{
      success: true;
      documentsSubmitted: CredigrupoInvestorDocumentType[];
      documentsComplete: boolean;
    }>('/api/credigrupo/investor-documents', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  } finally {
    await Promise.allSettled(uploadedReferences.map((item) => deleteObject(item.storage)));
  }
};

export const updateCredigrupoInvestor = (payload: UpdateCredigrupoInvestorRequest) =>
  request<{ investor: CredigrupoInvestorSummary }>('/api/credigrupo/investors', {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });

export const getCredigrupoGrInvestorSettings = async () => {
  const result = await request<{ settings: CredigrupoGrInvestorSettings }>('/api/credigrupo/gr-investor', {
    cache: 'no-store',
  });
  return result.settings;
};

export const updateCredigrupoGrInvestorSettings = async (payload: UpdateCredigrupoGrInvestorRequest) => {
  const result = await request<{ settings: CredigrupoGrInvestorSettings }>('/api/credigrupo/gr-investor', {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
  return result.settings;
};

export const ensureCredigrupoBorrower = (payload: EnsureCredigrupoBorrowerRequest) =>
  request<CredigrupoBorrowerState>('/api/credigrupo/borrowers', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
export const getStoredCredigrupoBorrower = (customerId: string) =>
  request<CredigrupoBorrowerState>(`/api/credigrupo/borrowers?customerId=${encodeURIComponent(customerId)}`, {
    cache: 'no-store',
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

export interface CredigrupoSigningLinkRecoveryResult {
  recovered: true;
  alreadyRecovered: boolean;
  source: 'EVENT';
  eventId: string;
  hmacValidated: true;
  borrowerHostname: string;
  investorHostname?: string;
  investorPreSigned: boolean;
  borrowerSignUrlPresent: true;
  investorSignUrlPresent: boolean;
  status: 'AWAITING_SIGNATURES';
  externalStatus?: string;
  formalizationStatus?: string;
}

export const recoverCredigrupoSigningLinks = (operationId: string) =>
  request<CredigrupoSigningLinkRecoveryResult>('/api/credigrupo/events/reprocess', {
    method: 'POST',
    body: JSON.stringify({ action: 'reprocess_ccb_signing_links', operationId }),
  });

export const reconcileCredigrupoOperation = (operationId: string) =>
  request<{ reconciled: boolean; externalStatus: string; formalizationStatus: string; installments: number }>('/api/credigrupo/reconcile', {
    method: 'POST',
    body: JSON.stringify({ operationId }),
  });

export interface CredigrupoLoanDiscoveryResult {
  status: 'NOT_FOUND' | 'AMBIGUOUS' | 'RECONCILED';
  alreadyReconciled: boolean;
  proposalId?: string;
  externalStatus?: string;
  formalizationStatus?: string;
  candidates?: number | unknown[];
}

export const discoverExistingCredigrupoLoan = (operationId: string) =>
  request<CredigrupoLoanDiscoveryResult>('/api/credigrupo/reconcile', {
    method: 'POST',
    body: JSON.stringify({ operationId, action: 'discover_existing_loan' }),
  });

export interface CredigrupoConfirmedReconciliationInput {
  operationId: string;
  proposalId: string;
  requestId: string;
  pix: {
    amountCents: number;
    expiresAt: string;
    correlationId: string;
  };
}

export const reconcileConfirmedCredigrupoLoan = (input: CredigrupoConfirmedReconciliationInput) =>
  request<{
    reconciled: true;
    alreadyReconciled: boolean;
    getLoanHttpStatus?: number;
    proposalId: string;
    requestId?: string;
    externalStatus?: string;
    formalizationStatus?: string;
    unknownProviderStatus: boolean;
    pix?: CredigrupoConfirmedReconciliationInput['pix'];
    localStatus: string;
  }>('/api/credigrupo/reconcile', {
    method: 'POST',
    body: JSON.stringify({ ...input, action: 'reconcile_confirmed_loan' }),
  });

export const cancelCredigrupoOperation = (operationId: string) =>
  request<{ cancellationRequested: true; cancelled: false }>('/api/credigrupo/cancel', {
    method: 'POST',
    body: JSON.stringify({ operationId }),
  });

export const createCredigrupoInstallmentPix = (payload: CredigrupoInstallmentActionRequest) =>
  request<CredigrupoInstallmentPixResult>('/api/credigrupo/installments/pix', {
    method: 'POST',
    body: JSON.stringify(payload),
  });

export const testPayCredigrupoSandbox = (payload: CredigrupoTestPayRequest) =>
  request<{
    simulated: true;
    target: 'FUNDING' | 'INSTALLMENT';
    httpStatus?: number;
    requestId?: string;
    proposalId?: string;
    status?: string;
    formalizationStatus?: string;
    message?: string;
  }>('/api/admin/credigrupo/test-pay', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
