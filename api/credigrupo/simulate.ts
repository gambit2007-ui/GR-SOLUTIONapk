import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Timestamp } from 'firebase-admin/firestore';
import type { CredigrupoSimulationRequest } from '../../src/lib/creditProviders/types.js';
import { requireAuthorizedActor } from '../_lib/auth.js';
import { CredigrupoClient } from '../_lib/credit-providers/credigrupo/client.js';
import { requireSandboxTestCustomer } from '../_lib/credit-providers/credigrupo/dataScope.js';
import { borrowerLinkId, removeUndefined } from '../_lib/credit-providers/credigrupo/store.js';
import { CREDIGRUPO_ACCOUNT_MODE } from '../_lib/env.js';
import { adminDb } from '../_lib/firebaseAdmin.js';
import { ApiError, handleApiError, parseJsonBody, sendJson } from '../_lib/http.js';

export default async function handler(request: VercelRequest, response: VercelResponse) {
  try {
    if (request.method !== 'POST') return sendJson(response, 405, { error: 'METHOD_NOT_ALLOWED' });
    const actor = await requireAuthorizedActor(request);
    const input = parseJsonBody<CredigrupoSimulationRequest>(request);
    const customerId = String(input.customerId || '').trim();
    if (!customerId) throw new ApiError(400, 'CUSTOMER_REQUIRED', 'Cliente obrigatorio.');
    if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) throw new ApiError(400, 'INVALID_AMOUNT', 'Valor invalido.');
    if (!Number.isInteger(input.installments) || input.installments < 1 || input.installments > 60) {
      throw new ApiError(400, 'INVALID_INSTALLMENTS', 'Parcelas devem estar entre 1 e 60.');
    }

    if (input.fundingSource !== 'GR') {
      throw new ApiError(400, 'INVALID_FUNDING_SOURCE', 'A chave propria Credigrupo aceita somente capital da GR.');
    }

    const [customerSnapshot, borrowerSnapshot] = await Promise.all([
      adminDb.doc(`clientes/${customerId}`).get(),
      adminDb.doc(`creditBorrowers/${borrowerLinkId(customerId, CREDIGRUPO_ACCOUNT_MODE)}`).get(),
    ]);
    if (!customerSnapshot.exists) throw new ApiError(404, 'CUSTOMER_NOT_FOUND', 'Cliente nao encontrado.');
    requireSandboxTestCustomer(customerSnapshot.data() || {});
    if (!borrowerSnapshot.exists) throw new ApiError(409, 'BORROWER_NOT_SYNCED', 'Sincronize o tomador antes de simular.');
    const borrower = borrowerSnapshot.data() || {};
    if (borrower.environment !== 'sandbox' || borrower.testData !== true || borrower.archived) {
      throw new ApiError(409, 'BORROWER_ENVIRONMENT_UNCONFIRMED', 'Vinculo do tomador nao confirmado para sandbox.');
    }
    if (borrower.kycStatus !== 'approved') throw new ApiError(409, 'KYC_NOT_APPROVED', 'KYC ainda nao aprovado.');
    if (borrower.ccbEligible !== true) {
      throw new ApiError(409, 'CCB_NOT_ELIGIBLE', 'Tomador nao elegivel para CCB.', borrower.eligibilityErrors);
    }

    const remote = await new CredigrupoClient().simulateLoan({
      borrowerId: String(borrower.borrowerId),
      amountCents: input.amountCents,
      installments: input.installments,
      interestRate: Number(input.interestRate),
      firstPaymentDate: input.firstPaymentDate,
      frequency: input.frequency,
      interestType: input.interestType,
    });
    const simulationRef = adminDb.collection('creditSimulations').doc();
    const now = Timestamp.now();
    await simulationRef.set(removeUndefined({
      environment: 'sandbox',
      testData: true,
      customerId,
      customerName: customerSnapshot.data()?.name || 'CLIENTE',
      customerPhone: customerSnapshot.data()?.phone,
      borrowerId: String(borrower.borrowerId),
      accountMode: CREDIGRUPO_ACCOUNT_MODE,
      investorType: 'GR',
      request: { ...input, fundingSource: 'GR' },
      response: remote,
      createdByUid: actor.uid,
      createdAt: now,
      expiresAt: Timestamp.fromMillis(now.toMillis() + 30 * 60 * 1000),
    }));

    return sendJson(response, 200, { simulationId: simulationRef.id, ...remote });
  } catch (error) {
    return handleApiError(response, error);
  }
}
