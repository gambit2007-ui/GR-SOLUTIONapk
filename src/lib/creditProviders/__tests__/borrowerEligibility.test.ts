import { describe, expect, it } from 'vitest';
import { getBorrowerEligibilityPresentation } from '../borrowerEligibility';

describe('apresentacao da elegibilidade CCB', () => {
  it('libera simulacao somente quando KYC e elegibilidade estao aprovados', () => {
    const eligible = getBorrowerEligibilityPresentation({
      kycStatus: 'approved',
      ccbEligible: true,
      eligibilityErrors: [],
    });
    const pendingKyc = getBorrowerEligibilityPresentation({
      kycStatus: 'pending_kyc',
      ccbEligible: true,
      eligibilityErrors: [],
    });

    expect(eligible).toMatchObject({
      status: 'ELIGIBLE',
      title: 'Elegível para CCB',
      canSimulate: true,
    });
    expect(pendingKyc.canSimulate).toBe(false);
  });

  it('mostra exatamente os motivos retornados quando inelegivel', () => {
    expect(getBorrowerEligibilityPresentation({
      kycStatus: 'approved',
      ccbEligible: false,
      eligibilityErrors: ['CPF invalido', 'Data de nascimento invalida'],
    })).toEqual({
      status: 'INELIGIBLE',
      title: 'Não elegível para CCB',
      details: ['CPF invalido', 'Data de nascimento invalida'],
      canSimulate: false,
    });
  });

  it('explica inelegibilidade sem motivos sem inventar causa', () => {
    expect(getBorrowerEligibilityPresentation({
      kycStatus: 'approved',
      ccbEligible: false,
      eligibilityErrors: [],
    }).details).toEqual(['A Credigrupo retornou inelegibilidade sem detalhar o motivo.']);
  });

  it.each([undefined, null])('mantem %s como elegibilidade ainda nao confirmada', (ccbEligible) => {
    expect(getBorrowerEligibilityPresentation({
      kycStatus: 'approved',
      ccbEligible,
      eligibilityErrors: [],
    })).toEqual({
      status: 'UNKNOWN',
      title: 'Elegibilidade ainda não confirmada',
      details: [],
      canSimulate: false,
    });
  });
});
