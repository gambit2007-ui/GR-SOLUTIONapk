import type { VercelRequest, VercelResponse } from '@vercel/node';
import { FieldValue } from 'firebase-admin/firestore';
import type {
  CredigrupoInvestorDocumentReference,
  CredigrupoInvestorDocumentType,
  UpdateCredigrupoGrInvestorRequest,
  UploadCredigrupoInvestorDocumentsRequest,
} from '../../../../src/lib/creditProviders/types.js';
import {
  CREDIGRUPO_DOCUMENT_MAX_BYTES,
  CREDIGRUPO_INVESTOR_DOCUMENT_TYPES,
} from '../../../../src/lib/creditProviders/investorValidation.js';
import { requireAuthorizedActor } from '../../auth.js';
import { adminDb, adminStorage } from '../../firebaseAdmin.js';
import { ApiError, handleApiError, parseJsonBody, sendJson } from '../../http.js';
import { CredigrupoClient } from './client.js';
import {
  CREDIGRUPO_PROVIDER_SETTINGS_PATH,
  readCredigrupoGrInvestorSettings,
  type StoredCredigrupoProviderSettings,
} from './grInvestorSettings.js';
import {
  assertInvestorAdmin,
  isStoredInvestorApprovedAndActive,
  normalizeInvestorKycStatus,
  resolveExternalInvestorId,
  type StoredCreditInvestor,
} from './investorStore.js';

const validDocumentId = (value: string) => /^[a-zA-Z0-9_-]{1,160}$/.test(value);
const documentContentTypes = new Set(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']);
const documentTypes = new Set<CredigrupoInvestorDocumentType>(CREDIGRUPO_INVESTOR_DOCUMENT_TYPES);

const configureGrInvestor = async (
  request: VercelRequest,
  response: VercelResponse,
) => {
  const actor = await requireAuthorizedActor(request);
  assertInvestorAdmin(actor);
  const input = parseJsonBody<UpdateCredigrupoGrInvestorRequest>(request);
  const investorInternalId = String(input.investorInternalId || '').trim();
  if (!validDocumentId(investorInternalId)) {
    throw new ApiError(400, 'INVALID_INVESTOR_ID', 'Selecione um investidor Credigrupo valido.');
  }

  const settingsRef = adminDb.doc(CREDIGRUPO_PROVIDER_SETTINGS_PATH);
  const investorRef = adminDb.doc(`creditInvestors/${investorInternalId}`);
  await adminDb.runTransaction(async (transaction) => {
    const [settingsSnapshot, investorSnapshot] = await Promise.all([
      transaction.get(settingsRef),
      transaction.get(investorRef),
    ]);
    if (!investorSnapshot.exists) throw new ApiError(404, 'INVESTOR_NOT_FOUND', 'Investidor nao encontrado.');
    const investor = investorSnapshot.data() as StoredCreditInvestor;
    if (!isStoredInvestorApprovedAndActive(investor)) {
      throw new ApiError(409, 'INVESTOR_NOT_APPROVED', 'Somente investidor Credigrupo aprovado e ativo pode representar a GR.');
    }

    const current = settingsSnapshot.data() as StoredCredigrupoProviderSettings | undefined;
    const previousInternalId = String(current?.grInvestorInternalId || '').trim();
    const previousRef = previousInternalId && previousInternalId !== investorInternalId
      ? adminDb.doc(`creditInvestors/${previousInternalId}`)
      : null;
    const previousSnapshot = previousRef ? await transaction.get(previousRef) : null;

    if (previousRef && previousSnapshot?.exists) {
      transaction.set(previousRef, {
        capitalOrigin: 'EXTERNAL',
        updatedAt: FieldValue.serverTimestamp(),
        updatedByUid: actor.uid,
      }, { merge: true });
    }

    const externalId = resolveExternalInvestorId(investorInternalId, investor);
    const investorName = String(investor.name || '').trim();
    if (!externalId || !investorName) {
      throw new ApiError(409, 'INVESTOR_REFERENCE_UNAVAILABLE', 'Sincronize o investidor antes de configurar a GR.');
    }

    transaction.set(investorRef, {
      capitalOrigin: 'GR',
      updatedAt: FieldValue.serverTimestamp(),
      updatedByUid: actor.uid,
    }, { merge: true });
    transaction.set(settingsRef, {
      grInvestorId: externalId,
      grInvestorInternalId: investorInternalId,
      grInvestorName: investorName,
      grInvestorConfigured: true,
      kycStatus: normalizeInvestorKycStatus(investor.kycStatus),
      syncedAt: investor.syncedAt || FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: actor.uid,
    }, { merge: true });
  });

  return sendJson(response, 200, { settings: await readCredigrupoGrInvestorSettings() });
};

export const handleGrInvestorRoute = async (
  request: VercelRequest,
  response: VercelResponse,
) => {
  try {
    if (request.method === 'PATCH') return await configureGrInvestor(request, response);
    if (request.method !== 'GET') return sendJson(response, 405, { error: 'METHOD_NOT_ALLOWED' });
    await requireAuthorizedActor(request);
    response.setHeader('Cache-Control', 'private, no-store, max-age=0');
    return sendJson(response, 200, { settings: await readCredigrupoGrInvestorSettings() });
  } catch (error) {
    return handleApiError(response, error);
  }
};

const validateReference = (
  reference: CredigrupoInvestorDocumentReference,
  actorUid: string,
): CredigrupoInvestorDocumentReference => {
  if (!documentTypes.has(reference.type)) {
    throw new ApiError(400, 'INVALID_KYC_DOCUMENT_TYPE', 'Tipo de documento KYC invalido.');
  }
  const path = String(reference.storagePath || '').trim();
  const parts = path.split('/');
  const validPath = parts.length === 4
    && parts[0] === 'credigrupo-kyc'
    && parts[1] === actorUid
    && /^[a-zA-Z0-9_-]{8,80}$/.test(parts[2])
    && parts[3].startsWith(`${reference.type}.`)
    && /^[a-zA-Z0-9_.-]{1,120}$/.test(parts[3]);
  if (!validPath) throw new ApiError(400, 'INVALID_KYC_STORAGE_PATH', 'Referencia temporaria de documento invalida.');
  return { type: reference.type, storagePath: path };
};

const loadDocument = async (reference: CredigrupoInvestorDocumentReference) => {
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
  if (!documentContentTypes.has(contentType)) throw new ApiError(400, 'INVALID_KYC_FILE_TYPE', 'Formato de documento KYC nao permitido.');
  if (buffer.length <= 0 || buffer.length > CREDIGRUPO_DOCUMENT_MAX_BYTES) {
    throw new ApiError(413, 'KYC_FILE_TOO_LARGE', 'Cada documento deve ter no maximo 8 MB.');
  }

  return {
    dataUri: `data:${contentType};base64,${buffer.toString('base64')}`,
  };
};

export const handleInvestorDocumentsRoute = async (
  request: VercelRequest,
  response: VercelResponse,
) => {
  const temporaryPaths = new Set<string>();
  try {
    if (request.method !== 'POST') return sendJson(response, 405, { error: 'METHOD_NOT_ALLOWED' });
    const actor = await requireAuthorizedActor(request);
    assertInvestorAdmin(actor);
    const input = parseJsonBody<UploadCredigrupoInvestorDocumentsRequest>(request);
    const investorId = String(input.investorId || '').trim();
    if (!validDocumentId(investorId)) throw new ApiError(400, 'INVESTOR_ID_REQUIRED', 'Investidor obrigatorio.');
    if (!Array.isArray(input.documents) || input.documents.length < 1 || input.documents.length > 4) {
      throw new ApiError(400, 'KYC_DOCUMENTS_REQUIRED', 'Envie entre um e quatro documentos de KYC.');
    }

    const references = input.documents.map((reference) => validateReference(reference, actor.uid));
    if (new Set(references.map((reference) => reference.type)).size !== references.length) {
      throw new ApiError(400, 'DUPLICATE_KYC_DOCUMENT_TYPE', 'Cada tipo de documento deve ser enviado uma unica vez.');
    }
    references.forEach((reference) => temporaryPaths.add(reference.storagePath));

    const investorRef = adminDb.doc(`creditInvestors/${investorId}`);
    const investorSnapshot = await investorRef.get();
    if (!investorSnapshot.exists) throw new ApiError(404, 'INVESTOR_NOT_FOUND', 'Investidor nao encontrado.');
    const stored = investorSnapshot.data() as StoredCreditInvestor;
    const externalId = resolveExternalInvestorId(investorId, stored);

    const loadedDocuments = await Promise.all(references.map(loadDocument));
    const providerPayload = Object.fromEntries(
      references.map((reference, index) => [reference.type, loadedDocuments[index].dataUri]),
    ) as Partial<Record<CredigrupoInvestorDocumentType, string>>;
    await new CredigrupoClient().uploadInvestorDocuments(externalId, providerPayload);

    const submitted = Array.from(new Set([
      ...(Array.isArray(stored.documentsSubmitted) ? stored.documentsSubmitted : []),
      ...references.map((reference) => reference.type),
    ]));
    const complete = CREDIGRUPO_INVESTOR_DOCUMENT_TYPES.every((type) => submitted.includes(type));
    await investorRef.set({
      documentsSubmitted: submitted,
      documentsComplete: complete,
      documentsSubmittedAt: FieldValue.serverTimestamp(),
      documentsSubmittedByUid: actor.uid,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });

    return sendJson(response, 200, {
      success: true,
      documentsSubmitted: submitted,
      documentsComplete: complete,
    });
  } catch (error) {
    return handleApiError(response, error);
  } finally {
    await Promise.allSettled(
      Array.from(temporaryPaths).map(async (path) => {
        try {
          await adminStorage.bucket().file(path).delete({ ignoreNotFound: true });
        } catch {
          // The client also removes temporary files; cleanup must not mask the API response.
        }
      }),
    );
  }
};
