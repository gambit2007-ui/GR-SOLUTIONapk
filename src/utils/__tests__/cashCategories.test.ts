import { describe, expect, it } from 'vitest';
import { isOperatingExpenseMovement, sumOperatingExpensesByCategory } from '../cashCategories';
import type { CashMovement } from '../../types';

const movement = (category: CashMovement['category'], type: CashMovement['type'] = 'SAIDA'): CashMovement => ({
  type, category, amount: 500, description: 'Teste', date: '2026-09-01',
});

describe('classificacao gerencial das saidas', () => {
  it('mantem pagamento ao investidor externo no caixa, mas fora da despesa', () => {
    expect(isOperatingExpenseMovement(movement('PAGAMENTO_EMPRESTIMO_EXTERNO'))).toBe(false);
  });

  it('nao confunde pagamento externo com repasse a parceiro', () => {
    expect(isOperatingExpenseMovement(movement('REPASSE_INVESTIDOR_PARCEIRO'))).toBe(true);
  });

  it('exclui devolucao de aporte e desembolso de emprestimo', () => {
    expect(isOperatingExpenseMovement(movement('DEVOLUCAO_APORTE'))).toBe(false);
    expect(isOperatingExpenseMovement({ ...movement(undefined, 'RETIRADA'), loanId: 'L1', description: 'EMPRESTIMO: Teste' })).toBe(false);
  });

  it('inclui demais saidas operacionais e nao inclui entradas', () => {
    expect(isOperatingExpenseMovement(movement('DESPESA_OPERACIONAL'))).toBe(true);
    expect(isOperatingExpenseMovement(movement(undefined))).toBe(true);
    expect(isOperatingExpenseMovement(movement(undefined, 'APORTE'))).toBe(false);
  });

  it('separa despesa de saida no fechamento mensal', () => {
    expect(sumOperatingExpensesByCategory({
      EMPRESTIMO: 5000,
      PAGAMENTO_EMPRESTIMO_EXTERNO: 1000,
      DEVOLUCAO_APORTE: 200,
      DESPESA_OPERACIONAL: 300,
      REPASSE_INVESTIDOR_PARCEIRO: 50,
    })).toBe(350);
  });
});
