import type { VercelRequest, VercelResponse } from '@vercel/node';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireAuthorizedActor: vi.fn(),
  previewC6PdfBytes: vi.fn(),
}));
vi.mock('../../../api/_lib/auth.js', () => ({ requireAuthorizedActor: mocks.requireAuthorizedActor }));
vi.mock('../../../api/_lib/c6PdfPreview.js', () => ({
  previewC6PdfBytes: mocks.previewC6PdfBytes,
  MAX_C6_PREVIEW_BYTES: 3 * 1024 * 1024,
}));

import { handleBankStatementPreview as handler } from '../../../api/_lib/bankStatementPreview';

const invoke = async (body: unknown, method = 'POST') => {
  let status = 200;
  let payload: unknown;
  const response = {
    setHeader: vi.fn(),
    status: vi.fn((code: number) => { status = code; return response; }),
    json: vi.fn((value: unknown) => { payload = value; return response; }),
  } as unknown as VercelResponse;
  const request = { method, body, headers: {} } as VercelRequest;
  await handler(request, response);
  return { status, payload, response };
};

describe('endpoint de previa C6 somente leitura', () => {
  beforeEach(() => vi.clearAllMocks());

  it('recusa operador nao administrador antes de processar o PDF', async () => {
    mocks.requireAuthorizedActor.mockResolvedValue({ uid: 'operator', admin: false });
    const result = await invoke({ pdfBase64: 'JVBERi0=', password: 'secret' });
    expect(result.status).toBe(403);
    expect(mocks.previewC6PdfBytes).not.toHaveBeenCalled();
  });

  it('recusa requisicao sem senha como texto ou PDF malformado', async () => {
    mocks.requireAuthorizedActor.mockResolvedValue({ uid: 'admin', admin: true });
    const invalidPassword = await invoke({ pdfBase64: 'JVBERi0=', password: null });
    expect(invalidPassword.status).toBe(400);
    const invalidPdf = await invoke({ pdfBase64: 'not base64!', password: '' });
    expect(invalidPdf.status).toBe(400);
    expect(mocks.previewC6PdfBytes).not.toHaveBeenCalled();
  });

  it('devolve previa sem cache quando administrador envia PDF valido', async () => {
    mocks.requireAuthorizedActor.mockResolvedValue({ uid: 'admin', admin: true });
    mocks.previewC6PdfBytes.mockResolvedValue({ sha256: 'a'.repeat(64), statement: { rows: [] } });
    const result = await invoke({ pdfBase64: 'JVBERi0=', password: '' });
    expect(result.status).toBe(200);
    expect(result.response.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
    expect(mocks.previewC6PdfBytes).toHaveBeenCalledOnce();
  });
});
