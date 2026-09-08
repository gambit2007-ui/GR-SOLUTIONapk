import {
  isCredigrupoCustomerAllowed,
  type CreditDataEnvironment,
  type CreditDataScope,
} from '../../../../src/lib/creditProviders/dataScope.js';
import { ApiError } from '../../http.js';

export const requireCredigrupoCustomerForEnvironment = (
  data: CreditDataScope,
  environment: CreditDataEnvironment,
) => {
  if (!isCredigrupoCustomerAllowed(data, environment)) {
    throw new ApiError(
      409,
      environment === 'sandbox' ? 'SANDBOX_TEST_CUSTOMER_REQUIRED' : 'PRODUCTION_CUSTOMER_SCOPE_INVALID',
      environment === 'sandbox'
        ? 'Ambiente Credigrupo Sandbox. Utilize somente cliente de teste identificado e ativo.'
        : 'Cliente de teste, arquivado ou com ambiente conflitante nao pode operar em producao.',
    );
  }
};

export const requireCredigrupoRecordForEnvironment = (
  data: CreditDataScope,
  environment: CreditDataEnvironment,
) => {
  if (data.environment !== environment || data.testData !== (environment === 'sandbox') || data.archived || data.archivedAt) {
    throw new ApiError(
      409,
      'CREDIGRUPO_RECORD_ENVIRONMENT_UNCONFIRMED',
      'Registro da integracao nao pertence ao ambiente atual.',
    );
  }
};

export const assertSandboxTestPay = (environment: string, apiKey: string) => {
  if (environment !== 'sandbox' || !apiKey.startsWith('wl_test_')) {
    throw new ApiError(403, 'TEST_PAY_SANDBOX_ONLY', 'Test-pay permitido somente no sandbox.');
  }
};
