const CREDIGRUPO_BASE_URL = 'https://emprestapro-api-9i5ez.ondigitalocean.app/api/v1/whitelabel';
export const CREDIGRUPO_ACCOUNT_MODE = 'OWN_INVESTOR_KEY' as const;
export const CREDIGRUPO_OWN_INVESTOR_NAME = 'GR SOLUTION' as const;
export type CredigrupoAccountMode = typeof CREDIGRUPO_ACCOUNT_MODE;
export type CredigrupoEnvironment = 'sandbox' | 'production';

export type CredigrupoConfigurationIssue =
  | 'CREDIGRUPO_API_KEY_MISSING'
  | 'CREDIGRUPO_SANDBOX_KEY_REQUIRED'
  | 'CREDIGRUPO_LIVE_KEY_REQUIRED'
  | 'CREDIGRUPO_ENV_INVALID'
  | 'CREDIGRUPO_ACCOUNT_MODE_INVALID'
  | 'CREDIGRUPO_WEBHOOK_SECRET_MISSING';

export interface CredigrupoServerConfig {
  apiKey: string;
  webhookSecret: string;
  environment: CredigrupoEnvironment;
  accountMode: CredigrupoAccountMode;
  baseUrl: string;
}

export const evaluateCredigrupoConfiguration = (source: NodeJS.ProcessEnv = process.env) => {
  const requestedEnabled = String(source.CREDIGRUPO_ENABLED || '').trim().toLowerCase() === 'true';
  const apiKey = String(source.CREDIGRUPO_API_KEY || '').trim();
  const environment = String(source.CREDIGRUPO_ENV || '').trim().toLowerCase();
  const accountMode = String(source.CREDIGRUPO_ACCOUNT_MODE || '').trim().toUpperCase();
  const webhookSecret = String(source.CREDIGRUPO_WEBHOOK_SECRET || '');
  const issues: CredigrupoConfigurationIssue[] = [];

  const isSandbox = environment === 'sandbox';
  const isProduction = environment === 'production';

  if (!apiKey) issues.push('CREDIGRUPO_API_KEY_MISSING');
  else if (isSandbox && !apiKey.startsWith('wl_test_')) issues.push('CREDIGRUPO_SANDBOX_KEY_REQUIRED');
  else if (isProduction && !apiKey.startsWith('wl_live_')) issues.push('CREDIGRUPO_LIVE_KEY_REQUIRED');
  if (!isSandbox && !isProduction) issues.push('CREDIGRUPO_ENV_INVALID');
  if (accountMode !== CREDIGRUPO_ACCOUNT_MODE) issues.push('CREDIGRUPO_ACCOUNT_MODE_INVALID');
  if (!webhookSecret) issues.push('CREDIGRUPO_WEBHOOK_SECRET_MISSING');

  return {
    requestedEnabled,
    configured: issues.length === 0,
    issues,
    apiKey,
    environment: environment as CredigrupoEnvironment | '',
    accountMode,
    webhookSecret,
  };
};

export const getCredigrupoPublicStatus = () => {
  const configuration = evaluateCredigrupoConfiguration();

  return {
    enabled: configuration.requestedEnabled && configuration.configured,
    configured: configuration.configured,
    environment: configuration.environment === 'production' ? 'production' : 'sandbox',
    accountMode: CREDIGRUPO_ACCOUNT_MODE,
    investor: CREDIGRUPO_OWN_INVESTOR_NAME,
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
  if (configuration.issues.includes('CREDIGRUPO_ENV_INVALID')) throw new Error('CREDIGRUPO_ENV_INVALID');
  if (configuration.issues.includes('CREDIGRUPO_ACCOUNT_MODE_INVALID')) throw new Error('CREDIGRUPO_ACCOUNT_MODE_INVALID');
  if (configuration.issues.includes('CREDIGRUPO_API_KEY_MISSING')) throw new Error('CREDIGRUPO_API_KEY_MISSING');
  if (configuration.issues.includes('CREDIGRUPO_SANDBOX_KEY_REQUIRED')) throw new Error('CREDIGRUPO_SANDBOX_KEY_REQUIRED');
  if (configuration.issues.includes('CREDIGRUPO_LIVE_KEY_REQUIRED')) throw new Error('CREDIGRUPO_LIVE_KEY_REQUIRED');
  if (configuration.issues.includes('CREDIGRUPO_WEBHOOK_SECRET_MISSING')) throw new Error('CREDIGRUPO_WEBHOOK_SECRET_MISSING');

  return {
    apiKey: configuration.apiKey,
    webhookSecret: configuration.webhookSecret,
    environment: configuration.environment as CredigrupoEnvironment,
    accountMode: CREDIGRUPO_ACCOUNT_MODE,
    baseUrl: CREDIGRUPO_BASE_URL,
  };
};

export const isCredigrupoOwnInvestorKeyMode = () => (
  String(process.env.CREDIGRUPO_ACCOUNT_MODE || '').trim().toUpperCase() === CREDIGRUPO_ACCOUNT_MODE
);
