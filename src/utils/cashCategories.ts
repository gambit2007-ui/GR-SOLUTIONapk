import type { CashMovement, CashOutflowCategory } from '../types';

export const CASH_OUTFLOW_CATEGORY_OPTIONS: ReadonlyArray<{
  value: CashOutflowCategory;
  label: string;
}> = [
  { value: 'DEVOLUCAO_APORTE', label: 'Devolução de aporte' },
  { value: 'PAGAMENTO_EMPRESTIMO_EXTERNO', label: 'Pagamento de empréstimo externo' },
  { value: 'REPASSE_INVESTIDOR_PARCEIRO', label: 'Repasse para investidor/parceiro' },
  { value: 'PRO_LABORE', label: 'Pró-labore' },
  { value: 'DESPESA_OPERACIONAL', label: 'Despesa operacional' },
  { value: 'IMPOSTO_MEI', label: 'Imposto/MEI' },
  { value: 'MARKETING', label: 'Marketing' },
  { value: 'COMISSAO', label: 'Comissão' },
  { value: 'REINVESTIMENTO', label: 'Reinvestimento' },
];

export type CashOutflowReportCategory = CashOutflowCategory | 'SEM_CATEGORIA';

export const CASH_OUTFLOW_REPORT_CATEGORY_OPTIONS: ReadonlyArray<{
  value: CashOutflowReportCategory;
  label: string;
}> = [
  ...CASH_OUTFLOW_CATEGORY_OPTIONS,
  { value: 'SEM_CATEGORIA', label: 'Sem categoria' },
];

export const CASH_OUTFLOW_CATEGORY_LABELS: Record<CashOutflowReportCategory, string> =
  CASH_OUTFLOW_REPORT_CATEGORY_OPTIONS.reduce(
    (labels, option) => ({
      ...labels,
      [option.value]: option.label,
    }),
    {} as Record<CashOutflowReportCategory, string>,
  );

const CASH_OUTFLOW_CATEGORY_VALUES = new Set<CashOutflowCategory>(
  CASH_OUTFLOW_CATEGORY_OPTIONS.map((option) => option.value),
);

export const parseCashOutflowCategory = (value: unknown): CashOutflowCategory | undefined => {
  const normalized = String(value ?? '').trim().toUpperCase() as CashOutflowCategory;
  return CASH_OUTFLOW_CATEGORY_VALUES.has(normalized) ? normalized : undefined;
};

export const resolveCashOutflowCategory = (movement: CashMovement): CashOutflowReportCategory => {
  const parsedCategory = parseCashOutflowCategory(movement.category);
  if (parsedCategory) return parsedCategory;

  const movementType = String(movement.type || '').trim().toUpperCase();
  if (movementType === 'SAIDA' || movementType === 'RETIRADA') {
    return 'DESPESA_OPERACIONAL';
  }

  return 'SEM_CATEGORIA';
};
