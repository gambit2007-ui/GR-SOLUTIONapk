import { isSandboxTestCustomer, type CreditDataScope } from '../../../../src/lib/creditProviders/dataScope.js';
import { ApiError } from '../../http.js';

export const requireSandboxTestCustomer = (data: CreditDataScope) => {
  if (!isSandboxTestCustomer(data)) {
    throw new ApiError(409, 'SANDBOX_TEST_CUSTOMER_REQUIRED',
      'Ambiente Credigrupo Sandbox. Utilize somente cliente de teste identificado e ativo.');
  }
};

export const assertSandboxTestPay = (environment: string, apiKey: string) => {
  if (environment !== 'sandbox' || !apiKey.startsWith('wl_test_')) {
    throw new ApiError(403, 'TEST_PAY_SANDBOX_ONLY', 'Test-pay permitido somente no sandbox.');
  }
};
