import crypto from 'node:crypto';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireAuthorizedActor } from '../_lib/auth.js';
import { CredigrupoClient } from '../_lib/credit-providers/credigrupo/client.js';
import { CREDIGRUPO_ACCOUNT_MODE, CREDIGRUPO_OWN_INVESTOR_NAME, getCredigrupoPublicStatus } from '../_lib/env.js';
import { adminDb } from '../_lib/firebaseAdmin.js';
import { ApiError, handleApiError, sendJson } from '../_lib/http.js';

const EXPECTED_WEBHOOK_URL = 'https://gr-solutionapk.vercel.app/api/webhooks/credigrupo';

const normalizeWebhookUrl = (value: string) => value.trim().replace(/\/+$/, '');

export const getRuntimeDiagnostics = (source: NodeJS.ProcessEnv = process.env) => {
  const apiKey = source.CREDIGRUPO_API_KEY;
  const environment = source.CREDIGRUPO_ENV;
  const enabled = source.CREDIGRUPO_ENABLED;
  const webhookSecret = source.CREDIGRUPO_WEBHOOK_SECRET;
  const accountMode = source.CREDIGRUPO_ACCOUNT_MODE;

  return {
    apiKeyPresent: Boolean(apiKey),
    apiKeyIsSandbox: apiKey?.startsWith('wl_test_') === true,
    apiKeyIsProduction: apiKey?.startsWith('wl_live_') === true,
    envPresent: Boolean(environment),
    envIsSandbox: environment === 'sandbox',
    envIsProduction: environment === 'production',
    enabledPresent: Boolean(enabled),
    integrationEnabled: enabled === 'true',
    webhookSecretPresent: Boolean(webhookSecret),
    webhookSecretLength: webhookSecret?.length ?? 0,
    webhookSecretFingerprint: webhookSecret
      ? crypto.createHash('sha256').update(webhookSecret).digest('hex').slice(0, 8)
      : null,
    accountMode: accountMode === CREDIGRUPO_ACCOUNT_MODE ? CREDIGRUPO_ACCOUNT_MODE : null,
    investor: CREDIGRUPO_OWN_INVESTOR_NAME,
  };
};

const getWebhookConfigurationDiagnostics = async () => {
  try {
    const configuration = await new CredigrupoClient({ allowWhenDisabled: true }).getWebhookConfiguration();
    const webhookUrl = typeof configuration.data?.webhookUrl === 'string'
      ? configuration.data.webhookUrl
      : null;
    const webhookSecretConfigured = typeof configuration.data?.hasSecret === 'boolean'
      ? configuration.data.hasSecret
      : null;

    return {
      webhookConfigurationAvailable: Boolean(webhookUrl) && webhookSecretConfigured !== null,
      webhookUrl,
      webhookUrlMatchesExpected: webhookUrl !== null
        && normalizeWebhookUrl(webhookUrl) === normalizeWebhookUrl(EXPECTED_WEBHOOK_URL),
      webhookSecretConfigured,
      webhookConfigurationError: null,
    };
  } catch (error) {
    const errorCode = error instanceof ApiError
      ? error.code
      : error instanceof Error && error.message.startsWith('CREDIGRUPO_')
        ? error.message
        : 'CREDIGRUPO_WEBHOOK_CONFIGURATION_UNAVAILABLE';
    return {
      webhookConfigurationAvailable: false,
      webhookUrl: null,
      webhookUrlMatchesExpected: false,
      webhookSecretConfigured: null,
      webhookConfigurationError: errorCode,
    };
  }
};

export default async function handler(request: VercelRequest, response: VercelResponse) {
  try {
    if (request.method !== 'GET') return sendJson(response, 405, { error: 'METHOD_NOT_ALLOWED' });
    response.setHeader('Cache-Control', 'private, no-store, max-age=0');
    const actor = await requireAuthorizedActor(request);
    if (request.query.diagnostic === 'true') {
      if (!actor.admin) throw new ApiError(403, 'ADMIN_REQUIRED', 'Somente administradores podem consultar o diagnostico.');
      return sendJson(response, 200, {
        ...getRuntimeDiagnostics(),
        ...await getWebhookConfigurationDiagnostics(),
      });
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
