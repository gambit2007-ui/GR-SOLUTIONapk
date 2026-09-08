import type { VercelRequest, VercelResponse } from '@vercel/node';
import { FieldValue } from 'firebase-admin/firestore';
import type {
  CredigrupoBorrowerDocumentReference,
  CredigrupoBorrowerDocumentType,
  UploadCredigrupoBorrowerDocumentsRequest,
} from '../../../../src/lib/creditProviders/types.js';
import {
  CREDIGRUPO_DOCUMENT_MAX_BYTES,
  CREDIGRUPO_KYC_DOCUMENT_TYPES,
} from '../../../../src/lib/creditProviders/investorValidation.js';
import { requireAuthorizedActor } from '../../auth.js';
import { adminDb, adminStorage } from '../../firebaseAdmin.js';
import { ApiError, handleApiError, parseJsonBody, sendJson } from '../../http.js';
import { CREDIGRUPO_ACCOUNT_MODE, getCredigrupoServerConfig } from '../../env.js';
import { CredigrupoClient } from './client.js';
import {
  requireCredigrupoCustomerForEnvironment,
  requireCredigrupoRecordForEnvironment,
} from './dataScope.js';
import { borrowerLinkId } from './store.js';

const validDocumentId = (value: string) => /^[a-zA-Z0-9_-]{1,160}$/.test(value);
const allowedContentTypes = new Set(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']);
const documentTypes = new Set<CredigrupoBorrowerDocumentType>(CREDIGRUPO_KYC_DOCUMENT_TYPES);

const assertBorrowerDocumentsAdmin = (actor: { admin: boolean }) => {
  if (!actor.admin) throw new ApiError(403, 'ADMIN_REQUIRED', 'Somente administradores podem enviar documentos de KYC.');
};

const validateReference = (
  reference: CredigrupoBorrowerDocumentReference,
  actorUid: string,
): CredigrupoBorrowerDocumentReference => {
  if (!documentTypes.has(reference.type)) {
    throw new ApiError(400, 'INVALID_KYC_DOCUMENT_TYPE', 'Tipo de documento KYC invalido.');
  }

  const storagePath = String(reference.storagePath || '').trim();
  const parts = storagePath.split('/');
  const validPath = parts.length === 4
    && parts[0] === 'credigrupo-kyc'
    && parts[1] === actorUid
    && /^[a-zA-Z0-9_-]{8,80}$/.test(parts[2])
    && parts[3].startsWith(`${reference.type}.`)
    && /^[a-zA-Z0-9_.-]{1,120}$/.test(parts[3]);
  if (!validPath) throw new ApiError(400, 'INVALID_KYC_STORAGE_PATH', 'Referencia temporaria de documento invalida.');

  return { type: reference.type, storagePath };
};

const loadDocument = async (reference: CredigrupoBorrowerDocumentReference) => {
  const file = adminStorage.bucket().file(reference.storagePath);
  let metadata;
  let buffer;
  try {
    [metadata] = await file.getMetadata();
    [buffer] = await file.download();
  } catch {
    throw new ApiError(400, 'KYC_TEMP_FILE_NOT_FOUND', 'Arquivo temporario de KYC nao encontrado.');
  }

  const contentType = String(metadata.contentType || '').toLowerCase();
  if (!allowedContentTypes.has(contentType)) {
    throw new ApiError(400, 'INVALID_KYC_FILE_TYPE', 'Formato de documento KYC nao permitido.');
  }
  if (buffer.length <= 0 || buffer.length > CREDIGRUPO_DOCUMENT_MAX_BYTES) {
    throw new ApiError(413, 'KYC_FILE_TOO_LARGE', 'Cada documento deve ter no maximo 8 MB.');
  }

  return `data:${contentType};base64,${buffer.toString('base64')}`;
};

export const handleBorrowerDocumentsRoute = async (
  request: VercelRequest,
  response: VercelResponse,
) => {
  const temporaryPaths = new Set<string>();
  try {
    if (request.method !== 'POST') return sendJson(response, 405, { error: 'METHOD_NOT_ALLOWED' });
    const actor = await requireAuthorizedActor(request);
    assertBorrowerDocumentsAdmin(actor);
    const input = parseJsonBody<UploadCredigrupoBorrowerDocumentsRequest>(request);
    const customerId = String(input.customerId || '').trim();
    if (!validDocumentId(customerId)) throw new ApiError(400, 'CUSTOMER_ID_REQUIRED', 'Cliente obrigatorio.');
    if (!Array.isArray(input.documents) || input.documents.length < 1 || input.documents.length > 4) {
      throw new ApiError(400, 'KYC_DOCUMENTS_REQUIRED', 'Envie entre um e quatro documentos de KYC.');
    }

    const references = input.documents.map((reference) => validateReference(reference, actor.uid));
    if (new Set(references.map((reference) => reference.type)).size !== references.length) {
      throw new ApiError(400, 'DUPLICATE_KYC_DOCUMENT_TYPE', 'Cada tipo de documento deve ser enviado uma unica vez.');
    }
    references.forEach((reference) => temporaryPaths.add(reference.storagePath));

    const { environment } = getCredigrupoServerConfig();
    const customerRef = adminDb.doc(`clientes/${customerId}`);
    const borrowerRef = adminDb.doc(`creditBorrowers/${borrowerLinkId(customerId, CREDIGRUPO_ACCOUNT_MODE, environment)}`);
    const [customerSnapshot, borrowerSnapshot] = await Promise.all([customerRef.get(), borrowerRef.get()]);
    if (!customerSnapshot.exists) throw new ApiError(404, 'CUSTOMER_NOT_FOUND', 'Cliente nao encontrado.');
    if (!borrowerSnapshot.exists) throw new ApiError(409, 'BORROWER_NOT_SYNCED', 'Cadastre o tomador antes de enviar os documentos.');
    requireCredigrupoCustomerForEnvironment(customerSnapshot.data() || {}, environment);
    requireCredigrupoRecordForEnvironment(borrowerSnapshot.data() || {}, environment);

    const borrowerId = String(borrowerSnapshot.data()?.borrowerId || '').trim();
    if (!validDocumentId(borrowerId)) throw new ApiError(409, 'BORROWER_NOT_SYNCED', 'Tomador local invalido.');

    const documents = await Promise.all(references.map(loadDocument));
    const providerPayload = Object.fromEntries(
      references.map((reference, index) => [reference.type, documents[index]]),
    ) as Partial<Record<CredigrupoBorrowerDocumentType, string>>;
    await new CredigrupoClient().uploadBorrowerDocuments(borrowerId, providerPayload);

    const existing = Array.isArray(borrowerSnapshot.data()?.documentsSubmitted)
      ? borrowerSnapshot.data()?.documentsSubmitted.filter((type: unknown): type is CredigrupoBorrowerDocumentType => documentTypes.has(type as CredigrupoBorrowerDocumentType))
      : [];
    const submitted = Array.from(new Set([...existing, ...references.map((reference) => reference.type)]));
    const documentsComplete = CREDIGRUPO_KYC_DOCUMENT_TYPES.every((type) => submitted.includes(type));
    const documentState = {
      documentsSubmitted: submitted,
      documentsComplete,
      documentsSubmittedAt: FieldValue.serverTimestamp(),
      documentsSubmittedByUid: actor.uid,
      updatedAt: FieldValue.serverTimestamp(),
    };
    await Promise.all([
      borrowerRef.set(documentState, { merge: true }),
      customerRef.set({ credigrupo: documentState }, { merge: true }),
    ]);

    return sendJson(response, 200, { success: true, documentsSubmitted: submitted, documentsComplete });
  } catch (error) {
    return handleApiError(response, error);
  } finally {
    await Promise.allSettled(Array.from(temporaryPaths).map(async (storagePath) => {
      try {
        await adminStorage.bucket().file(storagePath).delete({ ignoreNotFound: true });
      } catch {
        // Client cleanup also runs; a cleanup failure must not expose or retain the provider response.
      }
    }));
  }
};
