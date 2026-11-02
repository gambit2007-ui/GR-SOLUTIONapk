import { auth } from '../firebase';
import { readC6StatementPdf, type StatementPdfPreview } from '../utils/c6Pdf';

const MAX_FALLBACK_BYTES = 3 * 1024 * 1024;

export const isLocalPdfRuntimeFailure = (error: unknown): boolean => {
  if (error instanceof TypeError) return true;
  const message = error instanceof Error ? error.message : '';
  const name = error instanceof Error ? error.name : '';
  return name === 'InvalidPDFException'
    || /Setting up fake worker failed|undefined is not a function|worker was destroyed|Invalid PDF structure/i.test(message);
};

const readPdfBase64 = (file: File): Promise<string> => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onerror = () => reject(new Error('PDF_FALLBACK_FILE_READ_FAILED'));
  reader.onload = () => {
    const result = reader.result;
    const separator = typeof result === 'string' ? result.indexOf(',') : -1;
    if (typeof result !== 'string' || separator < 0) reject(new Error('PDF_FALLBACK_FILE_READ_FAILED'));
    else resolve(result.slice(separator + 1));
  };
  reader.readAsDataURL(file);
});

export const readC6StatementPdfOnServer = async (file: File, password: string): Promise<StatementPdfPreview> => {
  if (file.size > MAX_FALLBACK_BYTES) throw new Error('PDF_FALLBACK_SIZE_LIMIT');
  const user = auth.currentUser;
  if (!user) throw new Error('AUTH_REQUIRED');
  const pdfBase64 = await readPdfBase64(file);
  const token = await user.getIdToken();
  let response: Response;
  try {
    response = await fetch('/api/bank-statement/preview', {
      method: 'POST',
      cache: 'no-store',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ pdfBase64, password }),
    });
  } catch {
    throw new Error('PDF_FALLBACK_NETWORK_FAILED');
  }
  const result = await response.json().catch(() => ({})) as StatementPdfPreview & { error?: string };
  if (!response.ok) throw new Error(result.error || 'PDF_PREVIEW_FAILED');
  if (!/^[a-f0-9]{64}$/.test(result.sha256) || !result.statement || !Array.isArray(result.statement.rows)) {
    throw new Error('PDF_PREVIEW_FAILED');
  }
  return { sha256: result.sha256, statement: result.statement };
};

export const readC6StatementPdfWithFallback = async (
  file: File,
  password: string,
  readLocally: typeof readC6StatementPdf = readC6StatementPdf,
  readOnServer: typeof readC6StatementPdfOnServer = readC6StatementPdfOnServer,
): Promise<StatementPdfPreview> => {
  try {
    return await readLocally(file, password);
  } catch (error) {
    if (!isLocalPdfRuntimeFailure(error)) throw error;
    return readOnServer(file, password);
  }
};
