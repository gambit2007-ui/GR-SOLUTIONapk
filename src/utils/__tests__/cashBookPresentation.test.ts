import { describe, expect, it } from 'vitest';
import type { CashMovement } from '../../types';
import { getReversedCashMovementIds, groupCashBookMonthMovements } from '../cashBookPresentation';
import { parseCashMovement, resolveCashDelta } from '../domainParsers';

const movement = (id: string, type: CashMovement['type'], amount: number): CashMovement => ({
  id,
  type,
  amount,
  description: id,
  date: '2026-10-02T17:00:00.000Z',
});

describe('Livro Caixa: apresentação de estornos', () => {
  it('retira da lista de entradas o recebimento anulado e exibe o par na auditoria', () => {
    const original = movement('renovacao-ana', 'PAGAMENTO', 150);
    const reversal = parseCashMovement('estorno-ana', {
      type: 'ESTORNO',
      amount: 150,
      date: '2026-10-02T18:00:00.000Z',
      reversalOfMovementId: original.id,
    });
    const otherPayment = movement('outro-pagamento', 'PAGAMENTO', 100);
    const expense = movement('despesa', 'SAIDA', 30);
    const all = [original, reversal, otherPayment, expense];

    expect(reversal.reversalOfMovementId).toBe(original.id);
    const reversedIds = getReversedCashMovementIds(all);
    const sections = groupCashBookMonthMovements(all, reversedIds);

    expect(sections.entryMovements.map((item) => item.id)).toEqual(['outro-pagamento']);
    expect(sections.exitMovements.map((item) => item.id)).toEqual(['despesa']);
    expect(sections.reversalMovements.map((item) => item.id)).toEqual(['renovacao-ana', 'estorno-ana']);
    expect(sections.reversalMovements.reduce((sum, item) => sum + resolveCashDelta(item), 0)).toBe(0);
  });

  it('mantém os dois movimentos auditáveis quando o estorno ocorre em outro mês', () => {
    const original = movement('pagamento-antigo', 'PAGAMENTO', 50);
    const reversal: CashMovement = {
      ...movement('estorno-atual', 'ESTORNO', 50),
      reversalOfMovementId: original.id,
    };
    const reversedIds = getReversedCashMovementIds([original, reversal]);

    expect(groupCashBookMonthMovements([original], reversedIds).reversalMovements).toEqual([original]);
    expect(groupCashBookMonthMovements([reversal], reversedIds).reversalMovements).toEqual([reversal]);
  });

  it('não marca entradas sem vínculo de estorno como anuladas', () => {
    const payment = movement('pagamento', 'PAGAMENTO', 70);
    const legacyReversal = movement('estorno-legado', 'ESTORNO', 20);
    const reversedIds = getReversedCashMovementIds([payment, legacyReversal]);
    const sections = groupCashBookMonthMovements([payment, legacyReversal], reversedIds);

    expect(sections.entryMovements).toEqual([payment]);
    expect(sections.reversalMovements).toEqual([legacyReversal]);
  });

  it('também agrupa uma entrada compensatória vinculada a uma saída original', () => {
    const original = movement('saida-indevida', 'SAIDA', 971);
    const compensation: CashMovement = {
      ...movement('entrada-compensatoria', 'ENTRADA', 971),
      reversalOfMovementId: original.id,
    };
    const all = [original, compensation];
    const sections = groupCashBookMonthMovements(all, getReversedCashMovementIds(all));

    expect(sections.entryMovements).toEqual([]);
    expect(sections.exitMovements).toEqual([]);
    expect(sections.reversalMovements).toEqual(all);
    expect(all.reduce((sum, item) => sum + resolveCashDelta(item), 0)).toBe(0);
  });
});
