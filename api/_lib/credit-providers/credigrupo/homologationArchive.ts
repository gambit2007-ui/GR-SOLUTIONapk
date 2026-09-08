import type { HomologationAuditCustomerSummary } from './homologationAudit.js';

export type HomologationArchiveBlocker =
  | 'CUSTOMER_NOT_FOUND'
  | 'NO_CREDIGRUPO_RECORDS'
  | 'FINANCIAL_EFFECT_FOUND'
  | 'UNCONFIRMED_SANDBOX_RECORD';

const hasUnsafeScope = (record: { environment?: string; testData?: boolean }) => (
  record.environment === 'production'
  || (record.environment === 'sandbox' && record.testData !== true)
  || (record.environment !== undefined && record.environment !== '' && record.environment !== 'sandbox')
  || (record.testData === true && record.environment !== 'sandbox')
);

// The selected operation proves this is a sandbox cleanup; legacy linked records may lack old scope fields.
export const getHomologationArchiveBlocker = (
  audit: HomologationAuditCustomerSummary,
): HomologationArchiveBlocker | null => {
  if (!audit.customer.exists) return 'CUSTOMER_NOT_FOUND';
  if (audit.operations.length === 0) return 'NO_CREDIGRUPO_RECORDS';
  if (
    audit.linkedCounts.contracts > 0
    || audit.linkedCounts.cashMovements > 0
    || audit.linkedCounts.ledgerEntries > 0
  ) return 'FINANCIAL_EFFECT_FOUND';

  const providerRecords = [...audit.borrowerLinks, ...audit.simulations, ...audit.operations];
  if (!providerRecords.length || providerRecords.some(hasUnsafeScope)) {
    return 'UNCONFIRMED_SANDBOX_RECORD';
  }
  return null;
};
