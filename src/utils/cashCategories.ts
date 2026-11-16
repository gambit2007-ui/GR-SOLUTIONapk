import type { CashInflowCategory, CashMovement, CashOutflowCategory } from '../types';

export const CASH_OUTFLOW_CATEGORY_OPTIONS: ReadonlyArray<{
  value: CashOutflowCategory;
  label: string;
}> = [
  { value: 'DEVOLUCAO_APORTE', label: 'Devolução de aporte' },
  { value: 'PAGAMENTO_EMPRESTIMO_EXTERNO', label: 'Pagamento de empréstimo externo' },
  { value: 'REPASSE_INVESTIDOR_PARCEIRO', label: 'Repasse para investidor/parceiro' },
  { value: 'PRO_LABORE', label: 'Pró-labore' },
  { value: 'DESPESA_OPERACIONAL', label: 'Despesa operacional' },
  { value: 'DAS', label: 'DAS' },
  { value: 'DESPESA_CONTABIL', label: 'Despesas contábeis' },
  { value: 'MARKETING', label: 'Marketing' },
  { value: 'COMISSAO', label: 'Comissão' },
  { value: 'REINVESTIMENTO', label: 'Reinvestimento' },
];

export const CASH_INFLOW_CATEGORY_OPTIONS: ReadonlyArray<{
  value: CashInflowCategory;
  label: string;
}> = [
  { value: 'APORTE_PROPRIO', label: 'Aporte próprio' },
  { value: 'APORTE_INVESTIDOR_PARCEIRO', label: 'Aporte de investidor/parceiro' },
  { value: 'RECEITA_SERVICO', label: 'Receita de serviço' },
  { value: 'REEMBOLSO', label: 'Reembolso' },
  { value: 'OUTRAS_ENTRADAS', label: 'Outras entradas' },
];

export type CashInflowReportCategory = CashInflowCategory | 'RECEBIMENTO_CONTRATO' | 'APORTE_LEGADO' | 'SEM_CATEGORIA';

export const CASH_INFLOW_CATEGORY_LABELS: Record<CashInflowReportCategory, string> = {
  APORTE_PROPRIO: 'Aporte próprio',
  APORTE_INVESTIDOR_PARCEIRO: 'Aporte de investidor/parceiro',
  RECEITA_SERVICO: 'Receita de serviço',
  REEMBOLSO: 'Reembolso',
  OUTRAS_ENTRADAS: 'Outras entradas',
  RECEBIMENTO_CONTRATO: 'Recebimento de contrato',
  APORTE_LEGADO: 'Aporte sem categoria (registro anterior)',
  SEM_CATEGORIA: 'Sem categoria',
};

export type CashOutflowReportCategory = CashOutflowCategory | 'EMPRESTIMO' | 'SEM_CATEGORIA';

export const CASH_OUTFLOW_REPORT_CATEGORY_OPTIONS: ReadonlyArray<{
  value: CashOutflowReportCategory;
  label: string;
}> = [
  { value: 'EMPRESTIMO', label: 'Emprestimos' },
  ...CASH_OUTFLOW_CATEGORY_OPTIONS,
  { value: 'IMPOSTO_MEI', label: 'DAS (registros anteriores)' },
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

const CASH_OUTFLOW_CATEGORY_VALUES = new Set<CashOutflowCategory>([
  ...CASH_OUTFLOW_CATEGORY_OPTIONS.map((option) => option.value),
  'IMPOSTO_MEI',
]);

export const parseCashOutflowCategory = (value: unknown): CashOutflowCategory | undefined => {
  const normalized = String(value ?? '').trim().toUpperCase() as CashOutflowCategory;
  return CASH_OUTFLOW_CATEGORY_VALUES.has(normalized) ? normalized : undefined;
};

const CASH_INFLOW_CATEGORY_VALUES = new Set<CashInflowCategory>(
  CASH_INFLOW_CATEGORY_OPTIONS.map((option) => option.value),
);

export const parseCashInflowCategory = (value: unknown): CashInflowCategory | undefined => {
  const normalized = String(value ?? '').trim().toUpperCase() as CashInflowCategory;
  return CASH_INFLOW_CATEGORY_VALUES.has(normalized) ? normalized : undefined;
};

const normalizeSearchText = (value: unknown) =>
  String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase();

export const isLoanCashOutflowMovement = (movement: CashMovement): boolean => {
  const movementType = String(movement.type || '').trim().toUpperCase();
  if (movementType !== 'RETIRADA') return false;

  const description = normalizeSearchText(movement.description);
  return Boolean(movement.loanId) || description.includes('EMPRESTIMO');
};

export const resolveCashOutflowCategory = (movement: CashMovement): CashOutflowReportCategory => {
  if (isLoanCashOutflowMovement(movement)) return 'EMPRESTIMO';

  const parsedCategory = parseCashOutflowCategory(movement.category);
  if (parsedCategory) return parsedCategory;

  const movementType = String(movement.type || '').trim().toUpperCase();
  if (movementType === 'SAIDA' || movementType === 'RETIRADA') {
    return 'DESPESA_OPERACIONAL';
  }

  return 'SEM_CATEGORIA';
};
export const resolveCashInflowCategory = (movement: CashMovement): CashInflowReportCategory => {
  const type = String(movement.type || '').trim().toUpperCase();
  if (type === 'PAGAMENTO' && movement.loanId) return 'RECEBIMENTO_CONTRATO';

  const parsedCategory = parseCashInflowCategory(movement.category);
  if (parsedCategory) return parsedCategory;

  if (type === 'APORTE') return 'APORTE_LEGADO';
  return 'SEM_CATEGORIA';
};
