import { createHash } from 'node:crypto';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { linesFromPdfItems, parseC6StatementLines } from '../../src/utils/c6StatementParser.js';

export const MAX_C6_PREVIEW_BYTES = 3 * 1024 * 1024;

export const previewC6PdfBytes = async (bytes: Uint8Array, password: string) => {
  if (bytes.length === 0 || bytes.length > MAX_C6_PREVIEW_BYTES) {
    throw new Error('PDF_FALLBACK_SIZE_LIMIT');
  }
  if (Buffer.from(bytes.subarray(0, 5)).toString('ascii') !== '%PDF-') {
    throw new Error('ARQUIVO_PDF_OBRIGATORIO');
  }

  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const loadingTask = getDocument({ data: Uint8Array.from(bytes), password });
  try {
    const pdf = await loadingTask.promise;
    if (pdf.numPages > 50) throw new Error('PDF_COM_MAIS_DE_50_PAGINAS');
    const pages: string[][] = [];
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const content = await (await pdf.getPage(pageNumber)).getTextContent();
      pages.push(linesFromPdfItems(content.items.filter((item) => 'str' in item)));
    }
    return { sha256, statement: parseC6StatementLines(pages) };
  } finally {
    await loadingTask.destroy();
  }
};
