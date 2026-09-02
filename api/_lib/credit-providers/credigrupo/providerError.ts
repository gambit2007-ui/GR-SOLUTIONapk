import { ApiError } from '../../http.js';

export interface SafeCredigrupoProviderError {
  httpStatus: number;
  code?: unknown;
  error?: unknown;
  message?: unknown;
  details?: unknown;
  errors?: unknown;
  issues?: unknown;
  field?: unknown;
  path?: unknown;
  requestId?: unknown;
  correlationId?: unknown;
  occurredAt: string;
}

const ALLOWED_PROVIDER_ERROR_FIELDS = [
  'code',
  'error',
  'message',
  'details',
  'errors',
  'issues',
  'field',
  'path',
  'requestId',
  'correlationId',
] as const;

const SENSITIVE_KEY = /authorization|api.?key|webhook.?secret|cookie|cpf|\brg\b|document(?:number)?|bank(?:account|agency)|pix(?:key)?|brcode|qr.?code|selfie|kyc|email|phone|address|birth/i;
const MAX_DEPTH = 6;
const MAX_ARRAY_ITEMS = 40;
const MAX_OBJECT_KEYS = 60;
const MAX_STRING_LENGTH = 2_000;

const asRecord = (value: unknown): Record<string, unknown> | undefined => (
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
);

const redactString = (value: string): string => {
  let sanitized = value.slice(0, MAX_STRING_LENGTH);
  const configuredSecrets = [
    process.env.CREDIGRUPO_API_KEY,
    process.env.CREDIGRUPO_WEBHOOK_SECRET,
  ].filter((secret): secret is string => Boolean(secret && secret.length >= 4));

  for (const secret of configuredSecrets) sanitized = sanitized.replaceAll(secret, '[REDACTED]');

  return sanitized
    .replace(/\bBearer\s+[^\s,;]+/gi, 'Bearer [REDACTED]')
    .replace(/\bwl_(?:test|live)_[A-Za-z0-9_-]+\b/g, '[REDACTED_API_KEY]')
    .replace(/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g, '[REDACTED_DOCUMENT]')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[REDACTED_EMAIL]')
    .replace(/((?:cpf|rg|document(?:Number)?|bankAccount|bankAgency|pixKey|brCode|qrCode|conta|ag[eê]ncia)\s*[:=]?\s*)[^\s,;]+/gi, '$1[REDACTED]');
};

const sanitizeValue = (
  value: unknown,
  depth: number,
  seen: WeakSet<object>,
): unknown => {
  if (value === null || typeof value === 'boolean' || typeof value === 'number') return value;
  if (typeof value === 'string') return redactString(value);
  if (depth >= MAX_DEPTH || typeof value !== 'object') return undefined;
  if (seen.has(value)) return undefined;
  seen.add(value);

  if (Array.isArray(value)) {
    return value
      .slice(0, MAX_ARRAY_ITEMS)
      .map((item) => sanitizeValue(item, depth + 1, seen))
      .filter((item) => item !== undefined);
  }

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .slice(0, MAX_OBJECT_KEYS)
      .filter(([key]) => !SENSITIVE_KEY.test(key))
      .map(([key, item]) => [key, sanitizeValue(item, depth + 1, seen)])
      .filter(([, item]) => item !== undefined),
  );
};

export const sanitizeCredigrupoProviderError = (input: {
  httpStatus: number;
  payload: unknown;
  requestId?: string;
  occurredAt?: string;
}): SafeCredigrupoProviderError => {
  const source = asRecord(input.payload) || {};
  const seen = new WeakSet<object>();
  const fields = Object.fromEntries(
    ALLOWED_PROVIDER_ERROR_FIELDS
      .filter((key) => Object.hasOwn(source, key))
      .map((key) => [key, sanitizeValue(source[key], 0, seen)])
      .filter(([, value]) => value !== undefined),
  );
  const headerRequestId = input.requestId ? redactString(input.requestId) : undefined;

  return {
    httpStatus: input.httpStatus,
    ...fields,
    ...(fields.requestId === undefined && headerRequestId ? { requestId: headerRequestId } : {}),
    occurredAt: input.occurredAt || new Date().toISOString(),
  };
};

export const extractSafeCredigrupoProviderError = (error: unknown): SafeCredigrupoProviderError | undefined => {
  if (!(error instanceof ApiError)) return undefined;
  const details = asRecord(error.details);
  const providerError = asRecord(details?.providerError);
  if (!providerError || typeof providerError.httpStatus !== 'number' || typeof providerError.occurredAt !== 'string') {
    return undefined;
  }
  return providerError as unknown as SafeCredigrupoProviderError;
};
