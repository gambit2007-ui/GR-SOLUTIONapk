import { ApiError, type AuthorizedActor } from '../../http.js';

export interface CredigrupoDiscoveryCriteria {
  borrowerId: string;
  amountCents: number;
  installments: number;
  createdAt?: string;
  firstPaymentDate?: string;
  interestRate?: number;
  simulationExternalId?: string;
}

export interface CredigrupoConfirmedLoanEvidence {
  proposalId: string;
  requestId?: string;
  pix?: {
    amountCents?: number;
    expiresAt?: string;
    correlationId?: string;
  };
}

export interface SafeCredigrupoLoanCandidate {
  proposalId: string;
  borrowerIdMasked?: string;
  amountCents?: number;
  installments?: number;
  status?: string;
  formalizationStatus?: string;
  createdAt?: string;
}

interface ParsedCredigrupoLoan extends SafeCredigrupoLoanCandidate {
  borrowerId?: string;
  requestId?: string;
  firstPaymentDate?: string;
  interestRate?: number;
  pix?: {
    amountCents?: number;
    expiresAt?: string;
    correlationId?: string;
  };
}

export interface CredigrupoLoanReader {
  listLoansPage(): Promise<{ httpStatus: number; data: unknown[]; total: number }>;
  getLoan(proposalId: string): Promise<unknown>;
}

export type CredigrupoLoanDiscoveryResult =
  | {
    status: 'NOT_FOUND';
    listHttpStatus: number;
    detailHttpStatus?: number;
    receivedCount: number;
    total: number;
    candidates: SafeCredigrupoLoanCandidate[];
    reason: string;
  }
  | {
    status: 'AMBIGUOUS';
    listHttpStatus: number;
    receivedCount: number;
    total: number;
    candidates: SafeCredigrupoLoanCandidate[];
  }
  | {
    status: 'MATCHED';
    listHttpStatus: number;
    detailHttpStatus: number;
    receivedCount: number;
    total: number;
    candidate: SafeCredigrupoLoanCandidate;
    confirmedResponse: Record<string, unknown>;
  };

export interface CredigrupoConfirmedLoanResult {
  detailHttpStatus: number;
  candidate: SafeCredigrupoLoanCandidate;
  confirmedResponse: Record<string, unknown>;
}

const DISCOVERY_WINDOW_MS = 24 * 60 * 60 * 1_000;

const asRecord = (value: unknown): Record<string, unknown> | undefined => (
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
);

const asText = (value: unknown): string | undefined => {
  const text = typeof value === 'string' ? value.trim() : '';
  return text || undefined;
};

const asSafeIdentifier = (value: unknown): string | undefined => {
  const text = asText(value);
  return text && /^[A-Za-z0-9._:-]{1,200}$/.test(text) ? text : undefined;
};

const asNumber = (value: unknown): number | undefined => {
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) ? number : undefined;
};

const asInteger = (value: unknown): number | undefined => {
  const number = asNumber(value);
  return number !== undefined && Number.isSafeInteger(number) && number >= 0 ? number : undefined;
};

const asDate = (value: unknown): string | undefined => {
  const text = asText(value);
  return text && !Number.isNaN(Date.parse(text)) ? text : undefined;
};

const readInstallments = (...sources: Array<Record<string, unknown> | undefined>): number | undefined => {
  for (const source of sources) {
    if (!source) continue;
    const direct = source.installments ?? source.installment_count ?? source.installments_count
      ?? source.number_of_installments;
    if (Array.isArray(direct)) return direct.length;
    const parsed = asInteger(direct);
    if (parsed !== undefined) return parsed;
    const simulation = asRecord(source.simulation);
    if (Array.isArray(simulation?.installments)) return simulation.installments.length;
  }
  return undefined;
};

const readPix = (root: Record<string, unknown>) => {
  const pix = asRecord(root.pix) || asRecord(root.funding_pix) || asRecord(root.fee_pix);
  if (!pix) return undefined;
  const safe = {
    amountCents: asInteger(pix.amountCents ?? pix.amount_cents),
    expiresAt: asDate(pix.expiresAt ?? pix.expires_at),
    correlationId: asSafeIdentifier(pix.correlationId ?? pix.correlationID ?? pix.correlation_id),
  };
  return Object.values(safe).some((value) => value !== undefined) ? safe : undefined;
};

export const parseCredigrupoLoanForDiscovery = (value: unknown): ParsedCredigrupoLoan | undefined => {
  const envelope = asRecord(value);
  const root = asRecord(envelope?.data) || envelope;
  if (!root) return undefined;
  const request = asRecord(root.request) || asRecord(root.loan_requests) || asRecord(root.loanRequest);
  const borrower = asRecord(request?.borrower) || asRecord(root.borrower);
  const proposalId = asSafeIdentifier(root.id ?? root.proposalId ?? root.proposal_id);
  if (!proposalId) return undefined;
  const borrowerId = asSafeIdentifier(
    borrower?.user_id ?? borrower?.id ?? root.borrowerId ?? root.borrower_id,
  );
  const status = asText(root.status)?.toLowerCase();
  const formalizationStatus = asText(root.formalization_status ?? root.formalizationStatus)?.toLowerCase();

  return {
    proposalId,
    borrowerId,
    borrowerIdMasked: borrowerId ? `***${borrowerId.slice(-6)}` : undefined,
    amountCents: asInteger(request?.amount ?? request?.amountCents ?? root.amountCents ?? root.amount),
    installments: readInstallments(request, root),
    status,
    formalizationStatus,
    createdAt: asDate(root.created_at ?? root.createdAt),
    requestId: asSafeIdentifier(request?.id ?? root.requestId ?? root.request_id),
    firstPaymentDate: asDate(
      request?.firstPaymentDate ?? request?.first_payment_date
        ?? root.firstPaymentDate ?? root.first_payment_date,
    ),
    interestRate: asNumber(request?.interestRate ?? request?.interest_rate ?? root.interestRate),
    pix: readPix(root),
  };
};

const toSafeCandidate = (candidate: ParsedCredigrupoLoan): SafeCredigrupoLoanCandidate => ({
  proposalId: candidate.proposalId,
  borrowerIdMasked: candidate.borrowerIdMasked,
  amountCents: candidate.amountCents,
  installments: candidate.installments,
  status: candidate.status,
  formalizationStatus: candidate.formalizationStatus,
  createdAt: candidate.createdAt,
});

const dateMatches = (externalDate: string | undefined, localDate: string | undefined): boolean => {
  if (!externalDate || !localDate) return true;
  return Math.abs(Date.parse(externalDate) - Date.parse(localDate)) <= DISCOVERY_WINDOW_MS;
};

const candidateMatches = (
  candidate: ParsedCredigrupoLoan,
  criteria: CredigrupoDiscoveryCriteria,
): boolean => (
  candidate.borrowerId === criteria.borrowerId
  && candidate.amountCents === criteria.amountCents
  && (candidate.installments === undefined || candidate.installments === criteria.installments)
  && (!candidate.formalizationStatus || candidate.formalizationStatus === 'awaiting_lender_payment')
  && dateMatches(candidate.createdAt, criteria.createdAt)
  && (!candidate.firstPaymentDate || !criteria.firstPaymentDate
    || candidate.firstPaymentDate.slice(0, 10) === criteria.firstPaymentDate.slice(0, 10))
  && (candidate.interestRate === undefined || criteria.interestRate === undefined
    || Math.abs(candidate.interestRate - criteria.interestRate) < 0.0001)
);

const detailMatches = (
  candidate: ParsedCredigrupoLoan,
  criteria: CredigrupoDiscoveryCriteria,
): boolean => (
  candidateMatches(candidate, criteria)
  && candidate.installments === criteria.installments
  && candidate.formalizationStatus === 'awaiting_lender_payment'
);

const optionalValuesMatch = <T>(providerValue: T | undefined, confirmedValue: T | undefined): boolean => (
  providerValue === undefined || confirmedValue === undefined || providerValue === confirmedValue
);

const optionalRatesMatch = (providerValue: number | undefined, confirmedValue: number | undefined): boolean => (
  providerValue === undefined || confirmedValue === undefined
  || Math.abs(providerValue - confirmedValue) < 0.0001
);

export const confirmCredigrupoLoanByProposalId = async (
  criteria: CredigrupoDiscoveryCriteria,
  evidence: CredigrupoConfirmedLoanEvidence,
  client: Pick<CredigrupoLoanReader, 'getLoan'>,
): Promise<CredigrupoConfirmedLoanResult> => {
  const proposalId = asSafeIdentifier(evidence.proposalId);
  if (!proposalId) {
    throw new ApiError(400, 'INVALID_PROPOSAL_ID', 'Identificador da proposta invalido.');
  }

  const detailsPayload = await client.getLoan(proposalId);
  const detailsEnvelope = asRecord(detailsPayload) || {};
  const detailHttpStatus = asInteger(detailsEnvelope.httpStatus) || 0;
  const details = parseCredigrupoLoanForDiscovery(detailsPayload);
  const requestIdMatches = optionalValuesMatch(details?.requestId, evidence.requestId);
  const pixMatches = optionalValuesMatch(details?.pix?.amountCents, evidence.pix?.amountCents)
    && optionalValuesMatch(details?.pix?.expiresAt, evidence.pix?.expiresAt)
    && optionalValuesMatch(details?.pix?.correlationId, evidence.pix?.correlationId);
  const coreMatches = Boolean(
    details
    && details.proposalId === proposalId
    && details.borrowerId === criteria.borrowerId
    && details.amountCents === criteria.amountCents
    && details.status === 'accepted'
    && details.formalizationStatus === 'awaiting_lender_payment'
    && (details.installments === undefined || details.installments === criteria.installments)
    && optionalRatesMatch(details.interestRate, criteria.interestRate)
    && (!details.firstPaymentDate || !criteria.firstPaymentDate
      || details.firstPaymentDate.slice(0, 10) === criteria.firstPaymentDate.slice(0, 10))
  );

  if (!details || !coreMatches || !requestIdMatches || !pixMatches) {
    throw new ApiError(
      409,
      'CONFIRMED_LOAN_DIVERGED',
      'A proposta consultada diverge da operacao local confirmada.',
    );
  }

  const confirmedPix = {
    amountCents: details.pix?.amountCents ?? evidence.pix?.amountCents,
    expiresAt: details.pix?.expiresAt ?? evidence.pix?.expiresAt,
    correlationId: details.pix?.correlationId ?? evidence.pix?.correlationId,
  };

  return {
    detailHttpStatus,
    candidate: toSafeCandidate(details),
    confirmedResponse: {
      httpStatus: detailHttpStatus,
      proposalId: details.proposalId,
      requestId: details.requestId || evidence.requestId,
      status: details.status,
      formalization_status: details.formalizationStatus,
      pix: Object.values(confirmedPix).some((value) => value !== undefined) ? confirmedPix : undefined,
    },
  };
};

export const assertCredigrupoDiscoveryAdmin = (actor?: AuthorizedActor): void => {
  if (!actor) throw new ApiError(401, 'AUTH_REQUIRED', 'Autenticacao obrigatoria.');
  if (!actor.admin) throw new ApiError(403, 'ADMIN_REQUIRED', 'Somente administradores podem descobrir operacoes.');
};

export const isCredigrupoDiscoveryAlreadyReconciled = (operation: {
  status?: string;
  proposalId?: string;
}): boolean => Boolean(operation.proposalId && operation.status !== 'RECONCILIATION_REQUIRED');

export const discoverExistingCredigrupoLoan = async (
  criteria: CredigrupoDiscoveryCriteria,
  client: CredigrupoLoanReader,
): Promise<CredigrupoLoanDiscoveryResult> => {
  const page = await client.listLoansPage();
  const candidates = page.data
    .map(parseCredigrupoLoanForDiscovery)
    .filter((candidate): candidate is ParsedCredigrupoLoan => Boolean(candidate))
    .filter((candidate) => candidateMatches(candidate, criteria));
  const safeCandidates = candidates.map(toSafeCandidate);

  if (candidates.length === 0) {
    return {
      status: 'NOT_FOUND',
      listHttpStatus: page.httpStatus,
      receivedCount: page.data.length,
      total: page.total,
      candidates: [],
      reason: page.total > page.data.length ? 'NOT_FOUND_ON_FIRST_PAGE' : 'NO_MATCHING_LOAN',
    };
  }
  if (candidates.length > 1) {
    return {
      status: 'AMBIGUOUS',
      listHttpStatus: page.httpStatus,
      receivedCount: page.data.length,
      total: page.total,
      candidates: safeCandidates,
    };
  }

  const detailsPayload = await client.getLoan(candidates[0].proposalId);
  const detailsEnvelope = asRecord(detailsPayload) || {};
  const detailHttpStatus = asInteger(detailsEnvelope.httpStatus) || 0;
  const details = parseCredigrupoLoanForDiscovery(detailsPayload);
  if (!details || !detailMatches(details, criteria) || details.proposalId !== candidates[0].proposalId) {
    return {
      status: 'NOT_FOUND',
      listHttpStatus: page.httpStatus,
      detailHttpStatus,
      receivedCount: page.data.length,
      total: page.total,
      candidates: safeCandidates,
      reason: 'INDIVIDUAL_LOAN_DIVERGED',
    };
  }

  return {
    status: 'MATCHED',
    listHttpStatus: page.httpStatus,
    detailHttpStatus,
    receivedCount: page.data.length,
    total: page.total,
    candidate: toSafeCandidate(details),
    confirmedResponse: {
      httpStatus: detailHttpStatus,
      proposalId: details.proposalId,
      requestId: details.requestId,
      status: details.formalizationStatus,
      formalization_status: details.formalizationStatus,
      pix: details.pix,
    },
  };
};
