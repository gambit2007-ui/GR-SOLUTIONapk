import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { jsPDF } from 'jspdf';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { linesFromPdfItems, parseC6StatementLines } from '../c6StatementParser';

const page = [
  'Extrato exportado no dia 24 de setembro de 2026 às 13:21',
  'Agência: 1 • Conta: 123',
  'Período • 01 de setembro de 2026 até 24 de setembro de 2026',
  'Saldo do dia • 24 de setembro de 2026 • R$ 70,00',
  'Setembro 2026 ( 01/09/2026 - 24/09/2026 ) Entradas: R$ 100,00 • Saídas: R$ 30,00',
  '03/09 03/09 Entrada PIX Pix recebido de Pessoa Exemplo R$ 100,00',
  '04/09 04/09 Saída PIX Pix enviado para Pessoa Exemplo -R$ 30,00',
  'Saldo do dia 04/09/26 R$ 70,00',
];

const currentC6Page = [
  'Extrato da conta',
  'Agência: 1 • Conta: 123',
  'Período da Exportação Saldo no dia da exportação',
  '03/10/2026 a 04/10/2026 R$ 70,00',
  '( 03/10/2026 - 04/10/2026 ) Entradas: R$ 100,00 • Saídas: R$ 30,00',
  '03/10 03/10 Entrada PIX Pix recebido de Pessoa Exemplo R$ 100,00',
  '04/10 04/10 Saída PIX Pix enviado para Pessoa Exemplo -R$ 30,00',
  '1/1 C6 Bank • Av. Nove de Julho, 3186 - Jardim Paulista, São Paulo/SP',
];

describe('extrato C6 somente para conferencia', () => {
  it('abre um PDF com a biblioteca compativel usada no upload', async () => {
    const data = new Uint8Array(new jsPDF().output('arraybuffer'));
    const task = getDocument({ data });
    const pdf = await task.promise;
    expect(pdf.numPages).toBe(1);
    await task.destroy();
  });

  it('extrai apenas transacoes e valida os totais impressos', () => {
    const parsed = parseC6StatementLines([page]);
    expect(parsed.rows).toHaveLength(2);
    expect(parsed.incomeCents).toBe(10000);
    expect(parsed.expenseCents).toBe(3000);
    expect(parsed.rows[1]).toMatchObject({ direction: 'OUT', amountCents: 3000, transactionDate: '2026-09-04' });
  });

  it('reconhece o layout atual do C6 com periodo numerico e saldo contabil', () => {
    const parsed = parseC6StatementLines([currentC6Page]);
    expect(parsed).toMatchObject({
      periodStart: '2026-10-03',
      periodEnd: '2026-10-04',
      closingBalanceCents: 7000,
      incomeCents: 10000,
      expenseCents: 3000,
    });
    expect(parsed.rows).toHaveLength(2);
  });

  it('bloqueia importacao quando uma linha nao fecha com o cabecalho', () => {
    expect(() => parseC6StatementLines([[...page.slice(0, 6), '04/09 04/09 Saída PIX Pix enviado para Pessoa Exemplo -R$ 20,00']]))
      .toThrow('TOTAIS_DO_PDF_DIVERGEM_DAS_LINHAS');
  });

  it('bloqueia linha de movimento desconhecida em vez de ignora-la', () => {
    expect(() => parseC6StatementLines([[...page, '05/09 05/09 Saída NOVO_TIPO Algo -R$ 1,00']]))
      .toThrow('LINHA_BANCARIA_NAO_RECONHECIDA');
  });

  it('nao inclui saldo diario como transacao', () => {
    expect(parseC6StatementLines([page]).rows.every((row) => !row.description.includes('Saldo do dia'))).toBe(true);
  });

  it.runIf(Boolean(process.env.C6_SAMPLE_PDF && process.env.C6_SAMPLE_PASSWORD))(
    'confere o PDF C6 real fornecido sem incorpora-lo ao repositorio', async () => {
      const data = new Uint8Array(readFileSync(process.env.C6_SAMPLE_PDF!));
      const pdf = await getDocument({ data, password: process.env.C6_SAMPLE_PASSWORD!, useSystemFonts: true }).promise;
      const pages: string[][] = [];
      for (let number = 1; number <= pdf.numPages; number += 1) {
        const content = await (await pdf.getPage(number)).getTextContent();
        pages.push(linesFromPdfItems(content.items.filter((item) => 'str' in item)));
      }
      const result = parseC6StatementLines(pages);
      expect(result.rows).toHaveLength(113);
      expect(result.incomeCents).toBe(8043211);
      expect(result.expenseCents).toBe(7773496);
      expect(result.closingBalanceCents).toBe(269715);
    },
  );

  it.runIf(Boolean(process.env.C6_LAYOUT_SAMPLE_PDF && process.env.C6_LAYOUT_SAMPLE_PASSWORD))(
    'reconhece uma variacao real atual do layout C6 sem persisti-la',
    async () => {
      const data = new Uint8Array(readFileSync(process.env.C6_LAYOUT_SAMPLE_PDF!));
      const task = getDocument({ data, password: process.env.C6_LAYOUT_SAMPLE_PASSWORD!, useSystemFonts: true });
      const pdf = await task.promise;
      const pages: string[][] = [];
      for (let number = 1; number <= pdf.numPages; number += 1) {
        const content = await (await pdf.getPage(number)).getTextContent();
        pages.push(linesFromPdfItems(content.items.filter((item) => 'str' in item)));
      }
      const result = parseC6StatementLines(pages);
      expect(result.bank).toBe('C6 Bank');
      expect(result.rows.length).toBeGreaterThan(0);
      expect(result.periodStart).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(result.periodEnd).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      await task.destroy();
    },
  );

  it.runIf(Boolean(process.env.C6_SAMPLE_PDF && process.env.C6_SAMPLE_PASSWORD))(
    'abre o PDF protegido pelo fluxo de upload do aplicativo', async () => {
      const { readC6StatementPdf } = await import('../c6Pdf');
      const bytes = Uint8Array.from(readFileSync(process.env.C6_SAMPLE_PDF!));
      const file = new File([bytes], 'extrato.pdf', { type: 'application/pdf' });
      const result = await readC6StatementPdf(file, process.env.C6_SAMPLE_PASSWORD!);
      expect(result.sha256).toMatch(/^[a-f0-9]{64}$/);
      expect(result.statement.rows).toHaveLength(113);
      expect(result.statement.incomeCents).toBe(8043211);
      expect(result.statement.expenseCents).toBe(7773496);
    },
  );
});
