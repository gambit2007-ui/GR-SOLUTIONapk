import { adminDb } from '../../firebaseAdmin.js';
import { ApiError } from '../../http.js';
import type {
  CredigrupoGrInvestorSettings,
  FundingSourceType,
} from '../../../../src/lib/creditProviders/types.js';
import {
  isStoredInvestorApprovedAndActive,
  isStoredInvestorEligible,
  normalizeInvestorKycStatus,
  resolveExternalInvestorId,
  type StoredCreditInvestor,
} from './investorStore.js';

export const CREDIGRUPO_PROVIDER_SETTINGS_PATH = 'creditProviderSettings/credigrupo';

export interface StoredCredigrupoProviderSettings {
  grInvestorId?: string;
  grInvestorInternalId?: string;
  grInvestorName?: string;
  grInvestorConfigured?: boolean;
  kycStatus?: string;
  syncedAt?: unknown;
  updatedAt?: unknown;
  updatedBy?: string;
}

export interface ResolvedCredigrupoFundingInvestor {
  internalId: string;
  externalId: string;
  name: string;
  investor: StoredCreditInvestor;
}

const timestampToIso = (value: unknown): string | undefined => {
  if (!value || typeof value !== 'object' || !('toDate' in value)) return undefined;
  const toDate = (value as { toDate?: unknown }).toDate;
  if (typeof toDate !== 'function') return undefined;
  const date = toDate.call(value) as Date;
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
};

export const maskCredigrupoInvestorId = (value: unknown): string | undefined => {
  const id = String(value || '').trim();
  if (!id) return undefined;
  if (id.length <= 8) return `${id.slice(0, 2)}***${id.slice(-2)}`;
  return `${id.slice(0, 4)}...${id.slice(-4)}`;
};

export const resolveFundingInvestorInternalId = (
  fundingSource: FundingSourceType,
  requestedInvestorId: unknown,
  settings?: StoredCredigrupoProviderSettings,
): string => {
  if (fundingSource === 'GR') {
    const configuredId = String(settings?.grInvestorInternalId || '').trim();
    if (settings?.grInvestorConfigured !== true || !configuredId || !String(settings.grInvestorId || '').trim()) {
      throw new ApiError(409, 'GR_INVESTOR_NOT_CONFIGURED', 'Investidor Credigrupo da GR ainda nao configurado.');
    }
    return configuredId;
  }

  const selectedId = String(requestedInvestorId || '').trim();
  if (!selectedId) {
    throw new ApiError(400, 'INVESTOR_REQUIRED', 'Selecione um investidor externo.');
  }
  return selectedId;
};

export const resolveCredigrupoFundingInvestor = async (
  fundingSource: FundingSourceType,
  requestedInvestorId?: string,
): Promise<ResolvedCredigrupoFundingInvestor> => {
  const settingsSnapshot = fundingSource === 'GR'
    ? await adminDb.doc(CREDIGRUPO_PROVIDER_SETTINGS_PATH).get()
    : null;
  const settings = settingsSnapshot?.data() as StoredCredigrupoProviderSettings | undefined;
  const internalId = resolveFundingInvestorInternalId(fundingSource, requestedInvestorId, settings);
  const investorSnapshot = await adminDb.doc(`creditInvestors/${internalId}`).get();
  if (!investorSnapshot.exists) {
    throw new ApiError(409, fundingSource === 'GR' ? 'GR_INVESTOR_NOT_CONFIGURED' : 'INVESTOR_NOT_APPROVED',
      fundingSource === 'GR' ? 'Investidor Credigrupo da GR ainda nao configurado.' : 'Investidor nao encontrado ou ainda nao aprovado.');
  }

  const investor = investorSnapshot.data() as StoredCreditInvestor;
  const eligible = fundingSource === 'GR'
    ? isStoredInvestorApprovedAndActive(investor) && investor.capitalOrigin === 'GR'
    : isStoredInvestorEligible(investor, 'EXTERNAL');
  if (!eligible) {
    throw new ApiError(409, fundingSource === 'GR' ? 'GR_INVESTOR_NOT_CONFIGURED' : 'INVESTOR_NOT_APPROVED',
      fundingSource === 'GR' ? 'Investidor Credigrupo da GR ainda nao configurado.' : 'Selecione um investidor aprovado e ativo.');
  }

  const externalId = resolveExternalInvestorId(internalId, investor);
  if (fundingSource === 'GR' && externalId !== String(settings?.grInvestorId || '').trim()) {
    throw new ApiError(409, 'GR_INVESTOR_REFERENCE_CHANGED', 'O vinculo do investidor da GR mudou. Atualize a configuracao.');
  }
  const name = String(investor.name || settings?.grInvestorName || '').trim();
  if (!name) throw new ApiError(409, 'INVESTOR_NAME_UNAVAILABLE', 'Nome do investidor indisponivel. Sincronize novamente.');

  return { internalId, externalId, name, investor };
};

export const readCredigrupoGrInvestorSettings = async (): Promise<CredigrupoGrInvestorSettings> => {
  const settingsSnapshot = await adminDb.doc(CREDIGRUPO_PROVIDER_SETTINGS_PATH).get();
  if (!settingsSnapshot.exists) return { configured: false };
  const settings = settingsSnapshot.data() as StoredCredigrupoProviderSettings;
  const internalId = String(settings.grInvestorInternalId || '').trim();
  const externalId = String(settings.grInvestorId || '').trim();
  if (!settings.grInvestorConfigured || !internalId || !externalId) return { configured: false };

  const investorSnapshot = await adminDb.doc(`creditInvestors/${internalId}`).get();
  const investor = investorSnapshot.data() as StoredCreditInvestor | undefined;
  const configured = Boolean(investorSnapshot.exists
    && investor
    && isStoredInvestorApprovedAndActive(investor)
    && investor.capitalOrigin === 'GR'
    && resolveExternalInvestorId(internalId, investor) === externalId);

  return {
    configured,
    investorInternalId: internalId,
    investorIdMasked: maskCredigrupoInvestorId(externalId),
    investorName: String(investor?.name || settings.grInvestorName || '').trim() || undefined,
    kycStatus: normalizeInvestorKycStatus(investor?.kycStatus || settings.kycStatus) as CredigrupoGrInvestorSettings['kycStatus'],
    syncedAt: timestampToIso(investor?.syncedAt || settings.syncedAt),
    updatedAt: timestampToIso(settings.updatedAt),
  };
};
