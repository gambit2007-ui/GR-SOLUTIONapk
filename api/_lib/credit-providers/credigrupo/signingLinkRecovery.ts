import { FieldValue } from 'firebase-admin/firestore';
import {
  resolveCredigrupoCcbSigningLinks,
  type CredigrupoSigningUrlDiagnostic,
} from '../../../../src/lib/creditProviders/signingUrl.js';
import { adminDb } from '../../firebaseAdmin.js';
import { ApiError } from '../../http.js';
import type { StoredCredigrupoOperation } from './store.js';
import { validateCredigrupoWebhookEvent } from './webhook.js';

interface StoredWebhookEvent {
  eventId?: string;
  eventType?: string;
  proposalId?: string;
  status?: string;
  hmacValidated?: boolean;
  receivedAt?: unknown;
  payload?: unknown;
}

export interface CredigrupoSigningLinkRecoveryResult {
  recovered: true;
  alreadyRecovered: boolean;
  source: 'EVENT';
  eventId: string;
  hmacValidated: true;
  borrowerHostname: string;
  investorHostname?: string;
  investorPreSigned: boolean;
  borrowerSignUrlPresent: true;
  investorSignUrlPresent: boolean;
  status: 'AWAITING_SIGNATURES';
  externalStatus?: string;
  formalizationStatus?: string;
}

const toSafeDiagnostics = (diagnostics: {
  borrower?: CredigrupoSigningUrlDiagnostic;
  investor?: CredigrupoSigningUrlDiagnostic;
}) => ({
  ...(diagnostics.borrower ? { borrower: diagnostics.borrower } : {}),
  ...(diagnostics.investor ? { investor: diagnostics.investor } : {}),
});

const hasValidatedInboxEvidence = (
  eventId: string,
  event: StoredWebhookEvent,
): boolean => event.hmacValidated === true || (
  event.eventId === eventId
  && Boolean(event.receivedAt)
  && event.status === 'PROCESSED'
);

export const recoverCredigrupoCcbSigningLinksFromInbox = async (
  operationId: string,
): Promise<CredigrupoSigningLinkRecoveryResult> => {
  const operationRef = adminDb.doc(`creditOperations/${operationId}`);
  const operationSnapshot = await operationRef.get();
  if (!operationSnapshot.exists) {
    throw new ApiError(404, 'CREDIGRUPO_OPERATION_NOT_FOUND', 'Operacao nao encontrada.');
  }

  const operation = operationSnapshot.data() as StoredCredigrupoOperation;
  const proposalId = String(operation.proposalId || '').trim();
  if (!proposalId) {
    throw new ApiError(409, 'CREDIGRUPO_PROPOSAL_ID_REQUIRED', 'A operacao ainda nao possui proposta externa.');
  }
  if (operation.status !== 'AWAITING_SIGNATURES') {
    throw new ApiError(409, 'CREDIGRUPO_OPERATION_NOT_AWAITING_SIGNATURES', 'A operacao nao esta aguardando assinaturas.');
  }

  const eventSnapshot = await adminDb.collection('creditWebhookEvents')
    .where('proposalId', '==', proposalId)
    .limit(20)
    .get();
  const candidates = eventSnapshot.docs.filter((document) => {
    const data = document.data() as StoredWebhookEvent;
    return data.eventType === 'ccb_ready_for_signature' && data.status === 'PROCESSED';
  });

  if (candidates.length === 0) {
    throw new ApiError(404, 'CREDIGRUPO_CCB_EVENT_NOT_FOUND', 'Evento CCB processado nao encontrado.');
  }
  if (candidates.length !== 1) {
    throw new ApiError(409, 'CREDIGRUPO_CCB_EVENT_AMBIGUOUS', 'Mais de um evento CCB corresponde a operacao.');
  }

  const eventDocument = candidates[0];
  const storedEvent = eventDocument.data() as StoredWebhookEvent;
  if (!hasValidatedInboxEvidence(eventDocument.id, storedEvent)) {
    throw new ApiError(409, 'CREDIGRUPO_EVENT_HMAC_NOT_VALIDATED', 'O evento nao possui evidencia de validacao HMAC.');
  }

  const event = validateCredigrupoWebhookEvent(storedEvent.payload);
  if (event.event !== 'ccb_ready_for_signature' || String(event.data.proposalId || '').trim() !== proposalId) {
    throw new ApiError(409, 'CREDIGRUPO_CCB_EVENT_MISMATCH', 'O evento nao corresponde a operacao informada.');
  }

  const links = resolveCredigrupoCcbSigningLinks(
    event.data.borrowerSignUrl,
    event.data.investorSignUrl,
  );
  if (!links.valid || !links.borrower) {
    const diagnostics = toSafeDiagnostics(links.diagnostics);
    await eventDocument.ref.set({
      signingLinkRecovery: {
        status: 'REJECTED',
        diagnostics,
        updatedAt: FieldValue.serverTimestamp(),
      },
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    throw new ApiError(422, 'CREDIGRUPO_SIGN_URL_NOT_ALLOWED', 'Os links de assinatura nao pertencem a um host oficial permitido.', diagnostics);
  }
  const borrowerLink = links.borrower;

  const alreadyRecovered = await adminDb.runTransaction(async (transaction) => {
    const [currentOperationSnapshot, currentEventSnapshot] = await Promise.all([
      transaction.get(operationRef),
      transaction.get(eventDocument.ref),
    ]);
    const currentOperation = currentOperationSnapshot.data() as StoredCredigrupoOperation | undefined;
    const currentEvent = currentEventSnapshot.data() as StoredWebhookEvent | undefined;
    if (!currentOperationSnapshot.exists || currentOperation?.proposalId !== proposalId) {
      throw new ApiError(409, 'CREDIGRUPO_OPERATION_CHANGED', 'A operacao mudou durante a recuperacao.');
    }
    if (!currentEventSnapshot.exists || currentEvent?.status !== 'PROCESSED') {
      throw new ApiError(409, 'CREDIGRUPO_EVENT_CHANGED', 'O evento mudou durante a recuperacao.');
    }

    const recovered = currentOperation.borrowerSignUrl === borrowerLink.url
      && currentOperation.investorSignUrl === links.investor?.url
      && Boolean(currentOperation.investorSignaturePreSigned) === links.investorPreSigned
      && currentOperation.status === 'AWAITING_SIGNATURES';
    if (recovered) return true;

    transaction.set(operationRef, {
      status: 'AWAITING_SIGNATURES',
      borrowerSignUrl: borrowerLink.url,
      investorSignUrl: links.investor?.url || FieldValue.delete(),
      investorSignaturePreSigned: links.investorPreSigned,
      signingLinksReconciledAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    transaction.set(eventDocument.ref, {
      signingLinkRecovery: {
        status: 'PROCESSED',
        borrowerHostname: borrowerLink.hostname,
        investorHostname: links.investor?.hostname || null,
        investorPreSigned: links.investorPreSigned,
        updatedAt: FieldValue.serverTimestamp(),
      },
      signingLinksReprocessedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    return false;
  });

  return {
    recovered: true,
    alreadyRecovered,
    source: 'EVENT',
    eventId: eventDocument.id,
    hmacValidated: true,
    borrowerHostname: borrowerLink.hostname,
    investorHostname: links.investor?.hostname,
    investorPreSigned: links.investorPreSigned,
    borrowerSignUrlPresent: true,
    investorSignUrlPresent: Boolean(links.investor) || links.investorPreSigned,
    status: 'AWAITING_SIGNATURES',
    externalStatus: operation.externalStatus,
    formalizationStatus: operation.formalizationStatus,
  };
};
