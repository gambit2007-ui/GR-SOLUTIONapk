import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireAuthorizedActor } from '../_lib/auth';
import { getCredigrupoPublicStatus } from '../_lib/env';
import { adminDb } from '../_lib/firebaseAdmin';
import { handleApiError, sendJson } from '../_lib/http';

export default async function handler(request: VercelRequest, response: VercelResponse) {
  try {
    if (request.method !== 'GET') return sendJson(response, 405, { error: 'METHOD_NOT_ALLOWED' });
    await requireAuthorizedActor(request);
    const operations = await adminDb.collection('creditOperations').limit(1).get();
    return sendJson(response, 200, { ...getCredigrupoPublicStatus(), hasExistingOperations: !operations.empty });
  } catch (error) {
    return handleApiError(response, error);
  }
}
