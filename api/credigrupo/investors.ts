import type { VercelRequest, VercelResponse } from '@vercel/node';
import { FieldValue } from 'firebase-admin/firestore';
import { requireAuthorizedActor } from '../_lib/auth';
import { adminDb } from '../_lib/firebaseAdmin';
import { handleApiError, sendJson } from '../_lib/http';
import { CredigrupoClient } from '../_lib/credit-providers/credigrupo/client';

export default async function handler(request: VercelRequest, response: VercelResponse) {
  try {
    if (request.method !== 'GET') return sendJson(response, 405, { error: 'METHOD_NOT_ALLOWED' });
    await requireAuthorizedActor(request);

    const investors = await new CredigrupoClient().listInvestors();
    const batch = adminDb.batch();
    investors.forEach((investor) => {
      batch.set(adminDb.doc(`creditInvestors/${investor.id}`), {
        externalId: investor.id,
        name: investor.name,
        email: investor.email || null,
        kycStatus: investor.kyc_status,
        provider: 'CREDIGRUPO',
        syncedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
    });
    if (investors.length > 0) await batch.commit();

    return sendJson(response, 200, {
      investors: investors.map((investor) => ({
        id: investor.id,
        name: investor.name,
        email: investor.email,
        kycStatus: investor.kyc_status,
      })),
    });
  } catch (error) {
    return handleApiError(response, error);
  }
}
