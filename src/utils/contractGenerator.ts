
import { jsPDF } from 'jspdf';
import { Customer, Loan } from '../types';

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
  doc.text('CONTRATO PARTICULAR DE EMPRÃ‰STIMO DE DINHEIRO', 105, y, { align: 'center' });
  y += 15;

  // 2 & 3. Number and Date
  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.text(`NÃºmero do Contrato: ${loan.contractNumber}`, margin, y);
  y += 6;
  doc.text(`Data: ${new Date(loan.createdAt).toLocaleDateString('pt-BR')}`, margin, y);
  y += 12;

  // 4. Identification of Parties
  doc.setFont('helvetica', 'bold');
  doc.text('IDENTIFICAÃ‡ÃƒO DAS PARTES', margin, y);
  y += 8;

  // 5. Creditor
  doc.setFont('helvetica', 'bold');
  doc.text('CREDOR:', margin, y);
  y += 6;
  doc.setFont('helvetica', 'normal');
  doc.text('Nome: GR SULTION', margin, y);
  y += 5;
  doc.text('CPF/CNPJ: ', margin, y);
  y += 5;
  doc.text('RG: ', margin, y);
  y += 5;
  doc.text('EndereÃ§o: ', margin, y);
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
  doc.text(`RG: ${customer.rg || '[NÃƒO INFORMADO]'}`, margin, y);
  y += 5;
  const addressLines = doc.splitTextToSize(`EndereÃ§o: ${customer.address || '[NÃƒO INFORMADO]'}`, 170);
  doc.text(addressLines, margin, y);
  y += addressLines.length * 5;
  doc.text(`Telefone: ${customer.phone}`, margin, y);
  y += 5;
  doc.text(`E-mail: ${customer.email}`, margin, y);
  y += 15;

  // 12. Clause 1
  checkPage(30);
  doc.setFont('helvetica', 'bold');
  doc.text('CLÃUSULA 1Âª - DO OBJETO', margin, y);
  y += 7;
  doc.setFont('helvetica', 'normal');
  const objText = `1. O presente contrato tem como objeto o emprÃ©stimo da quantia de ${loan.amount.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}, que o CREDOR entrega ao DEVEDOR na data ${new Date(loan.createdAt).toLocaleDateString('pt-BR')} por meio de transferÃªncia bancÃ¡ria, PIX ou dinheiro em espÃ©cie.`;
  const objLines = doc.splitTextToSize(objText, 170);
  doc.text(objLines, margin, y);
  y += objLines.length * 5 + 10;

  // 13-14. Clause 2
  checkPage(40);
  doc.setFont('helvetica', 'bold');
  doc.text('CLÃUSULA 2Âª - DO PRAZO E FORMA DE PAGAMENTO', margin, y);
  y += 7;
  doc.setFont('helvetica', 'normal');
  const paymentText = `O valor emprestado deverÃ¡ ser restituÃ­do pelo DEVEDOR em ${loan.installmentCount} parcelas de ${loan.installmentValue.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })} com vencimentos ${loan.frequency.toLowerCase()} iniciando em: ${loan.dueDate.split('-').reverse().join('/')}.\n\nO pagamento deverÃ¡ ser realizado via: (PIX, transferÃªncia, etc.) para a conta: GR SULTION`;
  const paymentLines = doc.splitTextToSize(paymentText, 170);
  doc.text(paymentLines, margin, y);
  y += paymentLines.length * 5 + 10;

  // 15-16. Clause 3
  checkPage(20);
  doc.setFont('helvetica', 'bold');
  doc.text('CLÃUSULA 3Âª - DOS JUROS E ENCARGOS', margin, y);
  y += 7;
  doc.setFont('helvetica', 'normal');
  doc.text(`Sobre o valor emprestado incidirÃ£o juros remuneratÃ³rios de ${loan.interestRate}% fixo, calculados atÃ© a data do efetivo pagamento.`, margin, y);
  y += 12;

  // 17-18. Clause 4
  checkPage(35);
  doc.setFont('helvetica', 'bold');
  doc.text('CLÃUSULA 4Âª - DO ATRASO E PENALIDADES', margin, y);
  y += 7;
  doc.setFont('helvetica', 'normal');
  doc.text('Em caso de atraso no pagamento, incidirÃ£o cumulativamente:', margin, y);
  y += 6;
  doc.text('a) Juros de mora de 1,5% ao dia;', margin + 5, y);
  y += 5;
  doc.text('b) Multa de 2% sobre o valor em atraso;', margin + 5, y);
  y += 5;
  doc.text('c) CorreÃ§Ã£o monetÃ¡ria com base no Ã­ndice IPCA.', margin + 5, y);
  y += 12;

  // 19-20. Clause 5
  checkPage(25);
  doc.setFont('helvetica', 'bold');
  doc.text('CLÃUSULA 5Âª - DO VENCIMENTO ANTECIPADO', margin, y);
  y += 7;
  doc.setFont('helvetica', 'normal');
  const c5Text = 'O nÃ£o pagamento na data acordada acarretarÃ¡ o vencimento antecipado da dÃ­vida, podendo o CREDOR exigir o pagamento imediato do valor total devido, acrescido dos encargos.';
  const c5Lines = doc.splitTextToSize(c5Text, 170);
  doc.text(c5Lines, margin, y);
  y += c5Lines.length * 5 + 10;

  // 21-22. Clause 6
  checkPage(25);
  doc.setFont('helvetica', 'bold');
  doc.text('CLÃUSULA 6Âª - DA CONFISSÃƒO DE DÃVIDA', margin, y);
  y += 7;
  doc.setFont('helvetica', 'normal');
  const c6Text = 'O DEVEDOR reconhece expressamente o dÃ©bito ora contraÃ­do, obrigando-se a quitÃ¡-lo nos termos deste contrato, sob pena de execuÃ§Ã£o judicial.';
  const c6Lines = doc.splitTextToSize(c6Text, 170);
  doc.text(c6Lines, margin, y);
  y += c6Lines.length * 5 + 10;

  // 25-26. Clause 7
  checkPage(25);
  doc.setFont('helvetica', 'bold');
  doc.text('CLÃUSULA 7Âª - DO FORO', margin, y);
  y += 7;
  doc.setFont('helvetica', 'normal');
  const c8Text = 'Fica eleito o foro da comarca de AraxÃ¡, MG com renÃºncia a qualquer outro, por mais privilegiado que seja, para dirimir dÃºvidas oriundas deste contrato.';
  const c8Lines = doc.splitTextToSize(c8Text, 170);
  doc.text(c8Lines, margin, y);
  y += c8Lines.length * 5 + 15;

  // 27. Local and date
  checkPage(15);
  doc.text(`Local e data: AraxÃ¡, MG, ${new Date().toLocaleDateString('pt-BR')}`, margin, y);
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
  doc.text('Assinatura: GR SULTION', margin, y);
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

