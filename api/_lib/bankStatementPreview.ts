import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireAuthorizedActor } from './auth.js';
import { previewC6PdfBytes, MAX_C6_PREVIEW_BYTES } from './c6PdfPreview.js';
import { ApiError, parseJsonBody, sendJson } from './http.js';

const knownPdfErrors = new Set([
  'ARQUIVO_PDF_OBRIGATORIO', 'PDF_COM_MAIS_DE_50_PAGINAS', 'PDF_FALLBACK_SIZE_LIMIT',
  'FORMATO_C6_NAO_RECONHECIDO', 'PERIODO_DO_EXTRATO_NAO_ENCONTRADO',
  'SALDO_FINAL_NAO_ENCONTRADO', 'LINHA_BANCARIA_NAO_RECONHECIDA',
  'TOTAIS_DO_PDF_DIVERGEM_DAS_LINHAS', 'TOTAIS_DO_EXTRATO_NAO_ENCONTRADOS',
  'EXTRATO_SEM_LANCAMENTOS', 'SINAL_BANCARIO_INCONSISTENTE',
]);

export const handleBankStatementPreview = async (request: VercelRequest, response: VercelResponse) => {
  response.setHeader('Cache-Control', 'no-store');
  try {
    if (request.method !== 'POST') throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Metodo nao permitido.');
    const actor = await requireAuthorizedActor(request);
    if (!actor.admin) throw new ApiError(403, 'ADMIN_REQUIRED', 'Acesso restrito ao administrador.');

    const input = parseJsonBody<{ pdfBase64?: unknown; password?: unknown }>(request);
    if (!input || typeof input !== 'object') throw new ApiError(400, 'INVALID_JSON', 'Dados do PDF invalidos.');
    if (typeof input.pdfBase64 !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(input.pdfBase64)
      || input.pdfBase64.length > Math.ceil(MAX_C6_PREVIEW_BYTES / 3) * 4) {
      throw new ApiError(400, 'PDF_FALLBACK_SIZE_LIMIT', 'PDF invalido ou grande demais para a leitura alternativa.');
    }
    if (typeof input.password !== 'string' || input.password.length > 128) {
      throw new ApiError(400, 'INVALID_PDF_PASSWORD', 'Senha do PDF invalida.');
    }
    const bytes = Buffer.from(input.pdfBase64, 'base64');
    if (bytes.toString('base64') !== input.pdfBase64 || bytes.length > MAX_C6_PREVIEW_BYTES) {
      throw new ApiError(400, 'INVALID_PDF_DATA', 'Dados do PDF invalidos.');
    }

    return sendJson(response, 200, await previewC6PdfBytes(bytes, input.password));
  } catch (error) {
    if (error instanceof ApiError) {
      return sendJson(response, error.status, { error: error.code, message: error.message });
    }
    const code = error instanceof Error ? error.message : '';
    if (knownPdfErrors.has(code)) return sendJson(response, 422, { error: code });
    if (error instanceof Error && /password/i.test(error.name + error.message)) {
      return sendJson(response, 422, { error: 'PASSWORD_INVALID' });
    }
    console.error('[C6 PDF preview] failed', { name: error instanceof Error ? error.name : 'Unknown' });
    return sendJson(response, 500, { error: 'PDF_PREVIEW_FAILED' });
  }
};
