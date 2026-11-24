import { describe, expect, it } from 'vitest';
import type { CashMovement, Loan, PaymentBreakdown } from '../../types';
import { buildRealizedIncome } from '../realizedIncome';
import { buildMonthlyCashReportData } from '../monthlyCashReportPdf';

const breakdown = (principalPaid: number, interestPaid: number, extra: Partial<PaymentBreakdown> = {}): PaymentBreakdown => ({
  principalPaid, interestPaid, lateFeePaid: 0, serviceFeePaid: 0, discountApplied: 0,
  totalPaid: principalPaid + interestPaid, ...extra,
});
const fixture = (): Loan => ({
  id: 'loan', customerId: 'customer', customerName: 'Synthetic', amount: 100, interestRate: 20,
  frequency: 'MENSAL', interestType: 'SIMPLES', startDate: '2026-10-01', status: 'ATIVO',
  installments: [{ number: 1, amount: 120, dueDate: '2026-11-01', status: 'PENDENTE' }],
});

describe('apuracao de receita compartilhada', () => {
  it('considera pagamento parcial, desconto separado e estorno assinado, sem duplicar agregado', () => {
    const loan = fixture();
    loan.installments[0].paymentEntries = [
      { id: 'pay', operationId: 'pay', kind: 'PAYMENT', recordedAt: '2026-10-31',
        ...breakdown(30, 20, { lateFeePaid: 5, serviceFeePaid: 2, discountApplied: 10, totalPaid: 57 }) },
      { id: 'reverse', operationId: 'reverse', kind: 'REVERSAL', recordedAt: '2026-11-02', ...breakdown(-10, -5) },
    ];
    loan.installments[0].paymentBreakdown = breakdown(999, 999);
    const cashMovements: CashMovement[] = [{ id: 'pay', operationId: 'pay', type: 'PAGAMENTO', amount: 57,
      date: '2026-11-01', description: 'Synthetic payment' }];
    const original = structuredClone({ loan, cashMovements });
    const result = buildRealizedIncome([loan], cashMovements);
    expect(result.monthly['2026-10']).toBeUndefined();
    expect(result.monthly['2026-11']).toEqual({ principalRecovered: 20, interestReceived: 15,
      lateFeesReceived: 5, serviceFeesReceived: 2, taxableRevenue: 22, totalPaid: 42 });
    const pdf = buildMonthlyCashReportData({ year: 2026, month: 11, loans: [loan], cashMovements, monthlySnapshots: [] });
    expect(pdf.realizedFinancialRevenue).toBe(result.monthly['2026-11'].taxableRevenue);
    expect(pdf.principalRecovered).toBe(result.monthly['2026-11'].principalRecovered);
    expect({ loan, cashMovements }).toEqual(original);
  });

  it('inclui legado quitado e historico de contrato cancelado, sem reconhecer receita futura', () => {
    const loan = fixture(); loan.status = 'CANCELADO';
    loan.installments[0].status = 'PAGO';
    loan.installments[0].paidAt = '2026-11-01';
    loan.installments[0].paymentBreakdown = breakdown(100, 20);
    const unpaid = fixture(); unpaid.installments[0].paymentBreakdown = breakdown(100, 20);
    expect(buildRealizedIncome([loan, unpaid], []).totals.taxableRevenue).toBe(20);
  });

  it('preserva renovacoes e pagamentos fiscais sem tratar desconto como dinheiro', () => {
    const loan = fixture();
    loan.renewalHistory = [{ paymentDate: '2026-11-01', interestPaid: 15, lateFeePaid: 3, amount: 100,
      totalPaid: 18 }] as Loan['renewalHistory'];
    loan.fiscalPaymentEntries = [{ id: 'fiscal', kind: 'PAYMENT', recordedAt: '2026-11-02',
      ...breakdown(10, 5, { discountApplied: 2 }) }];
    expect(buildRealizedIncome([loan], []).totals).toMatchObject({
      principalRecovered: 10, interestReceived: 20, lateFeesReceived: 3, taxableRevenue: 23, totalPaid: 33,
    });
  });

  it('sinaliza receitas sem data sem atribuir a um mes inventado', () => {
    const loan = fixture();
    loan.fiscalPaymentEntries = [{ id: 'undated', kind: 'PAYMENT', recordedAt: 'invalido', ...breakdown(100, 20) }];
    expect(buildRealizedIncome([loan], [])).toMatchObject({ undatedEntries: 1, monthly: {}, totals: { taxableRevenue: 0 } });
  });
});
