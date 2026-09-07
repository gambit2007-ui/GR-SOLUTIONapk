import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireAuthorizedActor } from '../_lib/auth.js';
import { StoredCredigrupoOperation, toOperationSummary } from '../_lib/credit-providers/credigrupo/store.js';
import { getCredigrupoServerConfig } from '../_lib/env.js';
import { adminDb } from '../_lib/firebaseAdmin.js';
import { handleApiError, sendJson } from '../_lib/http.js';

export default async function handler(request: VercelRequest, response: VercelResponse) {
  try {
    if (request.method !== 'GET') return sendJson(response, 405, { error: 'METHOD_NOT_ALLOWED' });
    await requireAuthorizedActor(request);
    const { environment } = getCredigrupoServerConfig({ allowWhenDisabled: true });
    const snapshot = await adminDb.collection('creditOperations').orderBy('createdAt', 'desc').limit(50).get();
    return sendJson(response, 200, {
      operations: snapshot.docs
        .filter((document) => !document.data().archived && !document.data().archivedAt
          // Legacy sandbox records lacked the explicit environment marker.
          && (environment === 'sandbox'
            ? document.data().environment !== 'production'
            : document.data().environment === environment))
        .map((document) => toOperationSummary(document.id, document.data() as StoredCredigrupoOperation)),
    });
  } catch (error) {
    return handleApiError(response, error);
  }
}
