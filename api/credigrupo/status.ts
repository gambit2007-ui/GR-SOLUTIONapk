import crypto from 'node:crypto';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireAuthorizedActor } from '../_lib/auth.js';
import { CredigrupoClient } from '../_lib/credit-providers/credigrupo/client.js';
import { getCredigrupoPublicStatus } from '../_lib/env.js';
import { adminDb } from '../_lib/firebaseAdmin.js';
import { ApiError, handleApiError, sendJson } from '../_lib/http.js';

const hasValidPrivateKey = (value: string): boolean => {
  if (!value.includes('-----BEGIN PRIVATE KEY-----') || !value.includes('-----END PRIVATE KEY-----')) return false;
  try {
    crypto.createPrivateKey(value);
    return true;
  } catch {
    return false;
  }
};

const getRuntimeDiagnostics = async () => {
  const apiKey = String(process.env.CREDIGRUPO_API_KEY || '').trim();
  const webhookSecret = String(process.env.CREDIGRUPO_WEBHOOK_SECRET || '').trim();
  const firebasePrivateKey = String(process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n').trim();
  const checks = {
    credigrupoApiKey: Boolean(apiKey),
    credigrupoTestKey: apiKey.startsWith('wl_test_') && !apiKey.startsWith('wl_live_'),
    credigrupoEnv: String(process.env.CREDIGRUPO_ENV || '').trim() === 'sandbox',
    credigrupoEnabled: String(process.env.CREDIGRUPO_ENABLED || '').trim().toLowerCase() === 'true',
    webhookSecret: webhookSecret.length >= 32,
    firebaseProjectId: String(process.env.FIREBASE_PROJECT_ID || '').trim() === 'grsolution-8e6cb',
    firebaseClientEmail: Boolean(String(process.env.FIREBASE_CLIENT_EMAIL || '').trim()),
    firebasePrivateKey: hasValidPrivateKey(firebasePrivateKey),
  };
  if (!Object.values(checks).every(Boolean)) {
    return { checks, services: { firebaseAdmin: false, credigrupo: false } };
  }

  const [firebaseResult, credigrupoResult] = await Promise.allSettled([
    adminDb.doc('settings/accessControl').get(),
    new CredigrupoClient().getEarnings(),
  ]);
  return {
    checks,
    services: {
      firebaseAdmin: firebaseResult.status === 'fulfilled',
      credigrupo: credigrupoResult.status === 'fulfilled',
    },
  };
};

export default async function handler(request: VercelRequest, response: VercelResponse) {
  try {
    if (request.method !== 'GET') return sendJson(response, 405, { error: 'METHOD_NOT_ALLOWED' });
    const actor = await requireAuthorizedActor(request);
    if (request.query.diagnostic === 'true') {
      if (!actor.admin) throw new ApiError(403, 'ADMIN_REQUIRED', 'Somente administradores podem consultar o diagnostico.');
      const diagnostics = await getRuntimeDiagnostics();
      const runtimeOk = [...Object.values(diagnostics.checks), ...Object.values(diagnostics.services)].every(Boolean);
      return sendJson(response, runtimeOk ? 200 : 503, diagnostics);
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
