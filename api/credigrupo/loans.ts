import type { VercelRequest, VercelResponse } from '@vercel/node';
import { FieldValue } from 'firebase-admin/firestore';
import type { CreateBancarizedLoanRequest } from '../../src/lib/creditProviders/types';
import { requireAuthorizedActor } from '../_lib/auth';
import { CredigrupoClient } from '../_lib/credit-providers/credigrupo/client';
import { reserveCredigrupoOperation } from '../_lib/credit-providers/credigrupo/store';
import { adminDb } from '../_lib/firebaseAdmin';
import { ApiError, handleApiError, parseJsonBody, sendJson } from '../_lib/http';

export default async function handler(request: VercelRequest, response: VercelResponse) {
  try {
    if (request.method !== 'POST') return sendJson(response, 405, { error: 'METHOD_NOT_ALLOWED' });
    const actor = await requireAuthorizedActor(request);
    const input = parseJsonBody<CreateBancarizedLoanRequest>(request);
    if (!/^[a-zA-Z0-9_-]{8,160}$/.test(String(input.operationId || ''))) {
      throw new ApiError(400, 'INVALID_OPERATION_ID', 'Identificador da operacao invalido.');
    }
    if (input.fundingSource !== 'GR' && input.fundingSource !== 'EXTERNAL') {
      throw new ApiError(400, 'INVALID_FUNDING_SOURCE', 'Origem do capital invalida.');
    }
    const reserved = await reserveCredigrupoOperation(input, actor);
    if (reserved.duplicate) {
      if (!reserved.operation.proposalId || !reserved.operation.requestId || !reserved.operation.pix) {
        throw new ApiError(409, 'BANCARIZATION_PENDING', 'A bancarizacao ja esta em processamento.');
      }
      return sendJson(response, 200, {
        operationId: input.operationId,
        proposalId: reserved.operation.proposalId,
        requestId: reserved.operation.requestId,
        status: reserved.operation.externalStatus,
        pix: reserved.operation.pix,
        duplicate: true,
      });
    }

    try {
      const created = await new CredigrupoClient().createLoan({
        investorId: reserved.operation.investorId,
        borrowerId: reserved.operation.borrowerId,
        amountCents: reserved.operation.amountCents,
        installments: reserved.operation.installments,
        interestRate: reserved.operation.interestRate,
        firstPaymentDate: reserved.operation.firstPaymentDate,
        frequency: reserved.operation.frequency,
        interestType: reserved.operation.interestType,
        notes: `GR_OPERATION:${input.operationId}`,
        ccbSimulationData: { simulation: reserved.operation.simulation },
      });
      const localLoanId = adminDb.collection('loans').doc().id;
      await adminDb.doc(`creditOperations/${input.operationId}`).update({
        proposalId: created.proposalId,
        requestId: created.requestId,
        externalStatus: created.status,
        status: 'AWAITING_LENDER_PAYMENT',
        pix: created.pix,
        localLoanId,
        updatedAt: FieldValue.serverTimestamp(),
      });
      return sendJson(response, 201, { operationId: input.operationId, ...created, duplicate: false });
    } catch (error) {
      await adminDb.doc(`creditOperations/${input.operationId}`).set({
        status: 'RECONCILIATION_REQUIRED',
        lastErrorCode: error instanceof ApiError ? error.code : 'UNKNOWN_PROVIDER_ERROR',
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
      throw error;
    }
  } catch (error) {
    return handleApiError(response, error);
  }
}
