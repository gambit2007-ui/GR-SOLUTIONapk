import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';
import { linesFromPdfItems, parseC6StatementLines, type ParsedBankStatement } from './c6StatementParser';

export interface StatementPdfPreview {
  sha256: string;
  statement: ParsedBankStatement;
}

export const readC6StatementPdf = async (file: File, password: string): Promise<StatementPdfPreview> => {
  if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
    throw new Error('ARQUIVO_PDF_OBRIGATORIO');
  }
  if (file.size === 0 || file.size > 10 * 1024 * 1024) throw new Error('PDF_DEVE_TER_ATE_10_MB');
  const buffer = await file.arrayBuffer();
  const hash = await crypto.subtle.digest('SHA-256', buffer);
  const sha256 = Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, '0')).join('');
  const { getDocument, GlobalWorkerOptions } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  GlobalWorkerOptions.workerSrc = workerUrl;
  const loadingTask = getDocument({ data: new Uint8Array(buffer), password });
  try {
    const pdf = await loadingTask.promise;
    if (pdf.numPages > 50) throw new Error('PDF_COM_MAIS_DE_50_PAGINAS');
    const pages: string[][] = [];
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      pages.push(linesFromPdfItems(content.items.filter((item) => 'str' in item)));
    }
    return { sha256, statement: parseC6StatementLines(pages) };
  } finally {
    await loadingTask.destroy();
  }
};
