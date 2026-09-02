import type { VercelRequest, VercelResponse } from '@vercel/node';
import { FieldValue } from 'firebase-admin/firestore';
import type {
  CreateCredigrupoInvestorRequest,
  CredigrupoInvestorDetails,
  FundingSourceType,
  UpdateCredigrupoInvestorRequest,
} from '../../src/lib/creditProviders/types.js';
import { validateCredigrupoInvestorRequest } from '../../src/lib/creditProviders/investorValidation.js';
import { requireAuthorizedActor } from '../_lib/auth.js';
import {
  CredigrupoClient,
  type CredigrupoInvestorResponse,
} from '../_lib/credit-providers/credigrupo/client.js';
import {
  handleGrInvestorRoute,
  handleInvestorDocumentsRoute,
} from '../_lib/credit-providers/credigrupo/investorAdminRoutes.js';
import {
  assertInvestorAdmin,
  fingerprintInvestorDocument,
  isStoredInvestorEligible,
  maskInvestorDocument,
  normalizeInvestorKycStatus,
  resolveExternalInvestorId,
  type StoredCreditInvestor,
  toInvestorSummary,
} from '../_lib/credit-providers/credigrupo/investorStore.js';
import { removeUndefined } from '../_lib/credit-providers/credigrupo/store.js';
import { adminDb } from '../_lib/firebaseAdmin.js';
import { isCredigrupoOwnInvestorKeyMode } from '../_lib/env.js';
import { ApiError, handleApiError, parseJsonBody, sendJson } from '../_lib/http.js';

const queryText = (value: string | string[] | undefined) =>
  String(Array.isArray(value) ? value[0] : value || '').trim();

const validInvestorDocumentId = (value: string) => /^[a-zA-Z0-9_-]{1,160}$/.test(value);

const fingerprintSecret = () => {
  const secret = String(process.env.CREDIGRUPO_WEBHOOK_SECRET || '');
  if (!secret) throw new ApiError(503, 'INVESTOR_PRIVACY_NOT_CONFIGURED', 'Cadastro de investidor indisponivel.');
  return secret;
};

const syncRemoteInvestor = async (
  localId: string,
  remote: CredigrupoInvestorResponse,
  actorUid: string,
) => {
  const reference = adminDb.doc(`creditInvestors/${localId}`);
  const snapshot = await reference.get();
  if (!snapshot.exists) throw new ApiError(404, 'INVESTOR_NOT_FOUND', 'Investidor nao encontrado.');
  const current = snapshot.data() as StoredCreditInvestor;
  const kycStatus = normalizeInvestorKycStatus(remote.kyc_status);
  const documentFingerprint = remote.document
    ? fingerprintInvestorDocument(remote.document, fingerprintSecret())
    : current.documentFingerprint;
  const manuallyDisabled = current.manuallyDisabled === true;
  await reference.set(removeUndefined({
    externalId: remote.id,
    provider: 'CREDIGRUPO',
    name: remote.name,
    email: remote.email?.trim().toLowerCase() || current.email,
    emailNormalized: remote.email?.trim().toLowerCase() || current.emailNormalized,
    documentFingerprint,
    documentMasked: remote.document ? maskInvestorDocument(remote.document) : current.documentMasked,
    kycStatus,
    externalStatus: remote.kyc_status,
    active: kycStatus === 'approved' && !manuallyDisabled,
    syncedAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
    syncedByUid: actorUid,
  }), { merge: true });
  const updated = await reference.get();
  return toInvestorSummary(updated.id, updated.data() as StoredCreditInvestor);
};

const synchronizeInvestorList = async (actorUid: string) => {
  const [remoteInvestors, localSnapshot] = await Promise.all([
    new CredigrupoClient().listInvestors(),
    adminDb.collection('creditInvestors').get(),
  ]);
  const localByExternalId = new Map<string, FirebaseFirestore.QueryDocumentSnapshot>();
  localSnapshot.docs.forEach((document) => {
    const data = document.data() as StoredCreditInvestor;
    localByExternalId.set(resolveExternalInvestorId(document.id, data), document);
  });

  const secret = fingerprintSecret();
  const batch = adminDb.batch();
  remoteInvestors.forEach((remote) => {
    const existing = localByExternalId.get(remote.id);
    const current = (existing?.data() || {}) as StoredCreditInvestor;
    const reference = existing?.ref || adminDb.collection('creditInvestors').doc();
    const kycStatus = normalizeInvestorKycStatus(remote.kyc_status);
    const manuallyDisabled = current.manuallyDisabled === true;
    batch.set(reference, removeUndefined({
      externalId: remote.id,
      provider: 'CREDIGRUPO',
      capitalOrigin: current.capitalOrigin || 'EXTERNAL',
      name: remote.name,
      email: remote.email?.trim().toLowerCase() || current.email,
      emailNormalized: remote.email?.trim().toLowerCase() || current.emailNormalized,
      documentFingerprint: remote.document
        ? fingerprintInvestorDocument(remote.document, secret)
        : current.documentFingerprint,
      documentMasked: remote.document ? maskInvestorDocument(remote.document) : current.documentMasked,
      kycStatus,
      externalStatus: remote.kyc_status,
      active: kycStatus === 'approved' && !manuallyDisabled,
      manuallyDisabled,
      createdAt: current.createdAt || FieldValue.serverTimestamp(),
      syncedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      syncedByUid: actorUid,
    }), { merge: true });
  });
  if (remoteInvestors.length > 0) await batch.commit();
};

const listLocalInvestors = async (
  eligibleOnly: boolean,
  capitalOrigin?: FundingSourceType,
) => {
  const snapshot = await adminDb.collection('creditInvestors').get();
  return snapshot.docs
    .map((document) => ({
      summary: toInvestorSummary(document.id, document.data() as StoredCreditInvestor),
      stored: document.data() as StoredCreditInvestor,
    }))
    .filter(({ stored }) => !eligibleOnly || Boolean(capitalOrigin && isStoredInvestorEligible(stored, capitalOrigin)))
    .map(({ summary }) => summary)
    .sort((left, right) => left.name.localeCompare(right.name, 'pt-BR'));
};

const getInvestorDetails = async (id: string): Promise<CredigrupoInvestorDetails> => {
  if (!validInvestorDocumentId(id)) throw new ApiError(400, 'INVALID_INVESTOR_ID', 'Investidor invalido.');
  const reference = adminDb.doc(`creditInvestors/${id}`);
  const snapshot = await reference.get();
  if (!snapshot.exists) throw new ApiError(404, 'INVESTOR_NOT_FOUND', 'Investidor nao encontrado.');
  const [loans, ledger] = await Promise.all([
    adminDb.collection('loans').where('funding.investorId', '==', id).get(),
    adminDb.collection('creditInvestorLedger').where('investorId', '==', id).get(),
  ]);
  const activeStatuses = new Set(['ATIVO', 'ATRASADO', 'ACTIVE', 'OVERDUE']);
  const completedStatuses = new Set(['QUITADO', 'COMPLETED']);
  return {
    ...toInvestorSummary(snapshot.id, snapshot.data() as StoredCreditInvestor),
    statistics: {
      operationsFinanced: loans.size,
      capitalAllocated: Number(loans.docs.reduce((total, loan) => total + Number(loan.data().amount || 0), 0).toFixed(2)),
      activeContracts: loans.docs.filter((loan) => activeStatuses.has(String(loan.data().status || '').toUpperCase())).length,
      completedContracts: loans.docs.filter((loan) => completedStatuses.has(String(loan.data().status || '').toUpperCase())).length,
      amountRepaid: Number(ledger.docs
        .filter((entry) => entry.data().type === 'INVESTOR_REPAID')
        .reduce((total, entry) => total + Number(entry.data().amount || 0), 0)
        .toFixed(2)),
    },
  };
};

const createInvestor = async (request: VercelRequest, response: VercelResponse) => {
  const actor = await requireAuthorizedActor(request);
  assertInvestorAdmin(actor);
  const input = parseJsonBody<CreateCredigrupoInvestorRequest>(request);
  const { payload, errors } = validateCredigrupoInvestorRequest(input);
  if (Object.keys(errors).length > 0) {
    throw new ApiError(400, 'INVESTOR_VALIDATION_FAILED', 'Revise os campos do investidor.', errors);
  }

  const documentFingerprint = fingerprintInvestorDocument(payload.document, fingerprintSecret());
  const [documentDuplicate, emailDuplicate] = await Promise.all([
    adminDb.collection('creditInvestors').where('documentFingerprint', '==', documentFingerprint).limit(1).get(),
    adminDb.collection('creditInvestors').where('emailNormalized', '==', payload.email).limit(1).get(),
  ]);
  if (!documentDuplicate.empty || !emailDuplicate.empty) {
    throw new ApiError(409, 'INVESTOR_ALREADY_EXISTS', 'Ja existe um investidor com o mesmo CPF ou e-mail.');
  }

  const created = await new CredigrupoClient().createInvestor(payload);
  const reference = adminDb.collection('creditInvestors').doc();
  const kycStatus = normalizeInvestorKycStatus(created.status);
  await reference.create({
    externalId: created.investorId,
    provider: 'CREDIGRUPO',
    capitalOrigin: 'EXTERNAL',
    name: payload.display_name,
    email: payload.email,
    emailNormalized: payload.email,
    documentFingerprint,
    documentMasked: maskInvestorDocument(payload.document),
    kycStatus,
    externalStatus: created.status,
    active: false,
    manuallyDisabled: false,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
    syncedAt: FieldValue.serverTimestamp(),
    createdByUid: actor.uid,
    createdByEmail: actor.email || null,
  });
  const stored = await reference.get();
  return sendJson(response, 201, {
    investor: toInvestorSummary(reference.id, stored.data() as StoredCreditInvestor),
    message: created.message,
  });
};

const updateInvestor = async (request: VercelRequest, response: VercelResponse) => {
  const actor = await requireAuthorizedActor(request);
  assertInvestorAdmin(actor);
  const input = parseJsonBody<UpdateCredigrupoInvestorRequest>(request);
  const id = String(input.id || '').trim();
  if (!validInvestorDocumentId(id)) throw new ApiError(400, 'INVESTOR_ID_REQUIRED', 'Investidor obrigatorio.');
  const reference = adminDb.doc(`creditInvestors/${id}`);
  const snapshot = await reference.get();
  if (!snapshot.exists) throw new ApiError(404, 'INVESTOR_NOT_FOUND', 'Investidor nao encontrado.');
  const stored = snapshot.data() as StoredCreditInvestor;

  if (input.action === 'SYNC') {
    const externalId = resolveExternalInvestorId(id, stored);
    const remote = await new CredigrupoClient().getInvestor(externalId);
    const investor = await syncRemoteInvestor(id, remote.data, actor.uid);
    return sendJson(response, 200, { investor });
  }
  if (input.action !== 'ACTIVATE' && input.action !== 'DEACTIVATE') {
    throw new ApiError(400, 'INVALID_INVESTOR_ACTION', 'Acao de investidor invalida.');
  }
  if (input.action === 'ACTIVATE' && normalizeInvestorKycStatus(stored.kycStatus) !== 'approved') {
    throw new ApiError(409, 'INVESTOR_NOT_APPROVED', 'Somente investidor com KYC aprovado pode ser ativado.');
  }
  await reference.set({
    active: input.action === 'ACTIVATE',
    manuallyDisabled: input.action === 'DEACTIVATE',
    updatedAt: FieldValue.serverTimestamp(),
    updatedByUid: actor.uid,
  }, { merge: true });
  const updated = await reference.get();
  return sendJson(response, 200, { investor: toInvestorSummary(id, updated.data() as StoredCreditInvestor) });
};

export default async function handler(request: VercelRequest, response: VercelResponse) {
  if (isCredigrupoOwnInvestorKeyMode()) {
    try {
      await requireAuthorizedActor(request);
      return sendJson(response, 403, {
        error: 'ACCOUNT_MODE_NOT_APPLICABLE',
        message: 'A chave propria da GR ja representa a investidora Credigrupo.',
      });
    } catch (error) {
      return handleApiError(response, error);
    }
  }
  const internalRoute = queryText(request.query.route);
  if (internalRoute === 'gr-investor') return handleGrInvestorRoute(request, response);
  if (internalRoute === 'investor-documents') return handleInvestorDocumentsRoute(request, response);

  try {
    if (request.method === 'POST') return await createInvestor(request, response);
    if (request.method === 'PATCH') return await updateInvestor(request, response);
    if (request.method !== 'GET') return sendJson(response, 405, { error: 'METHOD_NOT_ALLOWED' });

    const actor = await requireAuthorizedActor(request);
    const id = queryText(request.query.id);
    if (id) {
      assertInvestorAdmin(actor);
      return sendJson(response, 200, { investor: await getInvestorDetails(id) });
    }
    if (queryText(request.query.sync) === 'true') {
      assertInvestorAdmin(actor);
      await synchronizeInvestorList(actor.uid);
    }
    const eligibleOnly = queryText(request.query.eligibleOnly) === 'true';
    const originText = queryText(request.query.capitalOrigin).toUpperCase();
    const capitalOrigin = originText === 'GR' || originText === 'EXTERNAL'
      ? originText as FundingSourceType
      : undefined;
    if (eligibleOnly && !capitalOrigin) {
      throw new ApiError(400, 'CAPITAL_ORIGIN_REQUIRED', 'Origem do capital obrigatoria.');
    }
    return sendJson(response, 200, {
      investors: await listLocalInvestors(eligibleOnly, capitalOrigin),
    });
  } catch (error) {
    return handleApiError(response, error);
  }
}
