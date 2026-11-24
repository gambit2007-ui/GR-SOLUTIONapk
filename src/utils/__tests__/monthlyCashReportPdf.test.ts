import { describe, expect, it } from 'vitest';
import type { CashMovement } from '../../types';
import type { Loan } from '../../types';
import { buildMonthlyCashReportData } from '../monthlyCashReportPdf';

const movement = (id: string, type: CashMovement['type'], amount: number, date: string): CashMovement => ({
  id,
  type,
  amount,
  date,
  description: id,
});

describe('buildMonthlyCashReportData', () => {
  it('mantem receitas, despesas e caixa no primeiro dia do mes correto', () => {
    const loan = {
      id: 'loan-first-day', installments: [{
        status: 'PAID', paidAt: '2026-11-01',
        paymentBreakdown: { principalPaid: 100, interestPaid: 20, lateFeePaid: 0, serviceFeePaid: 0 },
      }], renewalHistory: [], fiscalPaymentEntries: [],
    } as unknown as Loan;
    const input = {
      year: 2026, loans: [loan], monthlySnapshots: [],
      cashMovements: [
        movement('prior', 'APORTE', 1000, '2026-10-31'),
        movement('payment', 'PAGAMENTO', 120, '2026-11-01'),
        { ...movement('expense', 'SAIDA', 5, '2026-11-01'), category: 'DESPESA_OPERACIONAL' as const },
      ],
    };
    const before = structuredClone(input);
    const november = buildMonthlyCashReportData({ ...input, month: 11 });
    const october = buildMonthlyCashReportData({ ...input, month: 10 });
    expect(november).toMatchObject({ openingCash: 1000, closingCash: 1115, principalRecovered: 100,
      realizedFinancialRevenue: 20, operatingExpenses: 5, netProfit: 15 });
    expect(october).toMatchObject({ closingCash: 1000, realizedFinancialRevenue: 0, operatingExpenses: 0 });
    expect(input).toEqual(before);
  });

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

  it('mantem estornos e movimentos negativos no calculo assinado do caixa', () => {
    const report = buildMonthlyCashReportData({
      year: 2026,
      month: 10,
      cashMovements: [
        movement('aporte', 'APORTE', 500, '2026-10-01'),
        movement('legado', 'PAGAMENTO', -100, '2026-10-02'),
        movement('estorno', 'ESTORNO', 75, '2026-10-03'),
      ],
      monthlySnapshots: [],
    });

    expect(report.totalEntries).toBe(500);
    expect(report.totalExits).toBe(175);
    expect(report.closingCash).toBe(325);
  });

  it('separa principal recuperado, receita financeira e despesas operacionais', () => {
    const loan = {
      id: 'loan-1',
      installments: [{
        status: 'PAID',
        paidAt: '2026-10-08',
        paymentBreakdown: {
          principalPaid: 100,
          interestPaid: 20,
          lateFeePaid: 5,
          serviceFeePaid: 2,
        },
      }],
      renewalHistory: [],
      fiscalPaymentEntries: [],
    } as unknown as Loan;
    const report = buildMonthlyCashReportData({
      year: 2026,
      month: 10,
      loans: [loan],
      cashMovements: [
        { ...movement('despesa', 'SAIDA', 15, '2026-10-09'), category: 'DESPESA_OPERACIONAL' },
        { ...movement('repasse', 'RETIRADA', 50, '2026-10-10'), category: 'REPASSE_INVESTIDOR_PARCEIRO' },
        { ...movement('captacao', 'SAIDA', 4, '2026-10-11'), category: 'CUSTO_CAPTACAO' },
      ],
      monthlySnapshots: [],
    });

    expect(report.principalRecovered).toBe(100);
    expect(report.realizedFinancialRevenue).toBe(27);
    expect(report.operatingExpenses).toBe(15);
    expect(report.operatingResult).toBe(12);
    expect(report.fundingCost).toBe(4);
    expect(report.netProfit).toBe(8);
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
