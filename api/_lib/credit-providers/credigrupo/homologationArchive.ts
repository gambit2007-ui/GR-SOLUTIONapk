import type { HomologationAuditCustomerSummary } from './homologationAudit.js';

export type HomologationArchiveBlocker =
  | 'CUSTOMER_NOT_FOUND'
  | 'NO_CREDIGRUPO_RECORDS'
  | 'FINANCIAL_EFFECT_FOUND'
  | 'UNCONFIRMED_SANDBOX_RECORD';

const isSandboxTestRecord = (record: { environment?: string; testData?: boolean }) => (
  record.environment === 'sandbox' && record.testData === true
);

// A legacy customer can lack its own scope marker, but every Credigrupo record must be explicit sandbox data.
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
  if (!providerRecords.length || !providerRecords.every(isSandboxTestRecord)) {
    return 'UNCONFIRMED_SANDBOX_RECORD';
  }
  return null;
};
