import type { CashMovement, Customer, Installment, Loan, PaymentBreakdown } from '../types';
import {
  effectiveLoanStatus,
  installmentAmount,
  installmentPaidAmount,
  loanInstallmentsCount,
  normalizeInstallmentStatus,
} from './loanCompat';
import { calculateInstallmentLateFee } from './lateFee';
import { calculatePortfolioRoi } from './portfolioRoi';
import { resolveCashDelta } from './domainParsers';
import { CASH_OUTFLOW_CATEGORY_LABELS, parseCashOutflowCategory } from './cashCategories';

interface AnnualCashReportParams {
  year: number;
  caixa: number;
  loans: Loan[];
  cashMovements: CashMovement[];
  customers: Customer[];
  dailyLateFeeRate?: number;
  generatedAt?: Date;
}

interface PaymentMetrics {
  principalRecovered: number;
  totalReceived: number;
  realRevenue: number;
}

interface MonthSummary extends PaymentMetrics {
  monthIndex: number;
  monthLabel: string;
  capitalBorrowed: number;
  projectedProfit: number;
  outflows: number;
  result: number;
  overdueAmount: number;
  closingCash: number;
  contractsCount: number;
}

type AutoTableFn = (
  doc: unknown,
  options: Record<string, unknown>,
) => void;

const monthNames = [
  'Janeiro',
  'Fevereiro',
  'Marco',
  'Abril',
  'Maio',
  'Junho',
  'Julho',
  'Agosto',
  'Setembro',
  'Outubro',
  'Novembro',
  'Dezembro',
];

const colors = {
  ink: [38, 23, 14] as [number, number, number],
  gold: [214, 177, 90] as [number, number, number],
  headerGold: [245, 222, 176] as [number, number, number],
  rowAlt: [249, 246, 241] as [number, number, number],
  border: [205, 199, 190] as [number, number, number],
  white: [255, 255, 255] as [number, number, number],
  text: [35, 28, 23] as [number, number, number],
};

const roundMoney = (value: number) => Number((Number.isFinite(value) ? value : 0).toFixed(2));

const formatCurrency = (value: number, withSign = false) => {
  const rounded = roundMoney(value);
  const absValue = Math.abs(rounded);
  const formatted = absValue.toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

  if (!withSign) {
    return `${rounded < 0 ? '-' : ''}R$ ${formatted}`;
  }

  return `${rounded >= 0 ? '+' : '-'}R$ ${formatted}`;
};

const formatPercentage = (value: number) =>
  `${Number(value || 0).toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}%`;

const formatDate = (date: Date) =>
  date.toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });

const formatDateTime = (date: Date) =>
  `${formatDate(date)}, ${date.toLocaleTimeString('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })}`;

const toDate = (value: unknown): Date | null => {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === 'number') {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  if (typeof value === 'object' && typeof (value as { toDate?: unknown }).toDate === 'function') {
    const parsed = (value as { toDate: () => Date }).toDate();
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const getLoanCreatedDate = (loan: Loan): Date | null =>
  toDate(loan.createdAt) || toDate(`${loan.startDate}T12:00:00`);

const makeMonthKey = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;

const makeMonthKeyFromValue = (value: unknown): string | null => {
  const date = toDate(value);
  return date ? makeMonthKey(date) : null;
};

const getMonthRange = (year: number, monthIndex: number) => ({
  start: new Date(year, monthIndex, 1).getTime(),
  end: new Date(year, monthIndex + 1, 1).getTime(),
});

const getLoanExpectedTotal = (loan: Loan) => {
  const installmentsTotal = (Array.isArray(loan.installments) ? loan.installments : []).reduce(
    (sum, installment) => sum + installmentAmount(installment),
    0,
  );
  if (installmentsTotal > 0) return roundMoney(installmentsTotal);

  const totalToReturn = Number(loan.totalToReturn || 0);
  if (Number.isFinite(totalToReturn) && totalToReturn > 0) return roundMoney(totalToReturn);

  return roundMoney(Number(loan.amount || 0) * (1 + Number(loan.interestRate || 0) / 100));
};

const normalizeBreakdown = (breakdown: Partial<PaymentBreakdown>): PaymentBreakdown => ({
  principalPaid: roundMoney(Number(breakdown.principalPaid || 0)),
  interestPaid: roundMoney(Number(breakdown.interestPaid || 0)),
  lateFeePaid: roundMoney(Number(breakdown.lateFeePaid || 0)),
  serviceFeePaid: roundMoney(Number(breakdown.serviceFeePaid || 0)),
  discountApplied: roundMoney(Number(breakdown.discountApplied || 0)),
  totalPaid: roundMoney(Number(breakdown.totalPaid || 0)),
});

const getInstallmentPaymentBreakdown = (installment: Installment): PaymentBreakdown => {
  const entries = Array.isArray(installment.paymentEntries) ? installment.paymentEntries : [];
  if (entries.length > 0) {
    return normalizeBreakdown(
      entries.reduce<PaymentBreakdown>(
        (acc, entry) => ({
          principalPaid: acc.principalPaid + Number(entry.principalPaid || 0),
          interestPaid: acc.interestPaid + Number(entry.interestPaid || 0),
          lateFeePaid: acc.lateFeePaid + Number(entry.lateFeePaid || 0),
          serviceFeePaid: acc.serviceFeePaid + Number(entry.serviceFeePaid || 0),
          discountApplied: acc.discountApplied + Number(entry.discountApplied || 0),
          totalPaid: acc.totalPaid + Number(entry.totalPaid || 0),
        }),
        {
          principalPaid: 0,
          interestPaid: 0,
          lateFeePaid: 0,
          serviceFeePaid: 0,
          discountApplied: 0,
          totalPaid: 0,
        },
      ),
    );
  }

  if (installment.paymentBreakdown) {
    return normalizeBreakdown(installment.paymentBreakdown);
  }

  return normalizeBreakdown({
    principalPaid: installmentPaidAmount(installment),
    totalPaid: installmentPaidAmount(installment),
  });
};

const getInstallmentPrincipalRecovered = (loan: Loan, installment: Installment) => {
  const entries = Array.isArray(installment.paymentEntries) ? installment.paymentEntries : [];
  if (entries.length > 0) {
    return roundMoney(entries.reduce((sum, entry) => sum + Number(entry.principalPaid || 0), 0));
  }

  if (installment.paymentBreakdown) {
    return roundMoney(Number(installment.paymentBreakdown.principalPaid || 0));
  }

  if (normalizeInstallmentStatus(installment.status) === 'PAID') {
    if (Number.isFinite(Number(installment.expectedPrincipal)) && Number(installment.expectedPrincipal) > 0) {
      return roundMoney(Number(installment.expectedPrincipal));
    }

    return roundMoney(Number(loan.amount || 0) / (loanInstallmentsCount(loan) || 1));
  }

  return 0;
};

const getRemainingInstallmentValue = (
  installment: Installment,
  referenceDate: Date,
  dailyLateFeeRate?: number,
) => {
  if (normalizeInstallmentStatus(installment.status) === 'PAID') return 0;
  const lateFee = calculateInstallmentLateFee(installment, referenceDate, dailyLateFeeRate);
  const totalWithFee = roundMoney(installmentAmount(installment) + lateFee);
  const totalPaid = Math.max(roundMoney(getInstallmentPaymentBreakdown(installment).totalPaid), 0);
  return Math.max(roundMoney(totalWithFee - totalPaid), 0);
};

const isInstallmentOverdue = (installment: Installment, todayIso: string) =>
  normalizeInstallmentStatus(installment.status) !== 'PAID' && installment.dueDate < todayIso;

const getTodayIso = (baseDate = new Date()) => {
  const date = new Date(baseDate);
  date.setHours(0, 0, 0, 0);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};

const isCashOutflow = (movement: CashMovement) => resolveCashDelta(movement) < 0;

const getMovementTime = (movement: CashMovement) => {
  const date = toDate(movement.date);
  return date ? date.getTime() : 0;
};

const getMovementCategoryLabel = (movement: CashMovement) => {
  const category = parseCashOutflowCategory(movement.category);
  return category ? CASH_OUTFLOW_CATEGORY_LABELS[category] : 'Sem categoria';
};

const getMovementTypeLabel = (movement: CashMovement) => {
  const type = String(movement.type || '').toUpperCase();
  const labels: Record<string, string> = {
    APORTE: 'Aporte',
    ENTRADA: 'Entrada',
    SAIDA: 'Saida',
    RETIRADA: 'Retirada',
    PAGAMENTO: 'Pagamento',
    ESTORNO: 'Estorno',
  };
  return labels[type] || type || 'Movimentacao';
};

const buildMonthlySummaries = (
  year: number,
  loans: Loan[],
  cashMovements: CashMovement[],
  dailyLateFeeRate?: number,
  referenceDate = new Date(),
): MonthSummary[] => {
  const months = Array.from({ length: 12 }, (_, monthIndex): MonthSummary => ({
    monthIndex,
    monthLabel: `${monthNames[monthIndex]} de ${year}`,
    capitalBorrowed: 0,
    principalRecovered: 0,
    totalReceived: 0,
    realRevenue: 0,
    projectedProfit: 0,
    outflows: 0,
    result: 0,
    overdueAmount: 0,
    closingCash: 0,
    contractsCount: 0,
  }));

  cashMovements.forEach((movement) => {
    const date = toDate(movement.date);
    if (!date || date.getFullYear() !== year) return;

    const month = months[date.getMonth()];
    const signedAmount = roundMoney(resolveCashDelta(movement));
    if (signedAmount < 0) {
      month.outflows = roundMoney(month.outflows + Math.abs(signedAmount));
    }
  });

  const todayIso = getTodayIso(referenceDate);

  loans.forEach((loan) => {
    const status = effectiveLoanStatus(loan);
    const createdDate = getLoanCreatedDate(loan);
    const createdInYear = createdDate?.getFullYear() === year;

    if (createdInYear) {
      const month = months[createdDate.getMonth()];
      month.contractsCount += 1;

      if (status !== 'CANCELLED') {
        const amount = roundMoney(Number(loan.amount || 0));
        month.capitalBorrowed = roundMoney(month.capitalBorrowed + amount);
        month.projectedProfit = roundMoney(
          month.projectedProfit + Math.max(roundMoney(getLoanExpectedTotal(loan) - amount), 0),
        );
      }
    }

    (Array.isArray(loan.installments) ? loan.installments : []).forEach((installment) => {
      if (status === 'ACTIVE') {
        const dueDate = toDate(`${installment.dueDate}T00:00:00`);
        if (dueDate?.getFullYear() === year && isInstallmentOverdue(installment, todayIso)) {
          months[dueDate.getMonth()].overdueAmount = roundMoney(
            months[dueDate.getMonth()].overdueAmount +
              getRemainingInstallmentValue(installment, referenceDate, dailyLateFeeRate),
          );
        }
      }

      const entries = Array.isArray(installment.paymentEntries) ? installment.paymentEntries : [];
      if (entries.length > 0) {
        entries.forEach((entry) => {
          const monthKey = makeMonthKeyFromValue(entry.recordedAt);
          if (!monthKey) return;
          const [entryYear, entryMonth] = monthKey.split('-').map(Number);
          if (entryYear !== year) return;

          const month = months[entryMonth - 1];
          const breakdown = normalizeBreakdown(entry);
          month.principalRecovered = roundMoney(month.principalRecovered + breakdown.principalPaid);
          month.totalReceived = roundMoney(month.totalReceived + breakdown.totalPaid);
          month.realRevenue = roundMoney(
            month.realRevenue + breakdown.interestPaid + breakdown.lateFeePaid + breakdown.serviceFeePaid,
          );
        });
        return;
      }

      if (normalizeInstallmentStatus(installment.status) !== 'PAID' || !installment.paymentBreakdown) return;
      const paymentDate = installment.paidAt || installment.paymentDate || installment.lastPaymentDate;
      const monthKey = makeMonthKeyFromValue(paymentDate);
      if (!monthKey) return;
      const [paymentYear, paymentMonth] = monthKey.split('-').map(Number);
      if (paymentYear !== year) return;

      const month = months[paymentMonth - 1];
      const breakdown = normalizeBreakdown(installment.paymentBreakdown);
      month.principalRecovered = roundMoney(month.principalRecovered + breakdown.principalPaid);
      month.totalReceived = roundMoney(month.totalReceived + breakdown.totalPaid);
      month.realRevenue = roundMoney(
        month.realRevenue + breakdown.interestPaid + breakdown.lateFeePaid + breakdown.serviceFeePaid,
      );
    });

    (Array.isArray(loan.renewalHistory) ? loan.renewalHistory : []).forEach((renewal) => {
      const monthKey = makeMonthKeyFromValue(renewal.paymentDate);
      if (!monthKey) return;
      const [renewalYear, renewalMonth] = monthKey.split('-').map(Number);
      if (renewalYear !== year) return;

      const interestPaid = roundMoney(Number(renewal.interestPaid ?? renewal.amount ?? 0));
      const lateFeePaid = roundMoney(Number(renewal.lateFeePaid || 0));
      const totalPaid = roundMoney(Number(renewal.totalPaid ?? interestPaid + lateFeePaid));
      const month = months[renewalMonth - 1];

      month.totalReceived = roundMoney(month.totalReceived + totalPaid);
      month.realRevenue = roundMoney(month.realRevenue + interestPaid + lateFeePaid);
    });
  });

  months.forEach((month) => {
    const range = getMonthRange(year, month.monthIndex);
    month.closingCash = roundMoney(
      cashMovements.reduce(
        (sum, movement) => (getMovementTime(movement) < range.end ? sum + resolveCashDelta(movement) : sum),
        0,
      ),
    );
    month.result = roundMoney(month.realRevenue - month.outflows);
  });

  return months;
};

const buildAnnualMetrics = (
  year: number,
  caixa: number,
  loans: Loan[],
  cashMovements: CashMovement[],
  customers: Customer[],
  months: MonthSummary[],
  dailyLateFeeRate?: number,
  referenceDate = new Date(),
) => {
  const todayIso = getTodayIso(referenceDate);

  const totalAReceber = loans.reduce((sum, loan) => {
    if (effectiveLoanStatus(loan) !== 'ACTIVE') return sum;
    return roundMoney(
      sum +
        (Array.isArray(loan.installments) ? loan.installments : []).reduce(
          (loanSum, installment) =>
            loanSum + getRemainingInstallmentValue(installment, referenceDate, dailyLateFeeRate),
          0,
        ),
    );
  }, 0);

  const valorEmRua = loans.reduce((sum, loan) => {
    if (effectiveLoanStatus(loan) !== 'ACTIVE') return sum;
    const principalRecovered = roundMoney(
      (Array.isArray(loan.installments) ? loan.installments : []).reduce(
        (loanSum, installment) => loanSum + getInstallmentPrincipalRecovered(loan, installment),
        0,
      ),
    );
    return roundMoney(sum + Math.max(roundMoney(Number(loan.amount || 0) - principalRecovered), 0));
  }, 0);

  const valorEmAtraso = loans.reduce((sum, loan) => {
    if (effectiveLoanStatus(loan) !== 'ACTIVE') return sum;
    return roundMoney(
      sum +
        (Array.isArray(loan.installments) ? loan.installments : []).reduce((loanSum, installment) => {
          if (!isInstallmentOverdue(installment, todayIso)) return loanSum;
          return loanSum + getRemainingInstallmentValue(installment, referenceDate, dailyLateFeeRate);
        }, 0),
    );
  }, 0);

  const totalAportes = cashMovements.reduce((sum, movement) => {
    const date = toDate(movement.date);
    if (!date || date.getFullYear() !== year) return sum;
    const type = String(movement.type || '').toUpperCase();
    if (type !== 'APORTE' && type !== 'ENTRADA') return sum;
    return roundMoney(sum + Math.max(resolveCashDelta(movement), 0));
  }, 0);

  const totalRetiradas = cashMovements.reduce((sum, movement) => {
    const date = toDate(movement.date);
    if (!date || date.getFullYear() !== year || !isCashOutflow(movement)) return sum;
    return roundMoney(sum + Math.abs(resolveCashDelta(movement)));
  }, 0);

  const capitalBorrowed = roundMoney(months.reduce((sum, month) => sum + month.capitalBorrowed, 0));
  const principalRecovered = roundMoney(months.reduce((sum, month) => sum + month.principalRecovered, 0));
  const totalReceived = roundMoney(months.reduce((sum, month) => sum + month.totalReceived, 0));
  const realRevenue = roundMoney(months.reduce((sum, month) => sum + month.realRevenue, 0));
  const projectedProfit = roundMoney(months.reduce((sum, month) => sum + month.projectedProfit, 0));
  const resultAfterExpenses = roundMoney(realRevenue - totalRetiradas);

  return {
    caixa,
    capitalBorrowed,
    principalRecovered,
    totalReceived,
    realRevenue,
    projectedProfit,
    resultAfterExpenses,
    totalAReceber,
    valorEmRua,
    valorEmAtraso,
    totalAportes,
    totalRetiradas,
    roi: calculatePortfolioRoi(realRevenue, capitalBorrowed),
    contractsCreated: months.reduce((sum, month) => sum + month.contractsCount, 0),
    contractsCompleted: loans.filter((loan) => effectiveLoanStatus(loan) === 'COMPLETED').length,
    contractsActive: loans.filter((loan) => effectiveLoanStatus(loan) === 'ACTIVE').length,
    customersCount: customers.length,
  };
};

const getLastAutoTableY = (doc: unknown, fallback: number) =>
  Number((doc as { lastAutoTable?: { finalY?: number } }).lastAutoTable?.finalY || fallback);

const addFooter = (doc: {
  getNumberOfPages: () => number;
  setPage: (page: number) => void;
  internal: { pageSize: { getWidth: () => number; getHeight: () => number } };
  setFontSize: (size: number) => void;
  setTextColor: (...args: number[]) => void;
  text: (text: string, x: number, y: number, options?: Record<string, unknown>) => void;
}) => {
  const totalPages = doc.getNumberOfPages();
  const width = doc.internal.pageSize.getWidth();
  const height = doc.internal.pageSize.getHeight();

  for (let page = 1; page <= totalPages; page += 1) {
    doc.setPage(page);
    doc.setFontSize(8);
    doc.setTextColor(120, 111, 101);
    doc.text(`GR SOLUTION - Relatorio anual do caixa - Pagina ${page} de ${totalPages}`, width / 2, height - 8, {
      align: 'center',
    });
  }
};

const drawMainHeader = (
  doc: {
    setFillColor: (...args: number[]) => void;
    roundedRect: (x: number, y: number, w: number, h: number, rx: number, ry: number, style?: string) => void;
    setFont: (fontName: string, fontStyle?: string) => void;
    setFontSize: (size: number) => void;
    setTextColor: (...args: number[]) => void;
    text: (text: string, x: number, y: number) => void;
  },
  pageWidth: number,
  margin: number,
  year: number,
  generatedAt: Date,
) => {
  doc.setFillColor(...colors.ink);
  doc.roundedRect(margin, 12, pageWidth - margin * 2, 34, 7, 7, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(...colors.gold);
  doc.text('RELATORIO ANUAL DO CAIXA', margin + 7, 22);
  doc.setFontSize(24);
  doc.setTextColor(...colors.white);
  doc.text('GR SOLUTION', margin + 7, 33);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(11);
  doc.text(`Ano ${year} - gerado em ${formatDateTime(generatedAt)}`, margin + 7, 42);
};

const drawSectionTitle = (
  doc: {
    setFont: (fontName: string, fontStyle?: string) => void;
    setFontSize: (size: number) => void;
    setTextColor: (...args: number[]) => void;
    text: (text: string, x: number, y: number) => void;
  },
  title: string,
  margin: number,
  y: number,
) => {
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(15);
  doc.setTextColor(...colors.text);
  doc.text(title, margin, y);
};

const drawSectionBar = (
  doc: {
    internal: { pageSize: { getWidth: () => number } };
    setFillColor: (...args: number[]) => void;
    roundedRect: (x: number, y: number, w: number, h: number, rx: number, ry: number, style?: string) => void;
    setFont: (fontName: string, fontStyle?: string) => void;
    setFontSize: (size: number) => void;
    setTextColor: (...args: number[]) => void;
    text: (text: string, x: number, y: number) => void;
  },
  title: string,
  margin: number,
  y: number,
) => {
  doc.setFillColor(...colors.ink);
  doc.roundedRect(margin, y, doc.internal.pageSize.getWidth() - margin * 2, 22, 6, 6, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.setTextColor(...colors.white);
  doc.text(title, margin + 7, y + 14);
};

const autoTableDefaults = {
  theme: 'grid',
  styles: {
    font: 'helvetica',
    fontSize: 8,
    textColor: colors.text,
    cellPadding: 2.5,
    lineColor: colors.border,
    lineWidth: 0.15,
    overflow: 'linebreak',
  },
  headStyles: {
    fillColor: colors.headerGold,
    textColor: colors.text,
    fontStyle: 'bold',
    lineColor: colors.border,
  },
  alternateRowStyles: {
    fillColor: colors.rowAlt,
  },
};

export const generateAnnualCashReportPdf = async ({
  year,
  caixa,
  loans,
  cashMovements,
  customers,
  dailyLateFeeRate,
  generatedAt = new Date(),
}: AnnualCashReportParams) => {
  const [{ jsPDF }, autoTableModule] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
  ]);
  const autoTable = autoTableModule.default as AutoTableFn;

  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  doc.setProperties({
    title: `Relatorio anual do caixa - ${year}`,
    subject: 'Relatorio anual financeiro da GR SOLUTION',
    author: 'GR SOLUTION',
  });

  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 14;
  const months = buildMonthlySummaries(year, loans, cashMovements, dailyLateFeeRate, generatedAt);
  const annual = buildAnnualMetrics(year, caixa, loans, cashMovements, customers, months, dailyLateFeeRate, generatedAt);

  drawMainHeader(doc, pageWidth, margin, year, generatedAt);
  drawSectionTitle(doc, 'Panorama anual', margin, 58);

  autoTable(doc, {
    ...autoTableDefaults,
    startY: 64,
    margin: { left: margin, right: margin },
    head: [['Indicador', 'Valor']],
    body: [
      ['Caixa geral atual', formatCurrency(annual.caixa)],
      ['Capital emprestado no ano', formatCurrency(annual.capitalBorrowed)],
      ['Capital recuperado no ano', formatCurrency(annual.principalRecovered)],
      ['Total recebido dos clientes', formatCurrency(annual.totalReceived)],
      ['Faturamento real do ano', formatCurrency(annual.realRevenue)],
      ['Lucro projetado do ano', formatCurrency(annual.projectedProfit)],
      ['Resultado apos despesas', formatCurrency(annual.resultAfterExpenses)],
      ['Total a receber', formatCurrency(annual.totalAReceber)],
      ['Valor em rua', formatCurrency(annual.valorEmRua)],
      ['Valor em atraso', formatCurrency(annual.valorEmAtraso)],
      ['Total de aportes', formatCurrency(annual.totalAportes)],
      ['Total de retiradas', formatCurrency(annual.totalRetiradas)],
      ['ROI da carteira', formatPercentage(annual.roi)],
      ['Quantidade de contratos criados', String(annual.contractsCreated)],
      ['Quantidade de contratos quitados', String(annual.contractsCompleted)],
      ['Quantidade de contratos ativos', String(annual.contractsActive)],
      ['Quantidade de clientes cadastrados', String(annual.customersCount)],
    ],
    columnStyles: {
      0: { cellWidth: 190 },
      1: { halign: 'right' },
    },
  });

  let y = getLastAutoTableY(doc, 64) + 11;
  drawSectionTitle(doc, 'Resumo mes a mes', margin, y);

  autoTable(doc, {
    ...autoTableDefaults,
    startY: y + 5,
    margin: { left: margin, right: margin },
    head: [[
      'Mes',
      'Capital emprestado',
      'Capital recuperado',
      'Total recebido',
      'Faturamento real',
      'Lucro projetado',
      'Saidas',
      'Resultado',
      'Valor em atraso',
      'Saldo final',
      'Qtd. contratos',
    ]],
    body: months.map((month) => [
      month.monthLabel,
      formatCurrency(month.capitalBorrowed),
      formatCurrency(month.principalRecovered),
      formatCurrency(month.totalReceived),
      formatCurrency(month.realRevenue),
      formatCurrency(month.projectedProfit),
      formatCurrency(month.outflows),
      formatCurrency(month.result),
      formatCurrency(month.overdueAmount),
      formatCurrency(month.closingCash),
      String(month.contractsCount),
    ]),
    styles: { ...autoTableDefaults.styles, fontSize: 7, cellPadding: 2 },
    columnStyles: {
      0: { cellWidth: 30 },
      1: { halign: 'right' },
      2: { halign: 'right' },
      3: { halign: 'right' },
      4: { halign: 'right' },
      5: { halign: 'right' },
      6: { halign: 'right' },
      7: { halign: 'right' },
      8: { halign: 'right' },
      9: { halign: 'right' },
      10: { halign: 'right', cellWidth: 18 },
    },
  });

  doc.addPage();
  drawSectionBar(doc, `Movimentacoes do caixa - ${year}`, margin, 12);

  const loanById = new Map(loans.map((loan) => [loan.id, loan]));
  const movementRows = cashMovements
    .filter((movement) => {
      const date = toDate(movement.date);
      return Boolean(date && date.getFullYear() === year);
    })
    .sort((a, b) => getMovementTime(a) - getMovementTime(b))
    .map((movement) => {
      const date = toDate(movement.date) || generatedAt;
      const linkedLoan = movement.loanId ? loanById.get(movement.loanId) : undefined;
      const customerContract = linkedLoan
        ? `${linkedLoan.customerName} / ${linkedLoan.id}`
        : movement.loanId || '-';
      const paymentMethod = String(
        (movement as CashMovement & { paymentMethod?: unknown; payment?: unknown }).paymentMethod ??
          (movement as CashMovement & { paymentMethod?: unknown; payment?: unknown }).payment ??
          '',
      ).trim();

      return [
        `${monthNames[date.getMonth()]} de ${date.getFullYear()}`,
        formatDate(date),
        getMovementTypeLabel(movement),
        movement.description || '-',
        getMovementCategoryLabel(movement),
        customerContract,
        paymentMethod || '-',
        formatCurrency(resolveCashDelta(movement), true),
      ];
    });

  autoTable(doc, {
    ...autoTableDefaults,
    startY: 44,
    margin: { left: margin, right: margin },
    head: [['Mes', 'Data', 'Tipo', 'Descricao', 'Categoria', 'Cliente/Contrato', 'Pagamento', 'Valor']],
    body: movementRows.length > 0
      ? movementRows
      : [[`${year}`, '-', '-', 'Nenhuma movimentacao registrada no ano.', 'Sem categoria', '-', '-', formatCurrency(0)]],
    styles: { ...autoTableDefaults.styles, fontSize: 7, cellPadding: 2 },
    columnStyles: {
      0: { cellWidth: 30 },
      1: { cellWidth: 20 },
      2: { cellWidth: 24 },
      3: { cellWidth: 54 },
      4: { cellWidth: 36 },
      5: { cellWidth: 52 },
      6: { cellWidth: 26 },
      7: { cellWidth: 28, halign: 'right' },
    },
  });

  addFooter(doc);
  doc.save(`relatorio-caixa-${year}.pdf`);
};
