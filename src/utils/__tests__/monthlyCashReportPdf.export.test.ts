import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CashMovement, Loan, MonthlySnapshot } from '../../types';
import { generateMonthlyCashReportPdf } from '../monthlyCashReportPdf';

const { table, save } = vi.hoisted(() => ({ table: vi.fn(), save: vi.fn() }));

vi.mock('jspdf-autotable', () => ({ default: table }));
vi.mock('jspdf', () => ({
  jsPDF: class {
    internal = { pageSize: { getWidth: () => 297, getHeight: () => 210 } };
    setProperties() {}
    setFillColor() {}
    roundedRect() {}
    setFont() {}
    setFontSize() {}
    setTextColor() {}
    text() {}
    getNumberOfPages() { return 1; }
    setPage() {}
    save = save;
  },
}));

const fixture = () => ({
  year: 2026,
  month: 11,
  generatedAt: new Date(2026, 10, 20, 12),
  loans: [{
    id: 'synthetic-loan',
    installments: [{
      paymentEntries: [
        { recordedAt: '2026-11-10', principalPaid: 100, interestPaid: 20, lateFeePaid: 5, serviceFeePaid: 2 },
        { recordedAt: '2026-10-10', principalPaid: 80, interestPaid: 10 },
      ],
    }],
  } as unknown as Loan],
  cashMovements: [
    { id: 'payment', type: 'PAGAMENTO', amount: 127, date: '2026-11-10', description: 'Synthetic payment' },
    { id: 'expense', type: 'SAIDA', amount: 15, date: '2026-11-11', description: 'Synthetic expense', category: 'DESPESA_OPERACIONAL' },
    { id: 'funding', type: 'SAIDA', amount: 4, date: '2026-11-12', description: 'Synthetic funding', category: 'CUSTO_CAPTACAO' },
  ] as CashMovement[],
  monthlySnapshots: [] as MonthlySnapshot[],
});

describe('generateMonthlyCashReportPdf', () => {
  beforeEach(() => vi.clearAllMocks());

  it('inclui os pagamentos dos contratos no PDF de mes sem fechamento', async () => {
    const input = fixture();
    const original = structuredClone(input);
    await generateMonthlyCashReportPdf(input);

    const rows = table.mock.calls[0][1].body;
    expect(rows).toEqual(expect.arrayContaining([
      ['Entradas registradas', 'R$ 127,00'],
      ['Saidas registradas', 'R$ 19,00'],
      ['Principal recuperado (nao e lucro)', 'R$ 100,00'],
      ['Receita financeira realizada', 'R$ 27,00'],
      ['Despesas operacionais', 'R$ 15,00'],
      ['Lucro operacional', 'R$ 12,00'],
      ['Custo de captacao', 'R$ 4,00'],
      ['Lucro liquido realizado', 'R$ 8,00'],
      ['Fechamento mensal', 'Nao registrado'],
    ]));
    expect(save).toHaveBeenCalledWith('relatorio-caixa-2026-11.pdf');
    expect(input).toEqual(original);
  });

  it('preserva os resultados do fechamento salvo mesmo com contratos disponiveis', async () => {
    const input = fixture();
    input.monthlySnapshots.push({
      month: '2026-11', status: 'CLOSED', openingCash: 0, closingCash: 110,
      totalIncome: 130, totalExpense: 20, principalReceived: 90,
      interestReceived: 30, lateFeesReceived: 8, serviceFeesReceived: 2,
      realProfit: 40, financialRevenue: 40, operatingExpenses: 12,
      fundingCost: 3, netProfit: 25, lentAmount: 0, roi: 0,
      movementCount: 3, createdLoansCount: 0,
    });
    const original = structuredClone(input);
    await generateMonthlyCashReportPdf(input);

    expect(table.mock.calls[0][1].body).toEqual(expect.arrayContaining([
      ['Principal recuperado (nao e lucro)', 'R$ 90,00'],
      ['Receita financeira realizada', 'R$ 40,00'],
      ['Lucro operacional', 'R$ 28,00'],
      ['Lucro liquido realizado', 'R$ 25,00'],
      ['Saldo final do fechamento registrado', 'R$ 110,00'],
    ]));
    expect(input).toEqual(original);
  });
});
