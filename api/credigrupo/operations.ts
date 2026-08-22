import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireAuthorizedActor } from '../_lib/auth';
import { StoredCredigrupoOperation, toOperationSummary } from '../_lib/credit-providers/credigrupo/store';
import { adminDb } from '../_lib/firebaseAdmin';
import { handleApiError, sendJson } from '../_lib/http';

export default async function handler(request: VercelRequest, response: VercelResponse) {
  try {
    if (request.method !== 'GET') return sendJson(response, 405, { error: 'METHOD_NOT_ALLOWED' });
    await requireAuthorizedActor(request);
    const snapshot = await adminDb.collection('creditOperations').orderBy('createdAt', 'desc').limit(50).get();
    return sendJson(response, 200, {
      operations: snapshot.docs.map((document) => toOperationSummary(document.id, document.data() as StoredCredigrupoOperation)),
    });
  } catch (error) {
    return handleApiError(response, error);
  }
}
