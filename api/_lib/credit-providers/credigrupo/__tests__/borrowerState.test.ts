import { describe, expect, it } from 'vitest';
import {
  createBorrowerPersistencePayload,
  createSafeBorrowerState,
  normalizeBorrowerDisplayName,
} from '../borrowerState';

describe('estado seguro do borrower Credigrupo', () => {
  it('aceita somente nome e sobrenome formados por letras e espacos', () => {
    expect(normalizeBorrowerDisplayName('  Robson   Leandro  ')).toBe('Robson Leandro');
    expect(normalizeBorrowerDisplayName('Joao da Silva')).toBe('Joao da Silva');
    expect(normalizeBorrowerDisplayName('Cliente Teste 20260831')).toBeNull();
    expect(normalizeBorrowerDisplayName('Robson')).toBeNull();
    expect(normalizeBorrowerDisplayName('Robson L.')).toBeNull();
  });

  it('propaga elegibilidade, motivos e cache sem campos sensiveis', () => {
    const state = createSafeBorrowerState({
      borrowerId: 'borrower-1',
      kycStatus: 'approved',
      ccbEligible: false,
      eligibilityErrors: ['Documento invalido'],
      eligibilityCachedAt: '2026-08-27T12:00:00.000Z',
      documentsSubmitted: ['selfie', 'idFront'],
      documentsComplete: false,
      documentsSubmittedAt: '2026-09-08T18:00:00.000Z',
    });

    expect(state).toEqual({
      borrowerId: 'borrower-1',
      kycStatus: 'approved',
      ccbEligible: false,
      eligibilityErrors: ['Documento invalido'],
      eligibilityCachedAt: '2026-08-27T12:00:00.000Z',
      documentsSubmitted: ['selfie', 'idFront'],
      documentsComplete: false,
      documentsSubmittedAt: '2026-09-08T18:00:00.000Z',
    });
    expect(Object.keys(state)).toEqual([
      'borrowerId',
      'kycStatus',
      'ccbEligible',
      'eligibilityErrors',
      'eligibilityCachedAt',
      'documentsSubmitted',
      'documentsComplete',
      'documentsSubmittedAt',
    ]);
    expect(Object.keys(state)).not.toEqual(
      expect.arrayContaining(['cpf', 'document', 'bank', 'pix', 'kyc_data']),
    );
  });

  it('mantem resultado desconhecido como null, sem converte-lo em false', () => {
    expect(createSafeBorrowerState({
      borrowerId: 'borrower-1',
      kycStatus: 'approved',
    })).toEqual({
      borrowerId: 'borrower-1',
      kycStatus: 'approved',
      ccbEligible: null,
      eligibilityErrors: [],
      eligibilityCachedAt: null,
      documentsSubmitted: [],
      documentsComplete: false,
      documentsSubmittedAt: null,
    });
  });

  it('persiste somente o estado seguro e updatedAt', () => {
    const state = createSafeBorrowerState({
      borrowerId: 'borrower-1',
      kycStatus: 'approved',
      ccbEligible: true,
      eligibilityErrors: [],
      eligibilityCachedAt: '2026-08-27T12:00:00.000Z',
    });

    expect(createBorrowerPersistencePayload(state, 'server-time')).toEqual({
      ...state,
      updatedAt: 'server-time',
    });
  });
});
