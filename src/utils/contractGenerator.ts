import { jsPDF } from 'jspdf';
import { Customer, Loan } from '../types';

const formatCurrency = (value: number) =>
  Number(value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const toDate = (value: unknown): Date | null => {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === 'number' || typeof value === 'string') {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  if (typeof value === 'object' && value !== null && typeof (value as any).toDate === 'function') {
    try {
      const parsed = (value as any).toDate();
      return parsed instanceof Date && !Number.isNaN(parsed.getTime()) ? parsed : null;
    } catch {
      return null;
    }
  }
  return null;
};

const formatDateBR = (value: unknown, fallback = '--/--/----') => {
  const date = toDate(value);
  return date ? date.toLocaleDateString('pt-BR') : fallback;
};

const normalizeText = (value: unknown, fallback = '[NAO INFORMADO]') => {
  const text = String(value ?? '').trim();
  return text.length > 0 ? text : fallback;
};

export const generateContractPDF = (customer: Customer, loan: Loan) => {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const margin = 18;
  const usableWidth = 174;
  const lineHeight = 5;
  const pageBottom = 280;
  let y = 20;

  const ensureSpace = (heightNeeded: number) => {
    if (y + heightNeeded > pageBottom) {
      doc.addPage();
      y = 20;
    }
  };

  const writeParagraph = (text: string, spaceAfter = 6) => {
    const lines = doc.splitTextToSize(text, usableWidth);
    ensureSpace(lines.length * lineHeight + spaceAfter);
    doc.text(lines, margin, y);
    y += lines.length * lineHeight + spaceAfter;
  };

  const contractNumber = normalizeText((loan as any).contractNumber || loan.id, 'SEM_NUMERO');
  const createdAt = (loan as any).createdAt || new Date();
  const installmentCount = Number((loan as any).installmentCount || (loan as any).installmentsCount || (loan.installments || []).length || 0);
  const firstInstallment = Array.isArray(loan.installments) ? loan.installments[0] : undefined;
  const installmentValue = Number((loan as any).installmentValue ?? firstInstallment?.amount ?? firstInstallment?.value ?? 0);
  const totalToReturn = Number(
    (loan as any).totalToReturn ??
    (installmentCount > 0 ? installmentValue * installmentCount : 0),
  );
  const startDate = formatDateBR((loan as any).startDate || createdAt);
  const firstDueDate = formatDateBR(firstInstallment?.dueDate || (loan as any).dueDate);
  const customerName = normalizeText(customer.name);
  const customerCpf = normalizeText(customer.cpf);
  const customerRg = normalizeText(customer.rg);
  const customerPhone = normalizeText(customer.phone);
  const customerAddress = normalizeText(customer.address);
  const customerEmail = normalizeText(customer.email);
  const interestRate = Number(loan.interestRate || 0);

  const normalizeInterestType = (value: unknown): 'SIMPLE' | 'PRICE' | 'SPLIT' => {
    const normalized = String(value || '').trim().toUpperCase();
    if (normalized === 'PRICE') return 'PRICE';
    if (normalized === 'SPLIT' || normalized === 'PERSONALIZADO') return 'SPLIT';
    return 'SIMPLE';
  };

  const interestType = normalizeInterestType((loan as any).interestType);
  const markSimple = interestType === 'SIMPLE' ? 'X' : ' ';
  const markPrice = interestType === 'PRICE' ? 'X' : ' ';
  const markSplit = interestType === 'SPLIT' ? 'X' : ' ';

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.text('CONTRATO PARTICULAR DE EMPRESTIMO DE DINHEIRO', 105, y, { align: 'center' });
  y += 10;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.text(`Numero do contrato: ${contractNumber}`, margin, y);
  y += 5;
  doc.text(`Data: ${formatDateBR(createdAt)}`, margin, y);
  y += 10;

  doc.setFont('helvetica', 'bold');
  doc.text('PARTES', margin, y);
  y += 7;

  doc.setFont('helvetica', 'normal');
  writeParagraph('CREDOR: GR SOLUTION', 4);
  writeParagraph('CPF/CNPJ: [PREENCHER]', 4);
  writeParagraph('Endereco: [PREENCHER]', 4);
  writeParagraph('Telefone: [PREENCHER]', 8);
  writeParagraph('DEVEDOR:', 4);
  writeParagraph(`Nome: ${customerName}`);
  writeParagraph(`CPF: ${customerCpf}`);
  writeParagraph(`RG: ${customerRg}`);
  writeParagraph(`Endereco: ${customerAddress}`);
  writeParagraph(`Telefone: ${customerPhone}`, 10);

  doc.setFont('helvetica', 'bold');
  doc.text('CLAUSULA 1 - OBJETO', margin, y);
  y += 6;
  doc.setFont('helvetica', 'normal');
  writeParagraph(
    `O CREDOR concede ao DEVEDOR um emprestimo no valor de ${formatCurrency(Number(loan.amount || 0))}.`
  );

  doc.setFont('helvetica', 'bold');
  doc.text('CLAUSULA 2 - PAGAMENTO', margin, y);
  y += 6;
  doc.setFont('helvetica', 'normal');
  writeParagraph(`Parcelas: ${installmentCount}`, 4);
  writeParagraph(`Valor: ${formatCurrency(installmentValue)}`, 4);
  writeParagraph(`Vencimento: ${firstDueDate}`, 4);
  writeParagraph(`Total: ${formatCurrency(totalToReturn)}`);

  doc.setFont('helvetica', 'bold');
  doc.text('CLAUSULA 3 - JUROS', margin, y);
  y += 6;
  doc.setFont('helvetica', 'normal');
  writeParagraph(`Taxa: ${interestRate.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 4 })}% ao mes`, 4);
  writeParagraph(`Tipo: (${markSimple}) Simples (${markPrice}) PRICE (${markSplit}) Personalizado`);

  doc.setFont('helvetica', 'bold');
  doc.text('CLAUSULA 4 - ATRASO', margin, y);
  y += 6;
  doc.setFont('helvetica', 'normal');
  writeParagraph('Multa: 2%', 4);
  writeParagraph('Juros de mora: 1,5% ao dia', 4);
  writeParagraph('Correcao monetaria aplicavel');

  doc.setFont('helvetica', 'bold');
  doc.text('CLAUSULA 5 - VENCIMENTO ANTECIPADO', margin, y);
  y += 6;
  doc.setFont('helvetica', 'normal');
  writeParagraph('O nao pagamento implica vencimento antecipado da divida.');

  doc.setFont('helvetica', 'bold');
  doc.text('CLAUSULA 6 - QUITACAO ANTECIPADA', margin, y);
  y += 6;
  doc.setFont('helvetica', 'normal');
  writeParagraph('Pode haver desconto conforme tipo de juros.');

  doc.setFont('helvetica', 'bold');
  doc.text('CLAUSULA 7 - PAGAMENTO', margin, y);
  y += 6;
  doc.setFont('helvetica', 'normal');
  writeParagraph('PIX, transferencia ou dinheiro.');

  doc.setFont('helvetica', 'bold');
  doc.text('CLAUSULA 8 - COBRANCA', margin, y);
  y += 6;
  doc.setFont('helvetica', 'normal');
  writeParagraph('Autorizado envio de cobrancas via WhatsApp, e-mail ou telefone.');

  doc.setFont('helvetica', 'bold');
  doc.text('CLAUSULA 9 - INADIMPLEMENTO', margin, y);
  y += 6;
  doc.setFont('helvetica', 'normal');
  writeParagraph('Pode haver cobranca judicial e negativacao.');

  doc.setFont('helvetica', 'bold');
  doc.text('CLAUSULA 10 - FORO', margin, y);
  y += 6;
  doc.setFont('helvetica', 'normal');
  writeParagraph('Foro: [CIDADE/ESTADO]');

  ensureSpace(40);
  y += 10;
  doc.text(`Data da assinatura: ${formatDateBR(createdAt)}`, margin, y);
  y += 14;

  doc.setFont('helvetica', 'bold');
  doc.text('Assinaturas:', margin, y);
  y += 10;

  doc.line(margin, y, margin + 85, y);
  doc.line(107, y, 192, y);
  y += 5;

  doc.setFont('helvetica', 'normal');
  doc.text('CREDOR', margin, y);
  doc.text('DEVEDOR', 107, y);
  y += 5;
  doc.text('Assinatura: GR SOLUTION', margin, y);
  doc.text(`Assinatura: ${customerName}`, 107, y);
  y += 5;
  doc.text(`E-mail do devedor: ${customerEmail}`, 107, y);

  const safeCustomerName = customerName.replace(/[^\w\-]+/g, '_');
  const filename = `Contrato_${contractNumber}_${safeCustomerName}.pdf`;

  // Apenas download local no navegador (nao salva em banco de dados).
  doc.save(filename);
};
