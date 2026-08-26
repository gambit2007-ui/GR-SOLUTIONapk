import type { VercelRequest, VercelResponse } from '@vercel/node';

export interface AuthorizedActor {
  uid: string;
  email?: string;
  name?: string;
  admin: boolean;
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export const parseJsonBody = <T>(request: VercelRequest): T => {
  if (request.body && typeof request.body === 'object' && !Buffer.isBuffer(request.body)) {
    return request.body as T;
  }

  const raw = Buffer.isBuffer(request.body) ? request.body.toString('utf8') : String(request.body || '');
  if (!raw.trim()) throw new ApiError(400, 'EMPTY_BODY', 'Corpo da requisicao obrigatorio.');

  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new ApiError(400, 'INVALID_JSON', 'JSON invalido.');
  }
};
export const readRawBody = async (request: VercelRequest, maxBytes = 1_000_000): Promise<Buffer> => {
  if (Buffer.isBuffer(request.body)) {
    if (request.body.length > maxBytes) throw new ApiError(413, 'PAYLOAD_TOO_LARGE', 'Payload excede o limite permitido.');
    return request.body;
  }
  if (typeof request.body === 'string') {
    const body = Buffer.from(request.body, 'utf8');
    if (body.length > maxBytes) throw new ApiError(413, 'PAYLOAD_TOO_LARGE', 'Payload excede o limite permitido.');
    return body;
  }
  if (request.body && typeof request.body === 'object') {
    throw new ApiError(400, 'RAW_BODY_UNAVAILABLE', 'Corpo bruto indisponivel para validar a assinatura.');
  }

  const chunks: Buffer[] = [];
  let totalBytes = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += buffer.length;
    if (totalBytes > maxBytes) throw new ApiError(413, 'PAYLOAD_TOO_LARGE', 'Payload excede o limite permitido.');
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
};

export const sendJson = (response: VercelResponse, status: number, payload: unknown) => {
  response.status(status).json(payload);
};

export const handleApiError = (response: VercelResponse, error: unknown) => {
  if (error instanceof ApiError) {
    sendJson(response, error.status, { error: error.code, message: error.message, details: error.details });
    return;
  }

  const message = error instanceof Error ? error.message : 'UNKNOWN_ERROR';
  const safeMessage = message.startsWith('CREDIGRUPO_') ? message : 'INTERNAL_ERROR';
  console.error('[Credigrupo]', { error: safeMessage, timestamp: new Date().toISOString() });
  sendJson(response, 500, { error: safeMessage, message: 'Nao foi possivel concluir a operacao.' });
};
