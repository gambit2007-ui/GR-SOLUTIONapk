const CREDIGRUPO_BASE_URL = 'https://emprestapro-api-9i5ez.ondigitalocean.app/api/v1/whitelabel';

export interface CredigrupoServerConfig {
  apiKey: string;
  webhookSecret: string;
  environment: 'sandbox';
  baseUrl: string;
}

export const getCredigrupoPublicStatus = () => {
  const enabled = String(process.env.CREDIGRUPO_ENABLED || '').toLowerCase() === 'true';
  const apiKey = String(process.env.CREDIGRUPO_API_KEY || '').trim();
  const environment = String(process.env.CREDIGRUPO_ENV || 'sandbox').toLowerCase();
  const configured = apiKey.startsWith('wl_test_') && environment === 'sandbox';

  return {
    enabled: enabled && configured,
    configured,
    environment: 'sandbox' as const,
    provider: 'CREDIGRUPO' as const,
    message: !enabled
      ? 'Integracao desativada por configuracao.'
      : !configured
        ? 'Credenciais de sandbox nao configuradas.'
        : undefined,
  };
};

export const getCredigrupoServerConfig = (options?: { allowWhenDisabled?: boolean }): CredigrupoServerConfig => {
  const enabled = String(process.env.CREDIGRUPO_ENABLED || '').toLowerCase() === 'true';
  const environment = String(process.env.CREDIGRUPO_ENV || 'sandbox').toLowerCase();
  const apiKey = String(process.env.CREDIGRUPO_API_KEY || '').trim();
  const webhookSecret = String(process.env.CREDIGRUPO_WEBHOOK_SECRET || '').trim();

  if (!enabled && !options?.allowWhenDisabled) throw new Error('CREDIGRUPO_DISABLED');
  if (environment !== 'sandbox') throw new Error('CREDIGRUPO_PRODUCTION_BLOCKED');
  if (apiKey.startsWith('wl_live_')) throw new Error('CREDIGRUPO_LIVE_KEY_BLOCKED');
  if (!apiKey.startsWith('wl_test_')) throw new Error('CREDIGRUPO_SANDBOX_KEY_REQUIRED');

  return {
    apiKey,
    webhookSecret,
    environment: 'sandbox',
    baseUrl: CREDIGRUPO_BASE_URL,
  };
};
