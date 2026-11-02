import type { CashMovement, Loan, MonthlySnapshot } from '../types';
import { resolveCashDelta } from './domainParsers';
import { CASH_OUTFLOW_CATEGORY_LABELS, resolveCashOutflowCategory } from './cashCategories';

interface MonthlyCashReportParams {
  year: number;
  month: number;
  cashMovements: CashMovement[];
  loans: Loan[];
  monthlySnapshots: MonthlySnapshot[];
  generatedAt?: Date;
}

interface MonthlyCashReportRow {
  movement: CashMovement;
  date: Date;
  signedAmount: number;
}

export interface MonthlyCashReportData {
  periodLabel: string;
  periodKey: string;
  openingCash: number;
  totalEntries: number;
  totalExits: number;
  netChange: number;
  closingCash: number;
  movementCount: number;
  closedSnapshot?: MonthlySnapshot;
  rows: MonthlyCashReportRow[];
}

type AutoTableFn = (doc: unknown, options: Record<string, unknown>) => void;

const monthNames = [
  'Janeiro', 'Fevereiro', 'Marco', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
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
  const formatted = Math.abs(rounded).toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  if (!withSign) return `${rounded < 0 ? '-' : ''}R$ ${formatted}`;
  return `${rounded >= 0 ? '+' : '-'}R$ ${formatted}`;
};

const formatDate = (date: Date) => date.toLocaleDateString('pt-BR');

const formatDateTime = (date: Date) =>
  `${formatDate(date)}, ${date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;

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
  const normalized = String(value).trim();
  // Datas sem horario representam a competencia local do lancamento, nao UTC.
  const parsed = /^\d{4}-\d{2}-\d{2}$/.test(normalized)
    ? new Date(`${normalized}T12:00:00`)
    : new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
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

const getMovementCategoryLabel = (movement: CashMovement, signedAmount: number) => {
  if (signedAmount >= 0) return 'Entrada de caixa';
  return CASH_OUTFLOW_CATEGORY_LABELS[resolveCashOutflowCategory(movement)];
};

const getPaymentMethod = (movement: CashMovement) => String(
  (movement as CashMovement & { paymentMethod?: unknown; payment?: unknown }).paymentMethod ??
  (movement as CashMovement & { paymentMethod?: unknown; payment?: unknown }).payment ??
  '',
).trim();

export const buildMonthlyCashReportData = ({
  year,
  month,
  cashMovements,
  monthlySnapshots,
}: Omit<MonthlyCashReportParams, 'loans' | 'generatedAt'>): MonthlyCashReportData => {
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    throw new Error('MES_DE_RELATORIO_INVALIDO');
  }

  const start = new Date(year, month - 1, 1).getTime();
  const end = new Date(year, month, 1).getTime();
  const periodKey = `${year}-${String(month).padStart(2, '0')}`;
  const rows = cashMovements
    .map((movement) => ({ movement, date: toDate(movement.date) }))
    .filter((entry): entry is { movement: CashMovement; date: Date } => Boolean(entry.date))
    .map(({ movement, date }) => ({ movement, date, signedAmount: roundMoney(resolveCashDelta(movement)) }))
    .filter((entry) => entry.date.getTime() >= start && entry.date.getTime() < end)
    .sort((left, right) => left.date.getTime() - right.date.getTime());

  const openingCash = roundMoney(cashMovements.reduce((total, movement) => {
    const date = toDate(movement.date);
    return date && date.getTime() < start ? total + resolveCashDelta(movement) : total;
  }, 0));
  const totalEntries = roundMoney(rows.reduce((total, row) => total + Math.max(row.signedAmount, 0), 0));
  const totalExits = roundMoney(rows.reduce((total, row) => total + Math.abs(Math.min(row.signedAmount, 0)), 0));
  const netChange = roundMoney(totalEntries - totalExits);

  return {
    periodLabel: `${monthNames[month - 1]} de ${year}`,
    periodKey,
    openingCash,
    totalEntries,
    totalExits,
    netChange,
    closingCash: roundMoney(openingCash + netChange),
    movementCount: rows.length,
    closedSnapshot: monthlySnapshots.find((snapshot) => snapshot.month === periodKey),
    rows,
  };
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
  alternateRowStyles: { fillColor: colors.rowAlt },
};

const addFooter = (doc: {
  getNumberOfPages: () => number;
  setPage: (page: number) => void;
  internal: { pageSize: { getWidth: () => number; getHeight: () => number } };
  setFontSize: (size: number) => void;
  setTextColor: (...args: number[]) => void;
  text: (text: string, x: number, y: number, options?: Record<string, unknown>) => void;
}) => {
  const pageCount = doc.getNumberOfPages();
  const width = doc.internal.pageSize.getWidth();
  const height = doc.internal.pageSize.getHeight();
  for (let page = 1; page <= pageCount; page += 1) {
    doc.setPage(page);
    doc.setFontSize(8);
    doc.setTextColor(120, 111, 101);
    doc.text(`GR SOLUTION - Relatorio mensal do caixa - Pagina ${page} de ${pageCount}`, width / 2, height - 8, {
      align: 'center',
    });
  }
};

export const generateMonthlyCashReportPdf = async ({
  year,
  month,
  cashMovements,
  loans,
  monthlySnapshots,
  generatedAt = new Date(),
}: MonthlyCashReportParams) => {
  const [{ jsPDF }, autoTableModule] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
  ]);
  const autoTable = autoTableModule.default as AutoTableFn;
  const report = buildMonthlyCashReportData({ year, month, cashMovements, monthlySnapshots });
  const loanById = new Map(loans.map((loan) => [loan.id, loan]));
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 14;

  doc.setProperties({
    title: `Relatorio mensal do caixa - ${report.periodLabel}`,
    subject: 'Relatorio financeiro mensal da GR SOLUTION',
    author: 'GR SOLUTION',
  });
  doc.setFillColor(...colors.ink);
  doc.roundedRect(margin, 12, pageWidth - margin * 2, 34, 7, 7, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(...colors.gold);
  doc.text('RELATORIO MENSAL DO CAIXA', margin + 7, 22);
  doc.setFontSize(22);
  doc.setTextColor(...colors.white);
  doc.text('GR SOLUTION', margin + 7, 33);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(11);
  doc.text(`${report.periodLabel} - gerado em ${formatDateTime(generatedAt)}`, margin + 7, 42);

  autoTable(doc, {
    ...autoTableDefaults,
    startY: 54,
    margin: { left: margin, right: margin },
    head: [['Conferencia do periodo', 'Valor']],
    body: [
      ['Saldo inicial calculado', formatCurrency(report.openingCash)],
      ['Entradas registradas', formatCurrency(report.totalEntries)],
      ['Saidas registradas', formatCurrency(report.totalExits)],
      ['Variacao do periodo', formatCurrency(report.netChange, true)],
      ['Saldo final calculado', formatCurrency(report.closingCash)],
      ['Quantidade de movimentacoes', String(report.movementCount)],
      ...(report.closedSnapshot
        ? [['Saldo final do fechamento registrado', formatCurrency(report.closedSnapshot.closingCash)]]
        : [['Fechamento mensal', 'Nao registrado']]),
    ],
    columnStyles: { 0: { cellWidth: 190 }, 1: { halign: 'right' } },
  });

  const finalY = Number((doc as unknown as { lastAutoTable?: { finalY?: number } }).lastAutoTable?.finalY || 90);
  doc.setFillColor(...colors.ink);
  doc.roundedRect(margin, finalY + 10, pageWidth - margin * 2, 16, 5, 5, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(...colors.white);
  doc.text('Movimentacoes efetivamente registradas no livro-caixa', margin + 6, finalY + 20);

  autoTable(doc, {
    ...autoTableDefaults,
    startY: finalY + 33,
    margin: { left: margin, right: margin },
    head: [['Data', 'Tipo', 'Descricao', 'Categoria', 'Cliente/Contrato', 'Pagamento', 'Valor']],
    body: report.rows.length > 0
      ? report.rows.map((row) => {
        const loan = row.movement.loanId ? loanById.get(row.movement.loanId) : undefined;
        return [
          formatDate(row.date),
          getMovementTypeLabel(row.movement),
          row.movement.description || '-',
          getMovementCategoryLabel(row.movement, row.signedAmount),
          loan ? `${loan.customerName} / ${loan.id}` : row.movement.loanId || '-',
          getPaymentMethod(row.movement) || '-',
          formatCurrency(row.signedAmount, true),
        ];
      })
      : [[`${report.periodLabel}`, '-', 'Nenhuma movimentacao registrada no mes.', '-', '-', '-', formatCurrency(0)]],
    styles: { ...autoTableDefaults.styles, fontSize: 7, cellPadding: 2 },
    columnStyles: {
      0: { cellWidth: 20 },
      1: { cellWidth: 25 },
      2: { cellWidth: 62 },
      3: { cellWidth: 38 },
      4: { cellWidth: 52 },
      5: { cellWidth: 27 },
      6: { cellWidth: 28, halign: 'right' },
    },
  });

  addFooter(doc);
  doc.save(`relatorio-caixa-${report.periodKey}.pdf`);
};
