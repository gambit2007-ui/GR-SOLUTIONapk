const CREDIGRUPO_BASE_URL = 'https://emprestapro-api-9i5ez.ondigitalocean.app/api/v1/whitelabel';

export type CredigrupoConfigurationIssue =
  | 'CREDIGRUPO_API_KEY_MISSING'
  | 'CREDIGRUPO_SANDBOX_KEY_REQUIRED'
  | 'CREDIGRUPO_LIVE_KEY_BLOCKED'
  | 'CREDIGRUPO_ENV_INVALID'
  | 'CREDIGRUPO_WEBHOOK_SECRET_MISSING'
  | 'CREDIGRUPO_WEBHOOK_SECRET_TOO_SHORT';

export interface CredigrupoServerConfig {
  apiKey: string;
  webhookSecret: string;
  environment: 'sandbox';
  baseUrl: string;
}

export const evaluateCredigrupoConfiguration = (source: NodeJS.ProcessEnv = process.env) => {
  const requestedEnabled = String(source.CREDIGRUPO_ENABLED || '').toLowerCase() === 'true';
  const apiKey = String(source.CREDIGRUPO_API_KEY || '').trim();
  const environment = String(source.CREDIGRUPO_ENV || '').trim().toLowerCase();
  const webhookSecret = String(source.CREDIGRUPO_WEBHOOK_SECRET || '').trim();
  const issues: CredigrupoConfigurationIssue[] = [];

  if (!apiKey) issues.push('CREDIGRUPO_API_KEY_MISSING');
  else if (apiKey.startsWith('wl_live_')) issues.push('CREDIGRUPO_LIVE_KEY_BLOCKED');
  else if (!apiKey.startsWith('wl_test_')) issues.push('CREDIGRUPO_SANDBOX_KEY_REQUIRED');
  if (environment !== 'sandbox') issues.push('CREDIGRUPO_ENV_INVALID');
  if (!webhookSecret) issues.push('CREDIGRUPO_WEBHOOK_SECRET_MISSING');
  else if (webhookSecret.length < 32) issues.push('CREDIGRUPO_WEBHOOK_SECRET_TOO_SHORT');

  return {
    requestedEnabled,
    configured: issues.length === 0,
    issues,
    apiKey,
    webhookSecret,
  };
};

export const getCredigrupoPublicStatus = () => {
  const configuration = evaluateCredigrupoConfiguration();

  return {
    enabled: configuration.requestedEnabled && configuration.configured,
    configured: configuration.configured,
    environment: 'sandbox' as const,
    provider: 'CREDIGRUPO' as const,
    configurationIssues: configuration.issues,
    message: !configuration.requestedEnabled
      ? 'Integracao desativada por configuracao.'
      : !configuration.configured
        ? 'Integracao Credigrupo configurada parcialmente.'
        : undefined,
  };
};

export const getCredigrupoServerConfig = (options?: { allowWhenDisabled?: boolean }): CredigrupoServerConfig => {
  const configuration = evaluateCredigrupoConfiguration();
  if (!configuration.requestedEnabled && !options?.allowWhenDisabled) throw new Error('CREDIGRUPO_DISABLED');
  if (configuration.issues.includes('CREDIGRUPO_ENV_INVALID')) throw new Error('CREDIGRUPO_PRODUCTION_BLOCKED');
  if (configuration.issues.includes('CREDIGRUPO_LIVE_KEY_BLOCKED')) throw new Error('CREDIGRUPO_LIVE_KEY_BLOCKED');
  if (configuration.issues.includes('CREDIGRUPO_API_KEY_MISSING')) throw new Error('CREDIGRUPO_API_KEY_MISSING');
  if (configuration.issues.includes('CREDIGRUPO_SANDBOX_KEY_REQUIRED')) throw new Error('CREDIGRUPO_SANDBOX_KEY_REQUIRED');
  if (configuration.issues.includes('CREDIGRUPO_WEBHOOK_SECRET_MISSING')) throw new Error('CREDIGRUPO_WEBHOOK_SECRET_MISSING');
  if (configuration.issues.includes('CREDIGRUPO_WEBHOOK_SECRET_TOO_SHORT')) throw new Error('CREDIGRUPO_WEBHOOK_SECRET_TOO_SHORT');

  return {
    apiKey: configuration.apiKey,
    webhookSecret: configuration.webhookSecret,
    environment: 'sandbox',
    baseUrl: CREDIGRUPO_BASE_URL,
  };
};
