import crypto from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { getRuntimeDiagnostics } from '../status';

describe('diagnostico seguro do runtime Credigrupo', () => {
  it('expoe somente presenca, comprimento e fingerprint curto do secret bruto', () => {
    const webhookSecret = 'official-short-secret';
    const diagnostics = getRuntimeDiagnostics({
      CREDIGRUPO_API_KEY: 'wl_test_example',
      CREDIGRUPO_ENV: 'sandbox',
      CREDIGRUPO_ENABLED: 'true',
      CREDIGRUPO_WEBHOOK_SECRET: webhookSecret,
      CREDIGRUPO_ACCOUNT_MODE: 'OWN_INVESTOR_KEY',
    });

    expect(diagnostics).toMatchObject({
      apiKeyPresent: true,
      apiKeyIsSandbox: true,
      webhookSecretPresent: true,
      webhookSecretLength: webhookSecret.length,
      webhookSecretFingerprint: crypto.createHash('sha256').update(webhookSecret).digest('hex').slice(0, 8),
    });
    expect(JSON.stringify(diagnostics)).not.toContain(webhookSecret);
  });

  it('nao cria fingerprint para secret ausente', () => {
    const diagnostics = getRuntimeDiagnostics({
      CREDIGRUPO_API_KEY: 'wl_test_example',
      CREDIGRUPO_ENV: 'sandbox',
      CREDIGRUPO_ENABLED: 'true',
      CREDIGRUPO_ACCOUNT_MODE: 'OWN_INVESTOR_KEY',
    });

    expect(diagnostics.webhookSecretPresent).toBe(false);
    expect(diagnostics.webhookSecretLength).toBe(0);
    expect(diagnostics.webhookSecretFingerprint).toBeNull();
  });
});
