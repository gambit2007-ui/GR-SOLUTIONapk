import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { jsPDF } from 'jspdf';
import { previewC6PdfBytes } from '../../../api/_lib/c6PdfPreview';

describe('previa C6 temporaria no servidor', () => {
  it('recusa arquivo que nao e PDF sem gravar dados', async () => {
    await expect(previewC6PdfBytes(new TextEncoder().encode('not a pdf'), ''))
      .rejects.toThrow('ARQUIVO_PDF_OBRIGATORIO');
  });

  it('rejeita um PDF que nao e extrato C6', async () => {
    const bytes = new Uint8Array(new jsPDF().output('arraybuffer'));
    await expect(previewC6PdfBytes(bytes, ''))
      .rejects.toThrow('FORMATO_C6_NAO_RECONHECIDO');
  });

  it.runIf(Boolean(process.env.C6_SAMPLE_PDF && process.env.C6_SAMPLE_PASSWORD))(
    'extrai o PDF C6 protegido sem persistir o arquivo', async () => {
      const bytes = new Uint8Array(readFileSync(process.env.C6_SAMPLE_PDF!));
      const result = await previewC6PdfBytes(bytes, process.env.C6_SAMPLE_PASSWORD!);
      expect(result.sha256).toMatch(/^[a-f0-9]{64}$/);
      expect(result.statement.rows).toHaveLength(113);
      expect(result.statement.incomeCents).toBe(8043211);
      expect(result.statement.expenseCents).toBe(7773496);
    },
  );
});
