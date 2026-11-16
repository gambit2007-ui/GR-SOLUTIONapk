import { describe, expect, it } from 'vitest';
import {
  CASH_OUTFLOW_CATEGORY_LABELS,
  CASH_OUTFLOW_CATEGORY_OPTIONS,
  parseCashInflowCategory,
  parseCashOutflowCategory,
  resolveCashInflowCategory,
} from '../cashCategories';
import type { CashMovement } from '../../types';

const movement = (overrides: Partial<CashMovement>): CashMovement => ({
  id: 'movement-1',
  type: 'ENTRADA',
  amount: 100,
  description: 'Teste',
  date: '2026-11-16T12:00:00.000Z',
  ...overrides,
});

describe('categorias do caixa', () => {
  it('aceita as novas categorias de entrada', () => {
    expect(parseCashInflowCategory('APORTE_PROPRIO')).toBe('APORTE_PROPRIO');
    expect(parseCashInflowCategory('REEMBOLSO')).toBe('REEMBOLSO');
  });

  it('mantem imposto MEI somente para leitura do historico', () => {
    expect(parseCashOutflowCategory('IMPOSTO_MEI')).toBe('IMPOSTO_MEI');
    expect(CASH_OUTFLOW_CATEGORY_LABELS.IMPOSTO_MEI).toBe('DAS (registros anteriores)');
    expect(CASH_OUTFLOW_CATEGORY_OPTIONS.some((option) => option.value === 'IMPOSTO_MEI')).toBe(false);
  });

  it('separa recebimento de contrato de entrada manual', () => {
    expect(resolveCashInflowCategory(movement({ loanId: 'loan-1', type: 'PAGAMENTO' })))
      .toBe('RECEBIMENTO_CONTRATO');
    expect(resolveCashInflowCategory(movement({ category: 'OUTRAS_ENTRADAS' })))
      .toBe('OUTRAS_ENTRADAS');
  });
});
