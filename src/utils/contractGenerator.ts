
import { jsPDF } from 'jspdf';
import { Customer, Loan } from '../../types';

export const generateContractPDF = (customer: Customer, loan: Loan) => {
  const doc = new jsPDF();
  const margin = 20;
  let y = 20;

  const checkPage = (height: number) => {
    if (y + height > 280) {
      doc.addPage();
      y = 20;
    }
  };

  // 1. Title
  doc.setFontSize(14);
  doc.setFont('helvetica', 'bold');
  doc.text('CONTRATO PARTICULAR DE EMPRÉSTIMO DE DINHEIRO', 105, y, { align: 'center' });
  y += 15;

  // 2 & 3. Number and Date
  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.text(`Número do Contrato: ${loan.contractNumber}`, margin, y);
  y += 6;
  doc.text(`Data: ${new Date(loan.createdAt).toLocaleDateString('pt-BR')}`, margin, y);
  y += 12;

  // 4. Identification of Parties
  doc.setFont('helvetica', 'bold');
  doc.text('IDENTIFICAÇÃO DAS PARTES', margin, y);
  y += 8;

  // 5. Creditor
  doc.setFont('helvetica', 'bold');
  doc.text('CREDOR:', margin, y);
  y += 6;
  doc.setFont('helvetica', 'normal');
  doc.text('Nome: GR SOLUTION', margin, y);
  y += 5;
  doc.text('CPF/CNPJ: ', margin, y);
  y += 5;
  doc.text('RG: ', margin, y);
  y += 5;
  doc.text('Endereço: ', margin, y);
  y += 5;
  doc.text('Telefone: 021967519287', margin, y);
  y += 5;
  doc.text('E-mail: ', margin, y);
  y += 10;

  // 6-10. Debtor
  doc.setFont('helvetica', 'bold');
  doc.text('DEVEDOR:', margin, y);
  y += 6;
  doc.setFont('helvetica', 'normal');
  doc.text(`Nome: ${customer.name}`, margin, y);
  y += 5;
  doc.text(`CPF/CNPJ: ${customer.cpf}`, margin, y);
  y += 5;
  doc.text(`RG: ${customer.rg || '[NÃO INFORMADO]'}`, margin, y);
  y += 5;
  const addressLines = doc.splitTextToSize(`Endereço: ${customer.address || '[NÃO INFORMADO]'}`, 170);
  doc.text(addressLines, margin, y);
  y += addressLines.length * 5;
  doc.text(`Telefone: ${customer.phone}`, margin, y);
  y += 5;
  doc.text(`E-mail: ${customer.email}`, margin, y);
  y += 15;

  // 12. Clause 1
  checkPage(30);
  doc.setFont('helvetica', 'bold');
  doc.text('CLÁUSULA 1ª - DO OBJETO', margin, y);
  y += 7;
  doc.setFont('helvetica', 'normal');
  const objText = `1. O presente contrato tem como objeto o empréstimo da quantia de ${loan.amount.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}, que o CREDOR entrega ao DEVEDOR na data ${new Date(loan.createdAt).toLocaleDateString('pt-BR')} por meio de transferência bancária, PIX ou dinheiro em espécie.`;
  const objLines = doc.splitTextToSize(objText, 170);
  doc.text(objLines, margin, y);
  y += objLines.length * 5 + 10;

  // 13-14. Clause 2
  checkPage(40);
  doc.setFont('helvetica', 'bold');
  doc.text('CLÁUSULA 2ª - DO PRAZO E FORMA DE PAGAMENTO', margin, y);
  y += 7;
  doc.setFont('helvetica', 'normal');
  const paymentText = `O valor emprestado deverá ser restituído pelo DEVEDOR em ${loan.installmentCount} parcelas de ${loan.installmentValue.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })} com vencimentos ${loan.frequency.toLowerCase()} iniciando em: ${loan.dueDate.split('-').reverse().join('/')}.\n\nO pagamento deverá ser realizado via: (PIX, transferência, etc.) para a conta: GR SOLUTION`;
  const paymentLines = doc.splitTextToSize(paymentText, 170);
  doc.text(paymentLines, margin, y);
  y += paymentLines.length * 5 + 10;

  // 15-16. Clause 3
  checkPage(20);
  doc.setFont('helvetica', 'bold');
  doc.text('CLÁUSULA 3ª - DOS JUROS E ENCARGOS', margin, y);
  y += 7;
  doc.setFont('helvetica', 'normal');
  doc.text(`Sobre o valor emprestado incidirão juros remuneratórios de ${loan.interestRate}% fixo, calculados até a data do efetivo pagamento.`, margin, y);
  y += 12;

  // 17-18. Clause 4
  checkPage(35);
  doc.setFont('helvetica', 'bold');
  doc.text('CLÁUSULA 4ª - DO ATRASO E PENALIDADES', margin, y);
  y += 7;
  doc.setFont('helvetica', 'normal');
  doc.text('Em caso de atraso no pagamento, incidirão cumulativamente:', margin, y);
  y += 6;
  doc.text('a) Juros de mora de 1,5% ao dia;', margin + 5, y);
  y += 5;
  doc.text('b) Multa de 2% sobre o valor em atraso;', margin + 5, y);
  y += 5;
  doc.text('c) Correção monetária com base no índice IPCA.', margin + 5, y);
  y += 12;

  // 19-20. Clause 5
  checkPage(25);
  doc.setFont('helvetica', 'bold');
  doc.text('CLÁUSULA 5ª - DO VENCIMENTO ANTECIPADO', margin, y);
  y += 7;
  doc.setFont('helvetica', 'normal');
  const c5Text = 'O não pagamento na data acordada acarretará o vencimento antecipado da dívida, podendo o CREDOR exigir o pagamento imediato do valor total devido, acrescido dos encargos.';
  const c5Lines = doc.splitTextToSize(c5Text, 170);
  doc.text(c5Lines, margin, y);
  y += c5Lines.length * 5 + 10;

  // 21-22. Clause 6
  checkPage(25);
  doc.setFont('helvetica', 'bold');
  doc.text('CLÁUSULA 6ª - DA CONFISSÃO DE DÍVIDA', margin, y);
  y += 7;
  doc.setFont('helvetica', 'normal');
  const c6Text = 'O DEVEDOR reconhece expressamente o débito ora contraído, obrigando-se a quitá-lo nos termos deste contrato, sob pena de execução judicial.';
  const c6Lines = doc.splitTextToSize(c6Text, 170);
  doc.text(c6Lines, margin, y);
  y += c6Lines.length * 5 + 10;

  // 25-26. Clause 7
  checkPage(25);
  doc.setFont('helvetica', 'bold');
  doc.text('CLÁUSULA 7ª - DO FORO', margin, y);
  y += 7;
  doc.setFont('helvetica', 'normal');
  const c8Text = 'Fica eleito o foro da comarca de Araxá, MG com renúncia a qualquer outro, por mais privilegiado que seja, para dirimir dúvidas oriundas deste contrato.';
  const c8Lines = doc.splitTextToSize(c8Text, 170);
  doc.text(c8Lines, margin, y);
  y += c8Lines.length * 5 + 15;

  // 27. Local and date
  checkPage(15);
  doc.text(`Local e data: Araxá, MG, ${new Date().toLocaleDateString('pt-BR')}`, margin, y);
  y += 25;

  // 28-29. Signatures
  checkPage(40);
  doc.line(margin, y, margin + 70, y);
  doc.line(120, y, 190, y);
  y += 5;
  doc.setFont('helvetica', 'bold');
  doc.text('CREDOR:', margin, y);
  doc.text('DEVEDOR:', 120, y);
  y += 5;
  doc.setFont('helvetica', 'normal');
  doc.text('Assinatura: GR SOLUTION', margin, y);
  doc.text(`Assinatura: ___________________________`, 120, y);
  y += 25;

  // 30-32. Witnesses
  checkPage(40);
  doc.setFont('helvetica', 'bold');
  doc.text('TESTEMUNHAS:', margin, y);
  y += 15;
  doc.line(margin, y, margin + 70, y);
  doc.line(120, y, 190, y);
  y += 5;
  doc.setFontSize(8);
  doc.text('1. Nome: ____________________', margin, y);
  doc.text('2. Nome: ____________________', 120, y);
  y += 5;
  doc.text('CPF: _______________________', margin, y);
  doc.text('CPF: _______________________', 120, y);

  // Save
  doc.save(`Contrato_${loan.contractNumber}_${customer.name.replace(/\s+/g, '_')}.pdf`);
};
