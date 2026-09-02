import { describe, expect, it } from 'vitest';
import {
  formatCredigrupoFormalizationStatus,
  isCredigrupoFormalizationStatus,
  isKnownCredigrupoProviderStatus,
  isCredigrupoLoanCancelable,
  isCredigrupoLoanStatus,
} from '../loanStatus';

describe('status oficial de emprestimos Credigrupo', () => {
  it('aceita somente os cinco macrostatus oficiais', () => {
    expect(isCredigrupoLoanStatus('proposed')).toBe(true);
    expect(isCredigrupoLoanStatus('accepted')).toBe(true);
    expect(isCredigrupoLoanStatus('rejected')).toBe(true);
    expect(isCredigrupoLoanStatus('completed')).toBe(true);
    expect(isCredigrupoLoanStatus('funded')).toBe(true);
    expect(isCredigrupoLoanStatus('awaiting_signature')).toBe(false);
    expect(isCredigrupoLoanStatus('AWAITING_SIGNATURE')).toBe(false);
  });

  it('permite cancelamento remoto somente em proposed ou accepted', () => {
    expect(isCredigrupoLoanCancelable('proposed')).toBe(true);
    expect(isCredigrupoLoanCancelable('accepted')).toBe(true);
    expect(isCredigrupoLoanCancelable('completed')).toBe(false);
    expect(isCredigrupoLoanCancelable('funded')).toBe(false);
    expect(isCredigrupoLoanCancelable('rejected')).toBe(false);
  });

  it('reconhece os status granulares atuais sem mistura-los aos macrostatus', () => {
    expect(isCredigrupoFormalizationStatus('awaiting_lender_payment')).toBe(true);
    expect(isCredigrupoFormalizationStatus('lender_paid')).toBe(true);
    expect(isCredigrupoFormalizationStatus('generating_ccb')).toBe(true);
    expect(isCredigrupoFormalizationStatus('ccb_uploaded')).toBe(true);
    expect(isKnownCredigrupoProviderStatus('awaiting_lender_payment')).toBe(true);
    expect(isCredigrupoLoanStatus('awaiting_lender_payment')).toBe(false);
    expect(isKnownCredigrupoProviderStatus('future_status')).toBe(false);
  });

  it('traduz formalization_status sem confundir com macrostatus', () => {
    expect(formatCredigrupoFormalizationStatus('pending_signatures')).toBe('Aguardando assinaturas');
    expect(formatCredigrupoFormalizationStatus('awaiting_lender_payment')).toBe('Aguardando pagamento do investidor');
    expect(formatCredigrupoFormalizationStatus('custom_provider_step')).toBe('custom provider step');
  });
});
