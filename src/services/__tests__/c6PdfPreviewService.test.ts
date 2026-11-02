import { describe, expect, it, vi } from 'vitest';
import type { StatementPdfPreview } from '../../utils/c6Pdf';
import { isLocalPdfRuntimeFailure, readC6StatementPdfWithFallback } from '../c6PdfPreviewService';

vi.mock('../../utils/c6Pdf', () => ({ readC6StatementPdf: vi.fn() }));

const preview: StatementPdfPreview = {
  sha256: 'a'.repeat(64),
  statement: {
    bank: 'C6 Bank', periodStart: '2026-09-01', periodEnd: '2026-09-30',
    closingBalanceCents: 0, incomeCents: 0, expenseCents: 0, rows: [],
  },
};

describe('fallback do extrato no iPhone', () => {
  const file = new File(['%PDF-'], 'extrato.pdf', { type: 'application/pdf' });

  it('aciona leitura alternativa somente para falha de runtime do leitor local', async () => {
    const local = vi.fn().mockRejectedValue(new TypeError('undefined is not a function'));
    const server = vi.fn().mockResolvedValue(preview);
    await expect(readC6StatementPdfWithFallback(file, 'senha', local, server)).resolves.toEqual(preview);
    expect(server).toHaveBeenCalledOnce();
    expect(server).toHaveBeenCalledWith(file, 'senha');
    expect(isLocalPdfRuntimeFailure(new Error('Setting up fake worker failed'))).toBe(true);
  });

  it('aciona leitura alternativa quando o PDF.js do navegador rejeita um PDF valido', async () => {
    const localError = new Error('Invalid PDF structure.');
    localError.name = 'InvalidPDFException';
    const local = vi.fn().mockRejectedValue(localError);
    const server = vi.fn().mockResolvedValue(preview);

    await expect(readC6StatementPdfWithFallback(file, 'senha', local, server)).resolves.toEqual(preview);
    expect(server).toHaveBeenCalledOnce();
    expect(isLocalPdfRuntimeFailure(localError)).toBe(true);
  });

  it('nao envia PDF e senha ao servidor para erro de formato ou de negocio', async () => {
    const local = vi.fn().mockRejectedValue(new Error('FORMATO_C6_NAO_RECONHECIDO'));
    const server = vi.fn();
    await expect(readC6StatementPdfWithFallback(file, 'senha', local, server))
      .rejects.toThrow('FORMATO_C6_NAO_RECONHECIDO');
    expect(server).not.toHaveBeenCalled();
  });
});
