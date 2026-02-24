import jsPDF from 'jspdf';
import 'jspdf-autotable';
import { Customer, Loan } from '../types';

export const generateContractPDF = (customer: Customer, loan: Loan) => {
  const doc = new jsPDF();
  const date = new Date().toLocaleDateString('pt-BR');

  // Cabeçalho
  doc.setFontSize(20);
  doc.setTextColor(191, 149, 63); // Dourado GR Solution
  doc.text('GR SOLUTION - CONTRATO DE EMPRÉSTIMO', 105, 20, { align: 'center' });

  doc.setFontSize(10);
  doc.setTextColor(0, 0, 0);
  doc.text(`ID do Contrato: ${loan.id}`, 20, 35);
  doc.text(`Data de Emissão: ${date}`, 20, 40);

  // 1. Dados do Cliente
  doc.setFontSize(14);
  doc.text('1. DADOS DO DEVEDOR', 20, 55);
  doc.setFontSize(10);
  doc.text(`Nome: ${customer.name}`, 20, 65);
  doc.text(`CPF: ${customer.cpf || 'Não informado'}`, 20, 70);
  doc.text(`Telefone: ${customer.phone || 'Não informado'}`, 20, 75);

  // 2. Detalhes do Crédito
  doc.setFontSize(14);
  doc.text('2. DETALHES DO CRÉDITO', 20, 90);
  doc.setFontSize(10);
  doc.text(`Valor Financiado: R$ ${loan.amount.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`, 20, 100);
  doc.text(`Taxa de Juros: ${loan.interestRate}% ao mês`, 20, 105);
  doc.text(`Total a Pagar: R$ ${loan.totalToPay.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`, 20, 110);
  doc.text(`Número de Parcelas: ${loan.installments}`, 20, 115);

  // 3. Tabela de Parcelas (Simulação de Datas)
  // Como o Loan básico não tem as datas de todas as parcelas, geramos uma lista visual
  const installmentValue = loan.totalToPay / loan.installments;
  const tableRows = Array.from({ length: loan.installments }).map((_, i) => [
    i + 1,
    `R$ ${installmentValue.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`,
    'Mensal'
  ]);

  (doc as any).autoTable({
    startY: 125,
    head: [['Parcela', 'Valor da Parcela', 'Periodicidade']],
    body: tableRows,
    theme: 'grid',
    headStyles: { fillStyle: [191, 149, 63] }
  });

  // Assinaturas
  const finalY = (doc as any).lastAutoTable.cursor.y + 40;
  doc.line(20, finalY, 90, finalY);
  doc.text('Assinatura do Credor', 40, finalY + 5);
  
  doc.line(120, finalY, 190, finalY);
  doc.text('Assinatura do Devedor', 140, finalY + 5);

  // Download
  doc.save(`Contrato_GR_${customer.name.replace(/\s+/g, '_')}.pdf`);
};