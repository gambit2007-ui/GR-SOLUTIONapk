import { describe, expect, it } from 'vitest';
import type { CashMovement } from '../../types';
import { buildMonthlyCashReportData } from '../monthlyCashReportPdf';

const movement = (
  id: string,
  type: CashMovement['type'],
  amount: number,
  date: string,
): CashMovement => ({ id, type, amount, date, description: id });

describe('buildMonthlyCashReportData', () => {
  it('restringe a conferencia ao mes selecionado e conserva o saldo acumulado anterior', () => {
    const report = buildMonthlyCashReportData({
      year: 2026,
      month: 10,
      cashMovements: [
        movement('aporte-setembro', 'APORTE', 1000, '2026-09-30'),
        movement('pagamento-outubro', 'PAGAMENTO', 300, '2026-10-02'),
        movement('saida-outubro', 'SAIDA', 120, '2026-10-15'),
        movement('pagamento-novembro', 'PAGAMENTO', 400, '2026-11-01'),
      ],
      monthlySnapshots: [],
    });

    expect(report.periodKey).toBe('2026-10');
    expect(report.openingCash).toBe(1000);
    expect(report.totalEntries).toBe(300);
    expect(report.totalExits).toBe(120);
    expect(report.netChange).toBe(180);
    expect(report.closingCash).toBe(1180);
    expect(report.rows.map((row) => row.movement.id)).toEqual(['pagamento-outubro', 'saida-outubro']);
  });

  it('mantem estornos e movimentos legados negativos no calculo assinado do caixa', () => {
    const report = buildMonthlyCashReportData({
      year: 2026,
      month: 10,
      cashMovements: [
        movement('aporte', 'APORTE', 500, '2026-10-01'),
        movement('legado', 'PAGAMENTO', -100, '2026-10-02'),
        movement('estorno', 'ESTORNO', 75, '2026-10-03'),
      ],
      monthlySnapshots: [{
        month: '2026-10', openingCash: 0, closingCash: 325, totalIncome: 500, totalExpense: 175,
        principalReceived: 0, interestReceived: 0, lateFeesReceived: 0, serviceFeesReceived: 0,
        realProfit: 0, lentAmount: 0, roi: 0, movementCount: 3, createdLoansCount: 0,
      }],
    });

    expect(report.totalEntries).toBe(500);
    expect(report.totalExits).toBe(175);
    expect(report.closingCash).toBe(325);
    expect(report.closedSnapshot?.month).toBe('2026-10');
  });

  it('rejeita um mes invalido sem gerar relatorio', () => {
    expect(() => buildMonthlyCashReportData({
      year: 2026,
      month: 13,
      cashMovements: [],
      monthlySnapshots: [],
    })).toThrow('MES_DE_RELATORIO_INVALIDO');
  });
});
