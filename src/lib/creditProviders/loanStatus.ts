import type { CredigrupoLoanStatus } from './types';

export const CREDIGRUPO_LOAN_STATUSES: readonly CredigrupoLoanStatus[] = [
  'proposed',
  'accepted',
  'rejected',
  'completed',
  'funded',
];

export const CREDIGRUPO_FORMALIZATION_STATUSES = [
  'awaiting_lender_payment',
  'lender_paid',
  'generating_ccb',
  'ccb_uploaded',
  'completed',
  'funded',
  'cancelled',
] as const;

export type CredigrupoFormalizationStatus = typeof CREDIGRUPO_FORMALIZATION_STATUSES[number];

export const isCredigrupoLoanStatus = (value: unknown): value is CredigrupoLoanStatus =>
  CREDIGRUPO_LOAN_STATUSES.includes(String(value || '').trim() as CredigrupoLoanStatus);

export const isCredigrupoFormalizationStatus = (value: unknown): value is CredigrupoFormalizationStatus =>
  CREDIGRUPO_FORMALIZATION_STATUSES.includes(
    String(value || '').trim() as CredigrupoFormalizationStatus,
  );

export const isKnownCredigrupoProviderStatus = (value: unknown): boolean =>
  isCredigrupoLoanStatus(value) || isCredigrupoFormalizationStatus(value);

export const isCredigrupoLoanCancelable = (status: unknown): boolean =>
  status === 'proposed' || status === 'accepted';

export const formatCredigrupoFormalizationStatus = (value: unknown): string => {
  const status = String(value || '').trim().toLowerCase();
  const labels: Record<string, string> = {
    proposed: 'Proposta criada',
    accepted: 'Proposta aceita',
    awaiting_lender_payment: 'Aguardando pagamento do investidor',
    lender_paid: 'Pagamento do investidor confirmado',
    generating_ccb: 'Gerando CCB',
    ccb_uploaded: 'CCB gerada',
    pending_signature: 'Aguardando assinatura',
    pending_signatures: 'Aguardando assinaturas',
    ccb_ready_for_signature: 'CCB pronta para assinatura',
    signed: 'Assinatura concluida',
    completed: 'Formalizacao concluida',
    funded: 'Liquidado',
    rejected: 'Rejeitado',
  };
  return labels[status] || status.replaceAll('_', ' ') || 'Nao informado';
};
