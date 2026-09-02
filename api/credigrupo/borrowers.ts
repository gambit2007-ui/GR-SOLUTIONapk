import type { VercelRequest, VercelResponse } from '@vercel/node';
import { FieldValue } from 'firebase-admin/firestore';
import type { EnsureCredigrupoBorrowerRequest } from '../../src/lib/creditProviders/types.js';
import { requireAuthorizedActor } from '../_lib/auth.js';
import {
  createBorrowerPersistencePayload,
  createSafeBorrowerState,
  normalizeBorrowerDisplayName,
} from '../_lib/credit-providers/credigrupo/borrowerState.js';
import { CredigrupoClient } from '../_lib/credit-providers/credigrupo/client.js';
import { borrowerLinkId, removeUndefined } from '../_lib/credit-providers/credigrupo/store.js';
import { CREDIGRUPO_ACCOUNT_MODE } from '../_lib/env.js';
import { adminDb } from '../_lib/firebaseAdmin.js';
import { ApiError, handleApiError, parseJsonBody, sendJson } from '../_lib/http.js';

const requiredText = (value: unknown, field: string): string => {
  const parsed = String(value || '').trim();
  if (!parsed) throw new ApiError(400, 'MISSING_FIELD', `Campo obrigatorio: ${field}.`);
  return parsed;
};

export default async function handler(request: VercelRequest, response: VercelResponse) {
  try {
    if (!['GET', 'POST'].includes(request.method || '')) return sendJson(response, 405, { error: 'METHOD_NOT_ALLOWED' });
    await requireAuthorizedActor(request);
    if (request.method === 'GET') {
      const customerId = requiredText(request.query.customerId, 'customerId');
      const linkSnapshot = await adminDb
        .doc(`creditBorrowers/${borrowerLinkId(customerId, CREDIGRUPO_ACCOUNT_MODE)}`)
        .get();
      if (!linkSnapshot.exists) {
        throw new ApiError(404, 'BORROWER_NOT_SYNCED', 'Tomador ainda nao sincronizado.');
      }
      const link = linkSnapshot.data() || {};
      return sendJson(response, 200, createSafeBorrowerState({
        borrowerId: link.borrowerId,
        kycStatus: link.kycStatus,
        ccbEligible: link.ccbEligible,
        eligibilityErrors: link.eligibilityErrors,
        eligibilityCachedAt: link.eligibilityCachedAt,
      }));
    }
    const input = parseJsonBody<EnsureCredigrupoBorrowerRequest>(request);
    const customerId = requiredText(input.customerId, 'customerId');
    if (input.fundingSource !== 'GR') {
      throw new ApiError(400, 'INVALID_FUNDING_SOURCE', 'A chave propria Credigrupo aceita somente capital da GR.');
    }
    const customerRef = adminDb.doc(`clientes/${customerId}`);
    const linkRef = adminDb.doc(`creditBorrowers/${borrowerLinkId(customerId, CREDIGRUPO_ACCOUNT_MODE)}`);
    const [customerSnapshot, linkSnapshot] = await Promise.all([
      customerRef.get(),
      linkRef.get(),
    ]);
    if (!customerSnapshot.exists) throw new ApiError(404, 'CUSTOMER_NOT_FOUND', 'Cliente nao encontrado.');
    const client = new CredigrupoClient();
    let borrowerId = String(linkSnapshot.data()?.borrowerId || '').trim();
    let kycStatus = String(linkSnapshot.data()?.kycStatus || '').trim();
    let ccbEligible: boolean | undefined;
    let eligibilityErrors: string[] | undefined;
    let eligibilityCachedAt: string | undefined;

    if (!borrowerId) {
      const kycData = input.kycData;
      if (!kycData || typeof kycData !== 'object') throw new ApiError(400, 'KYC_REQUIRED', 'Dados de KYC obrigatorios.');
      const monthlyIncome = Number(kycData.monthlyIncome);
      if (!Number.isFinite(monthlyIncome) || monthlyIncome <= 0) {
        throw new ApiError(400, 'INVALID_MONTHLY_INCOME', 'Informe uma renda mensal valida.');
      }

      const created = await client.registerBorrower({
        email: requiredText(input.email, 'email'),
        display_name: requiredText(input.displayName, 'displayName'),
        phone: requiredText(input.phone, 'phone'),
        document: requiredText(input.document, 'document'),
        birth_date: requiredText(input.birthDate, 'birthDate'),
        kyc_data: removeUndefined({
          ...kycData,
          address_street: requiredText(kycData.address_street, 'address_street'),
          address_number: requiredText(kycData.address_number, 'address_number'),
          address_neighborhood: requiredText(kycData.address_neighborhood, 'address_neighborhood'),
          address_city: requiredText(kycData.address_city, 'address_city'),
          address_state: requiredText(kycData.address_state, 'address_state'),
          address_zip: requiredText(kycData.address_zip, 'address_zip'),
          documentNumber: requiredText(kycData.documentNumber, 'documentNumber'),
          issueDate: requiredText(kycData.issueDate, 'issueDate'),
          bankCode: requiredText(kycData.bankCode, 'bankCode'),
          bankAgency: requiredText(kycData.bankAgency, 'bankAgency'),
          bankAccount: requiredText(kycData.bankAccount, 'bankAccount'),
          pixKey: requiredText(kycData.pixKey, 'pixKey'),
        }),
      });
      borrowerId = created.borrowerId;
      kycStatus = created.status;
      if (kycStatus === 'approved') {
        const eligibility = await client.getBorrowerEligibility(borrowerId);
        ccbEligible = eligibility.eligible;
        eligibilityErrors = eligibility.errors;
        eligibilityCachedAt = eligibility.cachedAt;
      }
    } else {
      let remote = await client.getBorrower(borrowerId);
      const displayName = normalizeBorrowerDisplayName(input.displayName);
      const remoteDisplayName = String(remote.data.name || '').trim();
      if (displayName && displayName !== remoteDisplayName) {
        const updated = await client.updateBorrowerDisplayName(borrowerId, displayName);
        if (!updated.success || updated.borrowerId !== borrowerId) {
          throw new ApiError(502, 'BORROWER_UPDATE_MISMATCH', 'A Credigrupo nao confirmou a atualizacao do tomador.');
        }
        remote = await client.getBorrower(borrowerId);
      }
      kycStatus = remote.data.kyc_status;
      ccbEligible = remote.data.ccb_eligible;
      eligibilityErrors = remote.data.ccb_eligible_errors;
      if (kycStatus === 'approved') {
        const eligibility = await client.getBorrowerEligibility(borrowerId);
        ccbEligible = eligibility.eligible;
        eligibilityErrors = eligibility.errors;
        eligibilityCachedAt = eligibility.cachedAt;
      }
    }

    const safeState = createSafeBorrowerState({
      borrowerId,
      kycStatus,
      ccbEligible,
      eligibilityErrors,
      eligibilityCachedAt,
    });
    const sharedStatus = createBorrowerPersistencePayload(safeState, FieldValue.serverTimestamp());

    console.info('[Credigrupo borrower eligibility]', {
      borrowerId,
      kycStatus,
      eligibilityReturned: safeState.ccbEligible !== null,
      eligible: safeState.ccbEligible,
      errorsCount: safeState.eligibilityErrors.length,
      cachedAtPresent: Boolean(safeState.eligibilityCachedAt),
      httpStatus: 200,
    });

    await Promise.all([
      linkRef.set({ ...sharedStatus, customerId }, { merge: true }),
      customerRef.set({ credigrupo: sharedStatus }, { merge: true }),
    ]);

    return sendJson(response, 200, safeState);
  } catch (error) {
    return handleApiError(response, error);
  }
}
