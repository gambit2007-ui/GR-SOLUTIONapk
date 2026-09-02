import { describe, expect, it } from 'vitest';
import {
  assertInvestorAdmin,
  fingerprintInvestorDocument,
  isStoredInvestorEligible,
  maskInvestorDocument,
  maskInvestorEmail,
  normalizeInvestorKycStatus,
  resolveExternalInvestorId,
  resolveKycTarget,
} from '../investorStore';

describe('regras internas de investidores Credigrupo', () => {
  it('permite gestao apenas para ADMIN', () => {
    expect(() => assertInvestorAdmin({ uid: 'admin', admin: true })).not.toThrow();
    expect(() => assertInvestorAdmin({ uid: 'user', admin: false })).toThrowError(expect.objectContaining({
      status: 403,
      code: 'ADMIN_REQUIRED',
    }));
  });

  it('preserva ID externo separado e mantem fallback legado', () => {
    expect(resolveExternalInvestorId('local-1', { externalId: 'external-1' })).toBe('external-1');
    expect(resolveExternalInvestorId('legacy-external-id', {})).toBe('legacy-external-id');
  });

  it('normaliza status e papel oficial do webhook', () => {
    expect(normalizeInvestorKycStatus('pending_kyc')).toBe('pending_approval');
    expect(resolveKycTarget('user')).toBe('INVESTOR');
    expect(resolveKycTarget('borrower')).toBe('BORROWER');
    expect(resolveKycTarget(undefined)).toBe('LEGACY');
  });

  it('impede investidor pendente, inativo ou de outra origem', () => {
    const approved = { provider: 'CREDIGRUPO' as const, capitalOrigin: 'EXTERNAL' as const, active: true, kycStatus: 'approved' };
    expect(isStoredInvestorEligible(approved, 'EXTERNAL')).toBe(true);
    expect(isStoredInvestorEligible({ ...approved, active: false }, 'EXTERNAL')).toBe(false);
    expect(isStoredInvestorEligible({ ...approved, kycStatus: 'rejected' }, 'EXTERNAL')).toBe(false);
    expect(isStoredInvestorEligible(approved, 'GR')).toBe(false);
  });

  it('mascara documento e e-mail sem expor dados completos', () => {
    expect(maskInvestorDocument('52998224725')).toBe('***.***.***-25');
    expect(maskInvestorEmail('investidor@example.com')).toBe('in********@example.com');
  });

  it('gera fingerprint com secret oficial curto e exige secret presente', () => {
    expect(fingerprintInvestorDocument('52998224725', 'official-short-secret')).toMatch(/^[a-f0-9]{64}$/);
    expect(() => fingerprintInvestorDocument('52998224725', '')).toThrow('INVESTOR_FINGERPRINT_UNAVAILABLE');
  });
});
