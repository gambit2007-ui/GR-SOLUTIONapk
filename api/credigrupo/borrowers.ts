import type { VercelRequest, VercelResponse } from '@vercel/node';
import { FieldValue } from 'firebase-admin/firestore';
import type { EnsureCredigrupoBorrowerRequest } from '../../src/lib/creditProviders/types';
import { requireAuthorizedActor } from '../_lib/auth';
import { CredigrupoClient } from '../_lib/credit-providers/credigrupo/client';
import { borrowerLinkId, removeUndefined } from '../_lib/credit-providers/credigrupo/store';
import { adminDb } from '../_lib/firebaseAdmin';
import { ApiError, handleApiError, parseJsonBody, sendJson } from '../_lib/http';

const requiredText = (value: unknown, field: string): string => {
  const parsed = String(value || '').trim();
  if (!parsed) throw new ApiError(400, 'MISSING_FIELD', `Campo obrigatorio: ${field}.`);
  return parsed;
};

export default async function handler(request: VercelRequest, response: VercelResponse) {
  try {
    if (request.method !== 'POST') return sendJson(response, 405, { error: 'METHOD_NOT_ALLOWED' });
    const actor = await requireAuthorizedActor(request);
    const input = parseJsonBody<EnsureCredigrupoBorrowerRequest>(request);
    const customerId = requiredText(input.customerId, 'customerId');
    const investorId = requiredText(input.investorId, 'investorId');
    const customerRef = adminDb.doc(`clientes/${customerId}`);
    const investorRef = adminDb.doc(`creditInvestors/${investorId}`);
    const linkRef = adminDb.doc(`creditBorrowers/${borrowerLinkId(customerId, investorId)}`);
    const [customerSnapshot, investorSnapshot, linkSnapshot] = await Promise.all([
      customerRef.get(),
      investorRef.get(),
      linkRef.get(),
    ]);
    if (!customerSnapshot.exists) throw new ApiError(404, 'CUSTOMER_NOT_FOUND', 'Cliente nao encontrado.');
    if (!investorSnapshot.exists || investorSnapshot.data()?.kycStatus !== 'approved') {
      throw new ApiError(409, 'INVESTOR_NOT_APPROVED', 'Sincronize e selecione um investidor aprovado.');
    }

    const client = new CredigrupoClient();
    let borrowerId = String(linkSnapshot.data()?.borrowerId || '').trim();
    let kycStatus = String(linkSnapshot.data()?.kycStatus || '').trim();
    let ccbEligible: boolean | undefined;
    let eligibilityErrors: string[] | undefined;

    if (!borrowerId) {
      const kycData = input.kycData;
      if (!kycData || typeof kycData !== 'object') throw new ApiError(400, 'KYC_REQUIRED', 'Dados de KYC obrigatorios.');
      const monthlyIncome = Number(kycData.monthlyIncome);
      if (!Number.isFinite(monthlyIncome) || monthlyIncome <= 0) {
        throw new ApiError(400, 'INVALID_MONTHLY_INCOME', 'Informe uma renda mensal valida.');
      }

      const created = await client.registerBorrower({
        investorId,
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
    } else {
      const remote = await client.getBorrower(borrowerId);
      kycStatus = remote.data.kyc_status;
      ccbEligible = remote.data.ccb_eligible;
      eligibilityErrors = remote.data.ccb_eligible_errors;
      if (kycStatus === 'approved') {
        const eligibility = await client.getBorrowerEligibility(borrowerId);
        ccbEligible = eligibility.eligible;
        eligibilityErrors = eligibility.errors;
      }
    }

    const sharedStatus = removeUndefined({
      borrowerId,
      investorId,
      kycStatus,
      ccbEligible,
      eligibilityErrors,
      provider: 'CREDIGRUPO',
      updatedAt: FieldValue.serverTimestamp(),
      updatedByUid: actor.uid,
    });
    await Promise.all([
      linkRef.set({ ...sharedStatus, customerId }, { merge: true }),
      customerRef.set({ credigrupo: sharedStatus }, { merge: true }),
    ]);

    return sendJson(response, 200, { borrowerId, investorId, kycStatus, ccbEligible, eligibilityErrors });
  } catch (error) {
    return handleApiError(response, error);
  }
}
