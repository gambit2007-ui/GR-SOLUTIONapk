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
  const titleLines = doc.splitTextToSize(title, CONTENT_WIDTH - 5) as string[];
  const titleHeight = Math.max(8, titleLines.length * 5);
  let y = ensureSpace(doc, startY, titleHeight + 10);

  doc.setFillColor(...COLORS.gold);
  doc.rect(MARGIN, y - 4.5, 1.8, titleHeight, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11.5);
  doc.setTextColor(...COLORS.navy);
  doc.text(titleLines, MARGIN + 5, y);
  y += titleLines.length * 5 + 4;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.6);
  doc.setTextColor(...COLORS.slate);

  paragraphs.forEach((paragraph) => {
    let remainingLines = doc.splitTextToSize(paragraph, CONTENT_WIDTH) as string[];

    while (remainingLines.length > 0) {
      if (y + 5 > PAGE_BOTTOM) y = addContentPage(doc);

      const availableLineCount = Math.max(1, Math.floor((PAGE_BOTTOM - y) / 4.7));
      const pageLines = remainingLines.slice(0, availableLineCount);
      doc.text(pageLines, MARGIN, y);
      y += pageLines.length * 4.7;
      remainingLines = remainingLines.slice(pageLines.length);

      if (remainingLines.length > 0) y = addContentPage(doc);
    }

    y += 3;
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

const drawGuaranteeAnnex = (doc: jsPDF) => {
  let y = addContentPage(doc);
  y = drawSectionTitle(doc, 'Anexo 1 - Garantias da operação', y);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  doc.setTextColor(...COLORS.slate);
  const guidance = doc.splitTextToSize(
    'Preencher e assinar este anexo somente quando houver garantia ou avalista vinculado à operação. Campos não preenchidos não constituem garantia.',
    CONTENT_WIDTH,
  ) as string[];
  doc.text(guidance, MARGIN, y);
  y += guidance.length * 4.7 + 5;

  autoTable(doc, {
    startY: y,
    margin: { left: MARGIN, right: MARGIN },
    head: [['Selecionar', 'Modalidade de garantia']],
    body: [
      ['[ ]', 'Aval'],
      ['[ ]', 'Fiança'],
      ['[ ]', 'Alienação fiduciária de veículo'],
      ['[ ]', 'Caução'],
      ['[ ]', 'Penhor'],
      ['[ ]', 'Cessão fiduciária de recebíveis'],
      ['[ ]', 'Outra: ________________________________________________'],
    ],
    theme: 'grid',
    styles: { font: 'helvetica', fontSize: 9, textColor: COLORS.slate, cellPadding: 2.8 },
    headStyles: { fillColor: COLORS.navy, textColor: COLORS.white, fontStyle: 'bold' },
    alternateRowStyles: { fillColor: COLORS.surface },
    columnStyles: { 0: { cellWidth: 28, halign: 'center' }, 1: { cellWidth: 148 } },
  });

  y = Number((doc as jsPDF & { lastAutoTable?: { finalY?: number } }).lastAutoTable?.finalY || y) + 8;
  y = drawSectionTitle(doc, 'Dados da garantia', y);
  autoTable(doc, {
    startY: y,
    margin: { left: MARGIN, right: MARGIN },
    body: [
      ['Descrição', '____________________________________________________________'],
      ['Valor estimado', 'R$ ______________________________'],
      ['Observações', '____________________________________________________________'],
    ],
    theme: 'grid',
    styles: { font: 'helvetica', fontSize: 8.8, textColor: COLORS.slate, cellPadding: 2.4 },
    columnStyles: {
      0: { cellWidth: 38, fontStyle: 'bold', fillColor: COLORS.surface },
      1: { cellWidth: 138 },
    },
  });

  y = Number((doc as jsPDF & { lastAutoTable?: { finalY?: number } }).lastAutoTable?.finalY || y) + 8;
  y = drawSectionTitle(doc, 'Avalista ou fiador (quando houver)', y);
  autoTable(doc, {
    startY: y,
    margin: { left: MARGIN, right: MARGIN },
    body: [
      ['Nome completo', '____________________________________________________________'],
      ['CPF/MF', '______________________________'],
      ['RG', '______________________________'],
      ['Estado civil', '______________________________'],
      ['Telefone', '______________________________'],
      ['Endereço', '____________________________________________________________'],
    ],
    theme: 'grid',
    styles: { font: 'helvetica', fontSize: 8.8, textColor: COLORS.slate, cellPadding: 2.2 },
    columnStyles: {
      0: { cellWidth: 38, fontStyle: 'bold', fillColor: COLORS.surface },
      1: { cellWidth: 138 },
    },
  });

  y = Number((doc as jsPDF & { lastAutoTable?: { finalY?: number } }).lastAutoTable?.finalY || y) + 15;
  y = ensureSpace(doc, y, 20);
  drawSignature(doc, y, 'Nome e CPF', 'Avalista ou fiador');
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
    title: `Contrato de mútuo civil ${contractNumber}`,
    subject: `Contrato particular de mútuo civil com confissão de dívida - ${customerName}`,
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
  const coverTitle = doc.splitTextToSize(
    'Contrato particular de mútuo civil com confissão de dívida',
    CONTENT_WIDTH,
  ) as string[];
  doc.text(coverTitle, MARGIN, 83);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(13);
  doc.setTextColor(192, 203, 219);
  doc.text('Constituição de título executivo extrajudicial e outras avenças', MARGIN, 113);
  doc.text(`${formatCurrency(loan.amount)}  |  ${customerName}`, MARGIN, 130);

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

  y = Number((doc as jsPDF & { lastAutoTable?: { finalY?: number } }).lastAutoTable?.finalY || y) + 10;

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

  // Cláusulas contratuais baseadas no modelo jurídico fornecido pela empresa.
  y = ensureSpace(doc, y, 35);
  y = drawClause(doc, 'Instrumento contratual', [
    `Pelo presente instrumento particular, de um lado, ${CREDITOR_NAME}, inscrita no CNPJ sob o nº ${formatDocument(CREDITOR_DOCUMENT)}, doravante denominada CREDOR, e, de outro lado, ${customerName}, inscrito(a) no CPF/CNPJ sob o nº ${formatDocument(customer.cpf)}, doravante denominado(a) DEVEDOR, resolvem celebrar o presente CONTRATO PARTICULAR DE MÚTUO CIVIL COM CONFISSÃO DE DÍVIDA.`,
    'Este contrato será regido pelos artigos 586 e seguintes, 389, 394, 395 e 397 do Código Civil, pelo artigo 784, inciso III, do Código de Processo Civil, e pelas cláusulas e condições seguintes.',
  ], y);

  const contractClauses: Array<{ title: string; paragraphs: string[] }> = [
    {
      title: 'I. Cláusula Primeira - Do objeto',
      paragraphs: [
        `Constitui objeto deste contrato a concessão de mútuo financeiro pelo CREDOR ao DEVEDOR, mediante a entrega da quantia principal de ${formatCurrency(loan.amount)}, obrigando-se o DEVEDOR a restituí-la acrescida dos encargos expressamente pactuados neste instrumento.`,
        'Parágrafo Primeiro. O valor mutuado será disponibilizado mediante PIX, TED, transferência bancária ou outro meio eletrônico que permita identificar a operação, constituindo o respectivo comprovante prova suficiente da liberação dos recursos.',
        'Parágrafo Segundo. O DEVEDOR declara que recebeu ou receberá integralmente o valor objeto deste contrato, dando quitação quanto ao recebimento após a efetiva disponibilização dos recursos.',
        'Parágrafo Terceiro. A entrega dos recursos caracteriza a tradição do mútuo, passando a obrigação de restituição a produzir todos os seus efeitos legais e contratuais.',
      ],
    },
    {
      title: 'II. Cláusula Segunda - Da licitude da operação',
      paragraphs: [
        'O DEVEDOR declara expressamente que contrata a operação por sua livre e espontânea vontade; possui capacidade civil para assumir a obrigação; compreendeu as cláusulas; teve oportunidade de esclarecer dúvidas; e reconhece que os recursos possuem origem lícita e serão utilizados para finalidade igualmente lícita.',
      ],
    },
    {
      title: 'III. Cláusula Terceira - Do valor, dos encargos remuneratórios e da forma de pagamento',
      paragraphs: [
        `O valor principal corresponde a ${formatCurrency(loan.amount)} e o valor total previsto para pagamento corresponde a ${formatCurrency(totalToReturn)}.`,
        ...interestParagraphs,
        `O pagamento ocorrerá em ${installmentCount} parcela(s), com frequência ${frequencyLabel.toLowerCase()}, nos vencimentos e valores individualizados no cronograma deste contrato.`,
        'Parágrafo Primeiro. Os valores das parcelas já contemplam os juros remuneratórios pactuados, inexistindo cobrança oculta.',
        'Parágrafo Segundo. Os pagamentos deverão ser efetuados por PIX, TED, depósito identificado ou outro meio indicado pelo CREDOR.',
        'Parágrafo Terceiro. A obrigação somente será considerada quitada após a efetiva compensação financeira do pagamento. O simples envio de comprovante não implica quitação caso o crédito não seja recebido.',
      ],
    },
    {
      title: 'IV. Cláusula Quarta - Da imputação dos pagamentos',
      paragraphs: [
        'Os pagamentos serão imputados aos componentes financeiros vinculados à obrigação, considerando primeiro os encargos vencidos efetivamente registrados e, em seguida, os juros remuneratórios e o principal da parcela, conforme a composição financeira do contrato.',
        'Parágrafo Primeiro. O recebimento parcial não importará quitação integral, permanecendo exigível o saldo remanescente e os encargos incidentes.',
        'Parágrafo Segundo. Pagamentos recebidos após o vencimento não implicam novação, renúncia, remissão ou alteração das condições pactuadas.',
        'Parágrafo Terceiro. Eventual tolerância do CREDOR quanto ao recebimento em atraso constituirá mera liberalidade e não modificará as condições deste contrato.',
      ],
    },
    {
      title: 'V. Cláusula Quinta - Dos encargos moratórios e do inadimplemento',
      paragraphs: [
        'O não pagamento, total ou parcial, de obrigação prevista neste contrato constituirá automaticamente o DEVEDOR em mora, independentemente de interpelação judicial ou extrajudicial.',
        `Sobre o saldo remanescente de cada parcela vencida incidirá encargo de mora de ${formatPercent(dailyLateFeeRate * 100, 3)}% ao dia, calculado pelo sistema até a efetiva liquidação.`,
        'Despesas de cobrança, custas e honorários somente poderão ser exigidos quando efetivamente incorridos e admitidos pela legislação aplicável, sem alterar retroativamente os valores registrados no sistema.',
        'O inadimplemento de uma parcela não antecipa os encargos de mora das demais parcelas ainda não vencidas.',
        'Permanecendo o inadimplemento, o CREDOR poderá adotar as medidas extrajudiciais e judiciais legalmente cabíveis, inclusive protesto, negativação e execução deste instrumento.',
      ],
    },
    {
      title: 'VI. Cláusula Sexta - Das despesas de cobrança',
      paragraphs: [
        'As despesas comprovadamente necessárias à recuperação do crédito, incluindo custas cartorárias, protesto, notificações, registros, localização patrimonial, custas judiciais e honorários legalmente exigíveis, poderão ser suportadas pelo DEVEDOR nos limites da legislação aplicável.',
        'Parágrafo único. Honorários contratuais eventualmente exigíveis não se confundem com honorários sucumbenciais fixados pelo Poder Judiciário.',
      ],
    },
    {
      title: 'VII. Cláusula Sétima - Do vencimento antecipado',
      paragraphs: [
        'Independentemente de aviso prévio, poderá ser considerado antecipadamente vencido o saldo exigível caso ocorra: atraso superior a 15 dias; descumprimento contratual; informação falsa ou omissão relevante; insolvência civil; fraude contra credores; gravame judicial que comprometa a solvência; falecimento, observadas as regras legais; inadimplemento de garantia; ou ato que coloque em risco a satisfação do crédito.',
        'Parágrafo Primeiro. Declarado o vencimento antecipado, tornar-se-á exigível o saldo devedor, acrescido apenas dos encargos legal e contratualmente aplicáveis.',
        'Parágrafo Segundo. O vencimento antecipado não impede a adoção simultânea das medidas de cobrança previstas neste instrumento.',
      ],
    },
    {
      title: 'VIII. Cláusula Oitava - Da confissão irrevogável da dívida e do título executivo extrajudicial',
      paragraphs: [
        'O DEVEDOR reconhece que a obrigação assumida é líquida, certa e exigível, confessando, de forma livre e irrevogável, ser devedor da quantia apurada na forma deste instrumento.',
        'A confissão é realizada de forma consciente, sem vício de consentimento, e o presente instrumento, quando assinado pelo DEVEDOR e por duas testemunhas, constitui título executivo extrajudicial nos termos do artigo 784, inciso III, do Código de Processo Civil.',
        'O DEVEDOR declara ter recebido uma via, compreendido o conteúdo e reconhece que renegociação, recebimento parcial, prazo adicional ou tolerância não importam novação da dívida.',
      ],
    },
    {
      title: 'IX. Cláusula Nona - Das garantias da operação',
      paragraphs: [
        'O cumprimento das obrigações poderá ser garantido por aval, fiança, alienação fiduciária, cessão fiduciária, caução, penhor ou outra garantia legalmente admitida, desde que expressamente identificada e assinada no Anexo 1.',
        'Parágrafo Primeiro. A ausência de preenchimento e assinatura do Anexo 1 significa que não há garantia específica constituída por este documento, sem afastar a responsabilidade patrimonial do DEVEDOR nos limites legais.',
        'Parágrafo Segundo. Garantias constituídas permanecerão válidas até a quitação integral, e eventual substituição ou complementação deverá ser formalizada por escrito.',
      ],
    },
    {
      title: 'X. Cláusula Décima - Do avalista ou devedor solidário (quando houver)',
      paragraphs: [
        'Esta cláusula somente se aplica quando houver avalista ou devedor solidário devidamente identificado e signatário no Anexo 1. Nessa hipótese, ele responderá solidariamente pelas obrigações garantidas, nos limites indicados no anexo e na legislação.',
        'A concessão de prazo, renegociação, parcelamento ou tolerância não exonerará o avalista quando sua anuência for dispensada por lei ou tiver sido expressamente formalizada.',
      ],
    },
    {
      title: 'XI. Cláusula Décima Primeira - Da cessão do crédito',
      paragraphs: [
        'O CREDOR poderá ceder ou transferir, total ou parcialmente, os créditos decorrentes deste contrato, independentemente de autorização prévia do DEVEDOR.',
        'A cessão produzirá efeitos perante o DEVEDOR após sua regular comunicação, quando exigida pela legislação, e não alterará as condições originalmente pactuadas.',
      ],
    },
    {
      title: 'XII. Cláusula Décima Segunda - Do protesto, da cobrança e dos órgãos de proteção ao crédito',
      paragraphs: [
        'Caracterizado o inadimplemento, o CREDOR poderá promover protesto, encaminhar o débito aos órgãos de proteção ao crédito, realizar cobrança administrativa ou judicial, executar este título e requerer medidas legalmente admitidas.',
        'As despesas comprovadas decorrentes dessas medidas poderão ser suportadas pelo DEVEDOR nos limites legais. A adoção de uma medida não impedirá a utilização simultânea de outras.',
      ],
    },
    {
      title: 'XIII. Cláusula Décima Terceira - Das comunicações entre as partes',
      paragraphs: [
        'As comunicações poderão ser realizadas por carta, notificação extrajudicial, e-mail, WhatsApp, SMS ou outro meio idôneo capaz de comprovar o envio ou a disponibilização.',
        'Presumir-se-ão válidas as comunicações encaminhadas aos endereços, telefones e e-mails informados pelo DEVEDOR. Recusa, ausência de resposta, bloqueio ou dado desatualizado não invalidará comunicação regularmente encaminhada.',
        'Registros de mensagens eletrônicas poderão ser utilizados como meio de prova, observadas as regras legais de admissibilidade.',
      ],
    },
    {
      title: 'XIV. Cláusula Décima Quarta - Da atualização cadastral',
      paragraphs: [
        'O DEVEDOR obriga-se a manter atualizados seu endereço residencial, telefone, e-mail, estado civil quando relevante e demais informações necessárias à correta identificação das partes.',
        'Qualquer alteração deverá ser comunicada ao CREDOR no prazo máximo de cinco dias úteis. A ausência de comunicação implicará presunção de validade das notificações encaminhadas aos dados constantes deste contrato.',
      ],
    },
    {
      title: 'XV. Cláusula Décima Quinta - Do tratamento de dados pessoais',
      paragraphs: [
        'Os dados pessoais fornecidos serão tratados para formalização e execução da operação, análise cadastral e de risco, registros fiscais e contábeis, cobrança, recuperação de crédito, cumprimento de obrigações legais, prevenção à fraude e proteção do crédito, observada a Lei nº 13.709/2018 (LGPD).',
        'Quando necessário, os dados poderão ser compartilhados com escritórios de advocacia, empresas de cobrança, cartórios, órgãos de proteção ao crédito, instituições responsáveis pela liquidação dos pagamentos e autoridades públicas.',
        'O tratamento limitar-se-á ao período necessário às finalidades contratuais e aos prazos legais de guarda.',
      ],
    },
    {
      title: 'XVI. Cláusula Décima Sexta - Das assinaturas eletrônicas',
      paragraphs: [
        'As partes reconhecem a validade jurídica das assinaturas eletrônicas apostas neste contrato, inclusive por certificado ICP-Brasil, Gov.br, Clicksign, DocuSign ou plataforma capaz de comprovar autoria, integridade e autenticidade.',
        'O contrato poderá ser celebrado em meio físico ou eletrônico, produzindo os efeitos legalmente cabíveis, desde que preservados os requisitos de autenticidade e integridade.',
      ],
    },
    {
      title: 'XVII. Cláusula Décima Sétima - Da ausência de novação e da integralidade das obrigações',
      paragraphs: [
        'Recebimento parcial, prazo adicional, renegociação, parcelamento, tolerância ou liberalidade não importarão novação, remissão, transação, renúncia de direitos ou alteração das obrigações.',
        'Garantias eventualmente formalizadas permanecerão válidas, salvo manifestação escrita em contrário. A nulidade de uma disposição não prejudicará as demais, e a tolerância não impedirá o exercício futuro de direitos.',
      ],
    },
    {
      title: 'XVIII. Cláusula Décima Oitava - Das disposições gerais',
      paragraphs: [
        'Este contrato obriga as partes, seus herdeiros e sucessores. Constitui a integral manifestação de vontade quanto ao seu objeto e substitui entendimentos anteriores.',
        'Qualquer alteração somente produzirá efeitos mediante instrumento escrito e assinado, ressalvadas as hipóteses legais e os registros operacionais de pagamento, abatimento, renovação ou estorno realizados no sistema.',
        'O DEVEDOR declara que recebeu uma via antes da assinatura, leu todas as cláusulas, compreendeu seu conteúdo e teve oportunidade de esclarecer dúvidas.',
      ],
    },
    {
      title: 'XIX. Cláusula Décima Nona - Do foro',
      paragraphs: [
        'Fica eleito o foro legalmente competente para dirimir controvérsias decorrentes deste instrumento, respeitadas as normas de competência aplicáveis.',
        'A eleição não impede a adoção de medidas no foro do domicílio do DEVEDOR ou em outro foro competente na forma da legislação processual.',
      ],
    },
    {
      title: 'XX. Cláusula Vigésima - Das declarações finais',
      paragraphs: [
        'O DEVEDOR declara que recebeu previamente uma via; leu e compreendeu todas as cláusulas; teve oportunidade de esclarecer dúvidas; contratou de forma livre e consciente; confirma a veracidade das informações prestadas; e compromete-se a cumprir as obrigações assumidas.',
        'As partes reconhecem que este contrato foi celebrado conforme os princípios da boa-fé objetiva, autonomia privada, equilíbrio contratual e função social do contrato.',
      ],
    },
  ];

  contractClauses.forEach((clause) => {
    y = drawClause(doc, clause.title, clause.paragraphs, y);
  });

  // Assinaturas
  y = addContentPage(doc);
  y = drawSectionTitle(doc, 'Assinaturas', y);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10.5);
  doc.setTextColor(...COLORS.slate);
  const signatureIntroduction = doc.splitTextToSize(
    'Por estarem justas e contratadas, as partes firmam este instrumento, juntamente com duas testemunhas, para que produza seus efeitos legais.',
    CONTENT_WIDTH,
  ) as string[];
  doc.text(signatureIntroduction, MARGIN, y + 4);

  drawSignature(doc, 73, CREDITOR_NAME, 'Credor');
  drawSignature(doc, 112, customerName, 'Devedor');
  drawSignature(doc, 164, 'Nome e CPF', 'Testemunha 1');
  drawSignature(doc, 203, 'Nome e CPF', 'Testemunha 2');

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(...COLORS.slate);
  doc.text('Data: ____/____/________', MARGIN, 260);

  drawGuaranteeAnnex(doc);
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
