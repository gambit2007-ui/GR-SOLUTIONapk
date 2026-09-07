export type CreditDataEnvironment = 'sandbox' | 'production';

export interface CreditDataScope {
  environment?: CreditDataEnvironment;
  testData?: boolean;
  archived?: boolean;
  archivedAt?: unknown;
}

export const isSandboxTestCustomer = (data: CreditDataScope) =>
  data.environment === 'sandbox' && data.testData === true && !data.archived && !data.archivedAt;

// Missing provenance is never evidence of a real financial operation.
export const permitsRealFinancialEffects = (data: CreditDataScope, runtimeEnvironment: string | undefined) =>
  runtimeEnvironment === 'production' && data.environment === 'production'
  && data.testData !== true && !data.archived && !data.archivedAt;
