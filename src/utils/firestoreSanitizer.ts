type FirestoreFieldValueLike = {
  constructor?: { name?: string };
  isEqual?: (other: unknown) => boolean;
};

type FirestoreTimestampLike = {
  toDate: () => Date;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const isDate = (value: unknown): value is Date => value instanceof Date;

const isTimestampLike = (value: unknown): value is FirestoreTimestampLike =>
  isRecord(value) && typeof value.toDate === 'function';

const isFieldValueLike = (value: unknown): value is FirestoreFieldValueLike => {
  if (!isRecord(value)) return false;
  const ctorName = String((value as FirestoreFieldValueLike).constructor?.name || '').toLowerCase();
  return ctorName.includes('fieldvalue');
};

export const sanitizeFirestorePayload = <T,>(value: T): T => {
  if (value === undefined) return value;

  if (Array.isArray(value)) {
    return value
      .map((item) => sanitizeFirestorePayload(item))
      .filter((item) => item !== undefined) as unknown as T;
  }

  if (isFieldValueLike(value) || isTimestampLike(value) || isDate(value)) {
    return value;
  }

  if (isRecord(value)) {
    const output: Record<string, unknown> = {};
    Object.entries(value).forEach(([key, entryValue]) => {
      if (entryValue === undefined) return;
      output[key] = sanitizeFirestorePayload(entryValue);
    });
    return output as T;
  }

  return value;
};

