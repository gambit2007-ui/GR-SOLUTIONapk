import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { Customer, Installment, Loan } from '../types';
import {
  effectiveLoanStatus,
  installmentAmount,
  installmentPaidAmount,
  normalizeInstallmentStatus,
} from './loanCompat';
import { DEFAULT_DAILY_LATE_FEE_RATE, normalizeDailyLateFeeRate } from './lateFee';

type RGB = [number, number, number];

interface ContractPdfOptions {
  dailyLateFeeRate?: number;
}

interface InfoItem {
  label: string;
  value: string;
}

const PAGE_WIDTH = 210;
const PAGE_HEIGHT = 297;
const MARGIN = 17;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;
const PAGE_BOTTOM = 274;
const CREDITOR_NAME = 'GR SOLUTIONS';
const CREDITOR_DOCUMENT = '58722573000109';
const CREDITOR_ADDRESS = '';
const CREDITOR_CONTACT = '021967519287';

const COLORS: Record<'navy' | 'gold' | 'slate' | 'muted' | 'surface' | 'border' | 'white' | 'red' | 'green', RGB> = {
  navy: [7, 20, 38],
  gold: [196, 147, 46],
  slate: [62, 82, 112],
  muted: [125, 141, 164],
  surface: [243, 246, 249],
  border: [215, 222, 231],
  white: [255, 255, 255],
  red: [185, 45, 45],
  green: [25, 130, 92],
};

const formatCurrency = (value: number) =>
  Number(value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const roundMoney = (value: number) =>
  Number((Number.isFinite(value) ? value : 0).toFixed(2));

const toDate = (value: unknown): Date | null => {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;

  if (typeof value === 'string') {
    const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
    if (dateOnly) {
      const [, year, month, day] = dateOnly;
      const parsed = new Date(Number(year), Number(month) - 1, Number(day), 12);
      return Number.isNaN(parsed.getTime()) ? null : parsed;
    }

    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  if (typeof value === 'number') {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  if (typeof value === 'object' && value !== null && typeof (value as { toDate?: unknown }).toDate === 'function') {
    try {
      const parsed = (value as { toDate: () => Date }).toDate();
      return parsed instanceof Date && !Number.isNaN(parsed.getTime()) ? parsed : null;
    } catch {
      return null;
    }
  }

  return null;
};

const formatDateBR = (value: unknown, fallback = 'Não informado') => {
  const date = toDate(value);
  return date ? date.toLocaleDateString('pt-BR') : fallback;
};

const normalizeText = (value: unknown, fallback = 'Não informado') => {
  const text = String(value ?? '').trim();
  return text.length > 0 ? text : fallback;
};

const formatDocument = (value: unknown) => {
  const document = normalizeText(value, '');
  const digits = document.replace(/\D/g, '');

  if (digits.length === 11) {
    return digits.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
  }
  if (digits.length === 14) {
    return digits.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
  }

  return document || 'Não informado';
};

const formatPhone = (value: unknown) => {
  const phone = normalizeText(value, '');
  const digits = phone.replace(/\D/g, '');
  const localDigits = digits.startsWith('55') && digits.length > 11 ? digits.slice(2) : digits;

  if (localDigits.length === 11) {
    return localDigits.replace(/(\d{2})(\d{5})(\d{4})/, '($1) $2-$3');
  }
  if (localDigits.length === 10) {
    return localDigits.replace(/(\d{2})(\d{4})(\d{4})/, '($1) $2-$3');
  }

  return phone || 'Não informado';
};

const formatPercent = (value: number, maximumFractionDigits = 4) =>
  Number(value || 0).toLocaleString('pt-BR', {
    minimumFractionDigits: 0,
    maximumFractionDigits,
  });

const getLoanInterestType = (loan: Loan): 'SIMPLE' | 'PRICE' | 'SPLIT' => {
  const normalized = String(loan.interestType || '').trim().toUpperCase();
  if (normalized === 'PRICE') return 'PRICE';
  if (normalized === 'SPLIT' || normalized === 'PERSONALIZADO') return 'SPLIT';
  return 'SIMPLE';
};

const getInterestTypeLabel = (loan: Loan) => {
  const type = getLoanInterestType(loan);
  if (type === 'PRICE') return 'Tabela PRICE';
  if (type === 'SPLIT') return 'Juros divididos';
  return 'Juros simples';
};

const getInterestRateLabel = (loan: Loan) => {
  const type = getLoanInterestType(loan);
  if (type === 'SPLIT') return `${formatPercent(loan.interestRate)}% ao mês`;
  if (type === 'PRICE') return `${formatPercent(loan.interestRate)}% por parcela`;
  return `${formatPercent(loan.interestRate)}% sobre o capital`;
};

const getFrequencyLabel = (frequency: unknown) => {
  const normalized = String(frequency || '').trim().toUpperCase();
  if (normalized === 'DIARIO' || normalized === 'DAILY') return 'Diária';
  if (normalized === 'SEMANAL' || normalized === 'WEEKLY') return 'Semanal';
  if (normalized === 'QUINZENAL' || normalized === 'BIWEEKLY') return 'Quinzenal';
  return 'Mensal';
};

const getLoanStatusLabel = (loan: Loan) => {
  const status = effectiveLoanStatus(loan);
  if (status === 'COMPLETED') return 'Quitado';
  if (status === 'CANCELLED') return 'Cancelado';
  return 'Ativo';
};

const getInstallmentPaidValue = (installment: Installment) => {
  const paid = installmentPaidAmount(installment);
  return normalizeInstallmentStatus(installment.status) === 'PAID'
    ? Math.max(paid, installmentAmount(installment))
    : paid;
};

const getInstallmentStatusLabel = (installment: Installment) => {
  const status = normalizeInstallmentStatus(installment.status);
  const paid = getInstallmentPaidValue(installment);

  if (status === 'PAID') return 'Pago';
  if (paid > 0) return 'Parcial';
  if (status === 'OVERDUE') return 'Atrasado';
  return 'Pendente';
};

const drawSectionTitle = (doc: jsPDF, title: string, y: number) => {
  doc.setFillColor(...COLORS.gold);
  doc.rect(MARGIN, y - 5.5, 1.8, 8, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(15);
  doc.setTextColor(...COLORS.navy);
  doc.text(title, MARGIN + 5, y);
  return y + 9;
};

const drawInfoGrid = (doc: jsPDF, items: InfoItem[], startY: number) => {
  const gap = 4;
  const cardWidth = (CONTENT_WIDTH - gap) / 2;
  let y = startY;

  for (let index = 0; index < items.length; index += 2) {
    const rowItems = items.slice(index, index + 2);
    const valueLines = rowItems.map((item) => {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(10);
      const lines = doc.splitTextToSize(item.value, cardWidth - 10) as string[];
      return lines.length > 0 ? lines : [''];
    });
    const rowHeight = Math.max(20, 14 + Math.max(...valueLines.map((lines) => lines.length)) * 4.5);

    rowItems.forEach((item, rowIndex) => {
      const x = MARGIN + rowIndex * (cardWidth + gap);
      doc.setFillColor(...COLORS.surface);
      doc.setDrawColor(...COLORS.border);
      doc.roundedRect(x, y, cardWidth, rowHeight, 1.5, 1.5, 'FD');

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7.5);
      doc.setTextColor(...COLORS.gold);
      doc.text(item.label.toUpperCase(), x + 5, y + 7);

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(10);
      doc.setTextColor(...COLORS.navy);
      doc.text(valueLines[rowIndex], x + 5, y + 14);
    });

    y += rowHeight + 4;
  }

  return y;
};

const addContentPage = (doc: jsPDF) => {
  doc.addPage();
  doc.setFillColor(...COLORS.white);
  doc.rect(0, 0, PAGE_WIDTH, PAGE_HEIGHT, 'F');
  return 22;
};

const ensureSpace = (doc: jsPDF, y: number, heightNeeded: number) =>
  y + heightNeeded > PAGE_BOTTOM ? addContentPage(doc) : y;

const drawClause = (doc: jsPDF, title: string, paragraphs: string[], startY: number) => {
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10.2);
  const lines = paragraphs.map((paragraph) => doc.splitTextToSize(paragraph, CONTENT_WIDTH) as string[]);
  const heightNeeded = 10 + lines.reduce((sum, paragraphLines) => sum + paragraphLines.length * 5 + 4, 0);
  let y = ensureSpace(doc, startY, heightNeeded);

  y = drawSectionTitle(doc, title, y);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10.2);
  doc.setTextColor(...COLORS.slate);

  lines.forEach((paragraphLines) => {
    doc.text(paragraphLines, MARGIN, y);
    y += paragraphLines.length * 5 + 4;
  });

  return y + 2;
};

const fitFooterText = (doc: jsPDF, text: string, maxWidth: number) => {
  if (doc.getTextWidth(text) <= maxWidth) return text;
  let fitted = text;
  while (fitted.length > 3 && doc.getTextWidth(`${fitted}...`) > maxWidth) {
    fitted = fitted.slice(0, -1);
  }
  return `${fitted}...`;
};

const drawPageFooters = (doc: jsPDF, contractNumber: string, customerName: string) => {
  const totalPages = doc.getNumberOfPages();

  for (let page = 1; page <= totalPages; page += 1) {
    doc.setPage(page);
    const isCover = page === 1;
    const lineColor = isCover ? COLORS.gold : COLORS.border;
    const textColor = isCover ? COLORS.muted : COLORS.slate;

    doc.setDrawColor(...lineColor);
    doc.setLineWidth(0.25);
    doc.line(MARGIN, 282, PAGE_WIDTH - MARGIN, 282);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.2);
    doc.setTextColor(...textColor);
    const identification = fitFooterText(
      doc,
      `${CREDITOR_NAME}  |  ${contractNumber}  |  ${customerName}`,
      125,
    );
    doc.text(identification, MARGIN, 288);
    doc.text(`Página ${page} de ${totalPages}`, PAGE_WIDTH - MARGIN, 288, { align: 'right' });
  }
};

const drawSignature = (doc: jsPDF, y: number, name: string, role: string) => {
  doc.setDrawColor(...COLORS.slate);
  doc.setLineWidth(0.25);
  doc.line(MARGIN, y, PAGE_WIDTH - MARGIN, y);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(...COLORS.navy);
  doc.text(name, MARGIN, y + 7);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(...COLORS.gold);
  doc.text(role.toUpperCase(), MARGIN, y + 13);
};

export const buildContractPDFDocument = (
  customer: Customer,
  loan: Loan,
  options: ContractPdfOptions = {},
) => {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const generatedAt = new Date();
  const installments = Array.isArray(loan.installments) ? loan.installments : [];
  const firstInstallment = installments[0];
  const lastInstallment = installments[installments.length - 1];
  const installmentCount = Number(
    loan.installmentCount || loan.installmentsCount || installments.length || 0,
  );
  const installmentValue = Number(loan.installmentValue ?? installmentAmount(firstInstallment));
  const calculatedTotal = installments.reduce((sum, installment) => sum + installmentAmount(installment), 0);
  const totalToReturn = Number(loan.totalToReturn || calculatedTotal || installmentValue * installmentCount);
  const paidOnInstallments = installments.reduce(
    (sum, installment) => sum + getInstallmentPaidValue(installment),
    0,
  );
  const nominalBalance = roundMoney(Math.max(totalToReturn - paidOnInstallments, 0));
  const customerName = normalizeText(customer.name);
  const contractNumber = normalizeText(loan.contractNumber || loan.id, 'Sem número');
  const dailyLateFeeRate = normalizeDailyLateFeeRate(
    options.dailyLateFeeRate ?? DEFAULT_DAILY_LATE_FEE_RATE,
  );
  const frequencyLabel = getFrequencyLabel(loan.frequency);
  const interestType = getLoanInterestType(loan);
  const issueDate = formatDateBR(generatedAt);
  const startDate = formatDateBR(loan.startDate || loan.createdAt);
  const firstDueDate = formatDateBR(firstInstallment?.dueDate || loan.startDate);
  const lastDueDate = formatDateBR(lastInstallment?.dueDate || loan.dueDate);

  doc.setProperties({
    title: `Contrato de empréstimo ${contractNumber}`,
    subject: `Contrato particular de empréstimo de dinheiro - ${customerName}`,
    author: CREDITOR_NAME,
    creator: CREDITOR_NAME,
    keywords: `contrato, empréstimo, parcelas, ${CREDITOR_NAME}`,
  });

  // Capa
  doc.setFillColor(...COLORS.navy);
  doc.rect(0, 0, PAGE_WIDTH, PAGE_HEIGHT, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.setTextColor(...COLORS.gold);
  doc.text(CREDITOR_NAME, MARGIN, 34);
  doc.setFillColor(...COLORS.gold);
  doc.rect(MARGIN, 40, 34, 1.5, 'F');

  doc.setFontSize(28);
  doc.setTextColor(...COLORS.white);
  const coverTitle = doc.splitTextToSize('Contrato particular de empréstimo', CONTENT_WIDTH) as string[];
  doc.text(coverTitle, MARGIN, 83);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(13);
  doc.setTextColor(192, 203, 219);
  doc.text(`${formatCurrency(loan.amount)}  |  ${customerName}`, MARGIN, 120);

  doc.setFontSize(10);
  doc.text(`Número do contrato: ${contractNumber}`, MARGIN, 229);
  doc.text(`Data de emissão: ${issueDate}`, MARGIN, 237);
  doc.text(`Período: ${startDate} a ${lastDueDate}`, MARGIN, 245);

  // Qualificação e resumo financeiro
  let y = addContentPage(doc);
  y = drawSectionTitle(doc, 'Qualificação das partes', y);
  y = drawInfoGrid(doc, [
    { label: 'Credor', value: CREDITOR_NAME },
    { label: 'CPF/CNPJ do credor', value: formatDocument(CREDITOR_DOCUMENT) },
    { label: 'Endereço do credor', value: CREDITOR_ADDRESS },
    { label: 'Contato do credor', value: CREDITOR_CONTACT },
    { label: 'Devedor', value: customerName },
    { label: 'CPF/CNPJ do devedor', value: formatDocument(customer.cpf) },
    {
      label: 'RG / Nascimento',
      value: `${normalizeText(customer.rg)}  |  ${formatDateBR(customer.birthDate)}`,
    },
    { label: 'Contato do devedor', value: formatPhone(customer.phone) },
    { label: 'Endereço do devedor', value: normalizeText(customer.address) },
    { label: 'E-mail do devedor', value: normalizeText(customer.email) },
  ], y);

  y += 2;
  y = drawSectionTitle(doc, 'Resumo financeiro', y);
  drawInfoGrid(doc, [
    { label: 'Capital emprestado', value: formatCurrency(loan.amount) },
    { label: 'Valor total do contrato', value: formatCurrency(totalToReturn) },
    { label: 'Quantidade de parcelas', value: String(installmentCount) },
    { label: 'Valor da parcela', value: formatCurrency(installmentValue) },
    { label: 'Pago nas parcelas', value: formatCurrency(paidOnInstallments) },
    { label: 'Saldo nominal restante', value: formatCurrency(nominalBalance) },
    { label: 'Frequência', value: frequencyLabel },
    { label: 'Primeiro vencimento', value: firstDueDate },
  ], y);

  // Condições e cronograma
  y = addContentPage(doc);
  y = drawSectionTitle(doc, 'Condições do empréstimo', y);
  y = drawInfoGrid(doc, [
    { label: 'Tipo de juros', value: getInterestTypeLabel(loan) },
    { label: 'Taxa contratada', value: getInterestRateLabel(loan) },
    { label: 'Data do contrato', value: startDate },
    { label: 'Último vencimento', value: lastDueDate },
    { label: 'Situação', value: getLoanStatusLabel(loan) },
    { label: 'Observações', value: normalizeText(loan.notes, 'Sem observações') },
  ], y);

  y += 2;
  y = drawSectionTitle(doc, 'Cronograma de pagamentos', y);
  const installmentRows = installments.length > 0
    ? installments.map((installment, index) => {
        const paidValue = getInstallmentPaidValue(installment);
        const paymentDate = installment.paymentDate || installment.paidAt || installment.lastPaymentDate;
        const status = getInstallmentStatusLabel(installment);
        const payment = paidValue > 0
          ? `${formatCurrency(paidValue)}${paymentDate ? ` em ${formatDateBR(paymentDate)}` : ''}`
          : 'Pendente';

        return [
          String(installment.number || index + 1),
          formatDateBR(installment.dueDate),
          formatCurrency(installmentAmount(installment)),
          status,
          payment,
        ];
      })
    : [['-', 'Não informado', formatCurrency(0), 'Sem parcelas', 'Pendente']];

  autoTable(doc, {
    startY: y,
    margin: { left: MARGIN, right: MARGIN, top: 18, bottom: 20 },
    head: [['Parcela', 'Vencimento', 'Valor', 'Status', 'Pagamento']],
    body: installmentRows,
    theme: 'plain',
    styles: {
      font: 'helvetica',
      fontSize: 8.3,
      textColor: COLORS.slate,
      cellPadding: 3.4,
      lineWidth: 0,
      valign: 'middle',
    },
    headStyles: {
      fillColor: COLORS.navy,
      textColor: COLORS.white,
      fontStyle: 'bold',
      minCellHeight: 11,
    },
    alternateRowStyles: { fillColor: COLORS.surface },
    columnStyles: {
      0: { cellWidth: 19 },
      1: { cellWidth: 31 },
      2: { cellWidth: 33 },
      3: { cellWidth: 28 },
      4: { cellWidth: 65 },
    },
    didParseCell: (data) => {
      if (data.section !== 'body' || data.column.index !== 3) return;
      const status = String(data.cell.raw || '').toLowerCase();
      if (status === 'pago') data.cell.styles.textColor = COLORS.green;
      if (status === 'atrasado') data.cell.styles.textColor = COLORS.red;
    },
  });

  // Cláusulas contratuais
  y = addContentPage(doc);
  y = drawClause(doc, '1. Objeto', [
    `O CREDOR concede ao DEVEDOR um empréstimo no valor principal de ${formatCurrency(loan.amount)}, nas condições registradas neste instrumento.`,
    'O DEVEDOR declara ciência de que os valores, vencimentos e encargos aplicáveis constam no resumo financeiro e no cronograma de pagamentos.',
  ], y);
  y = drawClause(doc, '2. Forma de pagamento', [
    `O pagamento será realizado em ${installmentCount} parcela(s), com frequência ${frequencyLabel.toLowerCase()}, conforme os vencimentos indicados no cronograma.`,
    'Os pagamentos serão reconhecidos após a confirmação e o registro nos controles financeiros do CREDOR.',
  ], y);

  const interestParagraphs = interestType === 'SPLIT'
    ? [
        `A operação utiliza juros divididos à taxa total de ${formatPercent(loan.interestRate)}% ao mês, sendo ${formatPercent(Number(loan.monthlyPaidInterestRate || 0))}% pagos mensalmente e ${formatPercent(Number(loan.monthlyAccruedInterestRate || 0))}% acumulados ao saldo.`,
      ]
    : interestType === 'PRICE'
      ? [
          `A operação utiliza a Tabela PRICE à taxa contratada de ${formatPercent(loan.interestRate)}% por parcela, já refletida nos valores do cronograma.`,
        ]
      : [
          `A operação utiliza juros simples à taxa contratada de ${formatPercent(loan.interestRate)}% sobre o capital, já refletida no valor total do contrato.`,
        ];
  y = drawClause(doc, '3. Juros remuneratórios', interestParagraphs, y);
  y = drawClause(doc, '4. Atraso e inadimplemento', [
    `Em caso de atraso, o saldo vencido ficará sujeito ao encargo de mora de ${formatPercent(dailyLateFeeRate * 100, 3)}% ao dia, calculado pelo sistema sobre o valor remanescente da parcela.`,
    'O inadimplemento poderá motivar cobrança extrajudicial ou judicial, observada a legislação aplicável.',
  ], y);
  y = drawClause(doc, '5. Liquidação antecipada', [
    'O DEVEDOR poderá solicitar a liquidação antecipada do saldo. Eventual desconto será calculado conforme o tipo de juros do contrato e o saldo efetivamente pendente na data da solicitação.',
  ], y);
  y = drawClause(doc, '6. Comunicações e cobrança', [
    'O DEVEDOR autoriza o envio de avisos de vencimento e cobranças pelos meios de contato cadastrados, incluindo telefone, WhatsApp e e-mail.',
  ], y);
  y = drawClause(doc, '7. Registros financeiros', [
    'Pagamentos, abatimentos, renovações, descontos e eventuais estornos serão reconhecidos quando registrados nos controles financeiros do CREDOR.',
    'Este documento reflete os dados cadastrados no sistema na data de sua emissão.',
  ], y);
  y = drawClause(doc, '8. Foro', [
    'Fica eleito o foro legalmente competente para dirimir questões decorrentes deste contrato, respeitadas as normas de competência aplicáveis.',
  ], y);

  // Assinaturas
  y = addContentPage(doc);
  y = drawSectionTitle(doc, 'Assinaturas', y);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10.5);
  doc.setTextColor(...COLORS.slate);
  doc.text(
    'Por estarem de acordo, as partes firmam o presente instrumento na data indicada abaixo.',
    MARGIN,
    y + 4,
  );

  drawSignature(doc, 73, CREDITOR_NAME, 'Credor');
  drawSignature(doc, 112, customerName, 'Devedor');
  drawSignature(doc, 164, 'Nome e CPF', 'Testemunha 1');
  drawSignature(doc, 203, 'Nome e CPF', 'Testemunha 2');

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(...COLORS.slate);
  doc.text('Data: ____/____/________', MARGIN, 260);

  drawPageFooters(doc, contractNumber, customerName);
  return doc;
};

export const generateContractPDF = (
  customer: Customer,
  loan: Loan,
  options: ContractPdfOptions = {},
) => {
  const doc = buildContractPDFDocument(customer, loan, options);
  const contractNumber = normalizeText(loan.contractNumber || loan.id, 'Sem_numero');
  const safeCustomerName = normalizeText(customer.name, 'Cliente').replace(/[^\w\-]+/g, '_');
  doc.save(`Contrato_${contractNumber}_${safeCustomerName}.pdf`);
};
