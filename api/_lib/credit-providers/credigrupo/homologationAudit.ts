export interface HomologationAuditDocument {
  id: string;
  data: Record<string, unknown>;
}

const asText = (value: unknown) => String(value || '').trim();

const maskIdentifier = (value: unknown) => {
  const identifier = asText(value);
  return identifier ? `***${identifier.slice(-6)}` : undefined;
};

const asAuditScope = (data: Record<string, unknown>) => ({
  environment: asText(data.environment) || undefined,
  testData: data.testData === true,
  archived: data.archived === true || Boolean(data.archivedAt),
});

export const buildHomologationAuditSummary = (input: {
  customerId: string;
  customer: Record<string, unknown> | undefined;
  borrowers: HomologationAuditDocument[];
  simulations: HomologationAuditDocument[];
  operations: HomologationAuditDocument[];
  loans: HomologationAuditDocument[];
  cashMovements: HomologationAuditDocument[];
  ledgerEntries: HomologationAuditDocument[];
}) => ({
  customer: {
    id: input.customerId,
    exists: Boolean(input.customer),
    ...(input.customer ? asAuditScope(input.customer) : {}),
  },
  borrowerLinks: input.borrowers.map(({ id, data }) => ({
    id,
    borrowerId: maskIdentifier(data.borrowerId),
    kycStatus: asText(data.kycStatus) || undefined,
    ccbEligible: typeof data.ccbEligible === 'boolean' ? data.ccbEligible : undefined,
    ...asAuditScope(data),
  })),
  simulations: input.simulations.map(({ id, data }) => ({
    id,
    externalId: asText((data.response as Record<string, unknown> | undefined)?.externalId) || undefined,
    usedByOperationId: asText(data.usedByOperationId) || undefined,
    ...asAuditScope(data),
  })),
  operations: input.operations.map(({ id, data }) => ({
    id,
    proposalId: asText(data.proposalId) || undefined,
    status: asText(data.status) || undefined,
    externalStatus: asText(data.externalStatus) || undefined,
    formalizationStatus: asText(data.formalizationStatus) || undefined,
    ...asAuditScope(data),
  })),
  loans: input.loans.map(({ id, data }) => ({
    id,
    status: asText(data.status) || undefined,
    formalizationType: asText(data.formalizationType) || undefined,
    provider: asText(data.provider) || undefined,
  })),
  cashMovements: input.cashMovements.map(({ id, data }) => ({
    id,
    type: asText(data.type) || undefined,
    amount: Number.isFinite(Number(data.amount)) ? Number(data.amount) : undefined,
    loanId: asText(data.loanId) || undefined,
    operationId: asText(data.operationId) || undefined,
  })),
  ledgerEntries: input.ledgerEntries.map(({ id }) => ({ id })),
});
