import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireAuthorizedActor } from '../_lib/auth.js';
import { CREDIGRUPO_ACCOUNT_MODE, CREDIGRUPO_OWN_INVESTOR_NAME, getCredigrupoPublicStatus } from '../_lib/env.js';
import { adminDb } from '../_lib/firebaseAdmin.js';
import { ApiError, handleApiError, sendJson } from '../_lib/http.js';

const getRuntimeDiagnostics = () => {
  const apiKey = process.env.CREDIGRUPO_API_KEY;
  const environment = process.env.CREDIGRUPO_ENV;
  const enabled = process.env.CREDIGRUPO_ENABLED;
  const webhookSecret = process.env.CREDIGRUPO_WEBHOOK_SECRET;
  const accountMode = process.env.CREDIGRUPO_ACCOUNT_MODE;

  return {
    apiKeyPresent: Boolean(apiKey),
    apiKeyIsSandbox: apiKey?.startsWith('wl_test_') === true,
    envPresent: Boolean(environment),
    envIsSandbox: environment === 'sandbox',
    enabledPresent: Boolean(enabled),
    integrationEnabled: enabled === 'true',
    webhookSecretPresent: Boolean(webhookSecret),
    accountMode: accountMode === CREDIGRUPO_ACCOUNT_MODE ? CREDIGRUPO_ACCOUNT_MODE : null,
    investor: CREDIGRUPO_OWN_INVESTOR_NAME,
  };
};

export default async function handler(request: VercelRequest, response: VercelResponse) {
  try {
    if (request.method !== 'GET') return sendJson(response, 405, { error: 'METHOD_NOT_ALLOWED' });
    response.setHeader('Cache-Control', 'private, no-store, max-age=0');
    const actor = await requireAuthorizedActor(request);
    if (request.query.diagnostic === 'true') {
      if (!actor.admin) throw new ApiError(403, 'ADMIN_REQUIRED', 'Somente administradores podem consultar o diagnostico.');
      return sendJson(response, 200, getRuntimeDiagnostics());
    }
    const operations = await adminDb.collection('creditOperations').limit(1).get();
    return sendJson(response, 200, {
      ...getCredigrupoPublicStatus(),
      hasExistingOperations: !operations.empty,
      isAdmin: actor.admin,
    });
  } catch (error) {
    return handleApiError(response, error);
  }
}
