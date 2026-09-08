import type { CredigrupoBorrowerDocumentType } from '../../../../src/lib/creditProviders/types.js';

export interface SafeCredigrupoBorrowerState {
  borrowerId: string;
  kycStatus: string;
  ccbEligible: boolean | null;
  eligibilityErrors: string[];
  eligibilityCachedAt: string | null;
  documentsSubmitted: CredigrupoBorrowerDocumentType[];
  documentsComplete: boolean;
  documentsSubmittedAt: string | null;
}

interface SafeCredigrupoBorrowerStateInput {
  borrowerId: string;
  kycStatus: string;
  ccbEligible?: boolean;
  eligibilityErrors?: string[];
  eligibilityCachedAt?: string;
  documentsSubmitted?: CredigrupoBorrowerDocumentType[];
  documentsComplete?: boolean;
  documentsSubmittedAt?: string;
}

const FULL_NAME_PATTERN = /^\p{L}+(?: \p{L}+)+$/u;

export const normalizeBorrowerDisplayName = (value: unknown): string | null => {
  const normalized = String(value || '').trim().replace(/\s+/g, ' ');
  return FULL_NAME_PATTERN.test(normalized) ? normalized : null;
};

export const createSafeBorrowerState = (
  input: SafeCredigrupoBorrowerStateInput,
): SafeCredigrupoBorrowerState => ({
  borrowerId: input.borrowerId,
  kycStatus: input.kycStatus,
  ccbEligible: typeof input.ccbEligible === 'boolean' ? input.ccbEligible : null,
  eligibilityErrors: Array.isArray(input.eligibilityErrors)
    ? input.eligibilityErrors.filter((message): message is string => typeof message === 'string')
    : [],
  eligibilityCachedAt: input.eligibilityCachedAt || null,
  documentsSubmitted: Array.isArray(input.documentsSubmitted)
    ? input.documentsSubmitted.filter((type): type is CredigrupoBorrowerDocumentType => (
      type === 'selfie' || type === 'idFront' || type === 'idBack' || type === 'proofOfResidence'
    ))
    : [],
  documentsComplete: input.documentsComplete === true,
  documentsSubmittedAt: input.documentsSubmittedAt || null,
});

export const createBorrowerPersistencePayload = <TUpdatedAt>(
  state: SafeCredigrupoBorrowerState,
  updatedAt: TUpdatedAt,
) => ({
  ...state,
  updatedAt,
});
