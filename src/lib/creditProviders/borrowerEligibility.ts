import type { CredigrupoBorrowerState } from './types';

export interface BorrowerEligibilityPresentation {
  status: 'ELIGIBLE' | 'INELIGIBLE' | 'UNKNOWN';
  title: string;
  details: string[];
  canSimulate: boolean;
}

interface BorrowerEligibilityInput {
  kycStatus: CredigrupoBorrowerState['kycStatus'];
  ccbEligible?: boolean | null;
  eligibilityErrors?: string[];
}

const UNEXPLAINED_INELIGIBILITY = 'A Credigrupo retornou inelegibilidade sem detalhar o motivo.';

export const getBorrowerEligibilityPresentation = (
  borrower?: BorrowerEligibilityInput,
): BorrowerEligibilityPresentation => {
  if (borrower?.ccbEligible === true) {
    return {
      status: 'ELIGIBLE',
      title: 'Elegível para CCB',
      details: [],
      canSimulate: borrower.kycStatus === 'approved',
    };
  }

  if (borrower?.ccbEligible === false) {
    const errors = (borrower.eligibilityErrors || []).filter((message) => message.length > 0);
    return {
      status: 'INELIGIBLE',
      title: 'Não elegível para CCB',
      details: errors.length > 0 ? errors : [UNEXPLAINED_INELIGIBILITY],
      canSimulate: false,
    };
  }

  return {
    status: 'UNKNOWN',
    title: 'Elegibilidade ainda não confirmada',
    details: [],
    canSimulate: false,
  };
};
