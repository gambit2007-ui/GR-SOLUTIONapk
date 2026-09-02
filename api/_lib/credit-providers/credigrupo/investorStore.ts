import crypto from 'node:crypto';
import { ApiError, type AuthorizedActor } from '../../http.js';
import type {
  CredigrupoInvestorDocumentType,
  CredigrupoInvestorSummary,
  FundingSourceType,
} from '../../../../src/lib/creditProviders/types.js';

export interface StoredCreditInvestor {
  externalId?: string;
  provider?: 'CREDIGRUPO';
  capitalOrigin?: FundingSourceType;
  name?: string;
  email?: string;
  emailNormalized?: string;
  documentFingerprint?: string;
  documentMasked?: string;
  kycStatus?: string;
  externalStatus?: string;
  kycReason?: string | null;
  active?: boolean;
  manuallyDisabled?: boolean;
  documentsSubmitted?: CredigrupoInvestorDocumentType[];
  documentsComplete?: boolean;
  documentsSubmittedAt?: unknown;
  createdAt?: unknown;
  syncedAt?: unknown;
}

const timestampToIso = (value: unknown): string | undefined => {
  if (!value || typeof value !== 'object' || !('toDate' in value)) return undefined;
  const toDate = (value as { toDate?: unknown }).toDate;
  if (typeof toDate !== 'function') return undefined;
  const date = toDate.call(value) as Date;
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
};

export const assertInvestorAdmin = (actor: AuthorizedActor) => {
  if (!actor.admin) {
    throw new ApiError(403, 'ADMIN_REQUIRED', 'Somente administradores podem gerenciar investidores.');
  }
};

export const normalizeInvestorKycStatus = (value: unknown): string => {
  const status = String(value || '').trim().toLowerCase();
  if (status === 'pending_kyc' || status === 'pending_approval') return 'pending_approval';
  if (status === 'approved' || status === 'rejected' || status === 'blocked') return status;
  return status || 'pending_approval';
};

export const maskInvestorEmail = (value: unknown): string | undefined => {
  const email = String(value || '').trim().toLowerCase();
  const separator = email.indexOf('@');
  if (separator <= 0) return undefined;
  const local = email.slice(0, separator);
  const domain = email.slice(separator + 1);
  const visible = local.slice(0, Math.min(2, local.length));
  return `${visible}${'*'.repeat(Math.max(3, local.length - visible.length))}@${domain}`;
};

export const maskInvestorDocument = (value: unknown): string | undefined => {
  const document = String(value || '').replace(/\D/g, '');
  if (document.length < 4) return undefined;
  return `***.***.***-${document.slice(-2)}`;
};

export const fingerprintInvestorDocument = (document: string, secret: string): string => {
  const normalized = String(document || '').replace(/\D/g, '');
  if (!normalized || !secret) throw new Error('INVESTOR_FINGERPRINT_UNAVAILABLE');
  return crypto.createHmac('sha256', secret).update(normalized, 'utf8').digest('hex');
};

export const resolveExternalInvestorId = (id: string, investor: StoredCreditInvestor): string =>
  String(investor.externalId || id).trim();

export const isStoredInvestorApprovedAndActive = (
  investor: StoredCreditInvestor,
): boolean => investor.provider === 'CREDIGRUPO'
  && investor.active === true
  && normalizeInvestorKycStatus(investor.kycStatus) === 'approved';

export const isStoredInvestorEligible = (
  investor: StoredCreditInvestor,
  capitalOrigin: FundingSourceType,
): boolean => isStoredInvestorApprovedAndActive(investor)
  && investor.capitalOrigin === capitalOrigin;

export const toInvestorSummary = (
  id: string,
  investor: StoredCreditInvestor,
): CredigrupoInvestorSummary => ({
  id,
  externalId: resolveExternalInvestorId(id, investor),
  name: String(investor.name || 'INVESTIDOR').trim(),
  emailMasked: maskInvestorEmail(investor.email),
  documentMasked: investor.documentMasked,
  kycStatus: normalizeInvestorKycStatus(investor.kycStatus),
  externalStatus: String(investor.externalStatus || investor.kycStatus || 'pending_approval'),
  provider: 'CREDIGRUPO',
  capitalOrigin: investor.capitalOrigin === 'EXTERNAL' ? 'EXTERNAL' : 'GR',
  active: investor.active === true,
  documentsSubmitted: Array.isArray(investor.documentsSubmitted) ? investor.documentsSubmitted : undefined,
  documentsComplete: investor.documentsComplete === true,
  documentsSubmittedAt: timestampToIso(investor.documentsSubmittedAt),
  createdAt: timestampToIso(investor.createdAt),
  syncedAt: timestampToIso(investor.syncedAt),
});

export const resolveKycTarget = (role: unknown): 'INVESTOR' | 'BORROWER' | 'LEGACY' => {
  const normalized = String(role || '').trim().toLowerCase();
  if (normalized === 'user' || normalized === 'investor') return 'INVESTOR';
  if (normalized === 'borrower') return 'BORROWER';
  return 'LEGACY';
};
