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
  const startDate = formatDateBR((loan as any).startDate || createdAt);
  const firstDueDate = formatDateBR(firstInstallment?.dueDate || (loan as any).dueDate);
  const frequency = normalizeText((loan as any).frequency || 'MENSAL');
  const customerName = normalizeText(customer.name);
  const customerCpf = normalizeText(customer.cpf);
  const customerRg = normalizeText(customer.rg);
  const customerPhone = normalizeText(customer.phone);
  const customerEmail = normalizeText(customer.email);
  const customerAddress = normalizeText(customer.address);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.text('CONTRATO PARTICULAR DE EMPRESTIMO', 105, y, { align: 'center' });
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

  doc.setFont('helvetica', 'bold');
  doc.text('CREDOR:', margin, y);
  y += 5;
  doc.setFont('helvetica', 'normal');
  writeParagraph('Nome: GR SULTION');
  writeParagraph('CPF/CNPJ: [NAO INFORMADO]');
  writeParagraph('RG: [NAO INFORMADO]');
  writeParagraph('Endereco: [NAO INFORMADO]');
  writeParagraph('Telefone: 021967519287');
  writeParagraph('E-mail: [NAO INFORMADO]', 8);

  doc.setFont('helvetica', 'bold');
  doc.text('DEVEDOR:', margin, y);
  y += 5;
  doc.setFont('helvetica', 'normal');
  writeParagraph(`Nome: ${customerName}`);
  writeParagraph(`CPF/CNPJ: ${customerCpf}`);
  writeParagraph(`RG: ${customerRg}`);
  writeParagraph(`Endereco: ${customerAddress}`);
  writeParagraph(`Telefone: ${customerPhone}`);
  writeParagraph(`E-mail: ${customerEmail}`, 10);

  doc.setFont('helvetica', 'bold');
  doc.text('CLAUSULA 1 - OBJETO', margin, y);
  y += 6;
  doc.setFont('helvetica', 'normal');
  writeParagraph(
    `O CREDOR empresta ao DEVEDOR a quantia de ${formatCurrency(Number(loan.amount || 0))}, nesta data, por meio de PIX, transferencia ou especie.`
  );

  doc.setFont('helvetica', 'bold');
  doc.text('CLAUSULA 2 - PAGAMENTO', margin, y);
  y += 6;
  doc.setFont('helvetica', 'normal');
  writeParagraph(
    `O DEVEDOR pagara ${installmentCount} parcelas de ${formatCurrency(installmentValue)} com frequencia ${frequency.toLowerCase()}, iniciando em ${firstDueDate}.`
  );
  writeParagraph(`Data de inicio do contrato: ${startDate}`);

  doc.setFont('helvetica', 'bold');
  doc.text('CLAUSULA 3 - JUROS', margin, y);
  y += 6;
  doc.setFont('helvetica', 'normal');
  writeParagraph(`Incidira taxa de juros contratada de ${Number(loan.interestRate || 0)}%.`);

  doc.setFont('helvetica', 'bold');
  doc.text('CLAUSULA 4 - ATRASO', margin, y);
  y += 6;
  doc.setFont('helvetica', 'normal');
  writeParagraph(
    'Em caso de atraso, poderao ser aplicados juros e multa conforme regras do contrato e da legislacao vigente.'
  );

  doc.setFont('helvetica', 'bold');
  doc.text('CLAUSULA 5 - FORO', margin, y);
  y += 6;
  doc.setFont('helvetica', 'normal');
  writeParagraph('Fica eleito o foro de Araxa/MG para dirimir eventuais duvidas deste contrato.');

  ensureSpace(40);
  y += 10;
  doc.text(`Local e data: Araxa/MG, ${new Date().toLocaleDateString('pt-BR')}`, margin, y);
  y += 18;

  doc.line(margin, y, margin + 75, y);
  doc.line(117, y, 192, y);
  y += 5;
  doc.setFont('helvetica', 'bold');
  doc.text('CREDOR', margin, y);
  doc.text('DEVEDOR', 117, y);
  y += 5;
  doc.setFont('helvetica', 'normal');
  doc.text('Assinatura: GR SULTION', margin, y);
  doc.text(`Assinatura: ${customerName}`, 117, y);

  const safeCustomerName = customerName.replace(/[^\w\-]+/g, '_');
  const filename = `Contrato_${contractNumber}_${safeCustomerName}.pdf`;

  // Apenas download local no navegador (nao salva em banco de dados).
  doc.save(filename);
};

