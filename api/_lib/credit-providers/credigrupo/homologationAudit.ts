export interface HomologationAuditDocument {
  id: string;
  data: Record<string, unknown>;
}

export interface HomologationAuditCustomerSummary {
  customer: {
    id: string;
    name?: string;
    exists: boolean;
    environment?: string;
    testData?: boolean;
    archived?: boolean;
  };
  borrowerLinks: Array<{
    id: string;
    borrowerId?: string;
    environment?: string;
    testData?: boolean;
    archived?: boolean;
  }>;
  simulations: Array<{
    id: string;
    externalId?: string;
    usedByOperationId?: string;
    environment?: string;
    testData?: boolean;
    archived?: boolean;
  }>;
  operations: Array<{
    id: string;
    proposalId?: string;
    status?: string;
    externalStatus?: string;
    formalizationStatus?: string;
    environment?: string;
    testData?: boolean;
    archived?: boolean;
  }>;
  linkedCounts: {
    contracts: number;
    cashMovements: number;
    ledgerEntries: number;
    realContracts: number;
    realCashMovements: number;
    realLedgerEntries: number;
  };
}

const asText = (value: unknown) => String(value || '').trim();

const asName = (value: unknown) => {
  const name = asText(value).replace(/\s+/g, ' ');
  return name && name.length <= 120 ? name : undefined;
};

const asAuditScope = (data: Record<string, unknown>) => ({
  environment: asText(data.environment) || undefined,
  testData: data.testData === true,
  archived: data.archived === true || Boolean(data.archivedAt),
});

const isExplicitSandboxTestData = (data: Record<string, unknown>) => (
  data.environment === 'sandbox' && data.testData === true
);

const countRealEffects = (documents: HomologationAuditDocument[]) => (
  documents.filter(({ data }) => !isExplicitSandboxTestData(data)).length
);

export const buildHomologationAuditSummary = (input: {
  customerId: string;
  customer: Record<string, unknown> | undefined;
  borrowers: HomologationAuditDocument[];
  simulations: HomologationAuditDocument[];
  operations: HomologationAuditDocument[];
  loans: HomologationAuditDocument[];
  cashMovements: HomologationAuditDocument[];
  ledgerEntries: HomologationAuditDocument[];
}): HomologationAuditCustomerSummary => ({
  customer: {
    id: input.customerId,
    exists: Boolean(input.customer),
    ...(input.customer && asName(input.customer.name) ? { name: asName(input.customer.name) } : {}),
    ...(input.customer ? asAuditScope(input.customer) : {}),
  },
  borrowerLinks: input.borrowers.map(({ id, data }) => ({
    id,
    borrowerId: asText(data.borrowerId) || undefined,
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
  linkedCounts: {
    contracts: input.loans.length,
    cashMovements: input.cashMovements.length,
    ledgerEntries: input.ledgerEntries.length,
    realContracts: countRealEffects(input.loans),
    realCashMovements: countRealEffects(input.cashMovements),
    realLedgerEntries: countRealEffects(input.ledgerEntries),
  },
});

export const buildSandboxHomologationAuditSummary = (
  customers: HomologationAuditCustomerSummary[],
) => {
  const unique = (values: Array<string | undefined>) => [...new Set(values.filter((value): value is string => Boolean(value)))];
  const borrowerIds = unique(customers.flatMap((customer) => customer.borrowerLinks.map((borrower) => borrower.borrowerId)));
  const simulationIds = customers.flatMap((customer) => customer.simulations.map((simulation) => simulation.id));
  const operationIds = customers.flatMap((customer) => customer.operations.map((operation) => operation.id));
  const proposalIds = unique(customers.flatMap((customer) => customer.operations.map((operation) => operation.proposalId)));
  const robsonLocalCustomerIds = customers
    .filter((customer) => customer.customer.name?.trim().toLocaleUpperCase('pt-BR') === 'ROBSON LEANDRO')
    .map((customer) => customer.customer.id);

  return {
    scope: { environment: 'sandbox' as const, testData: true, readOnly: true },
    customers,
    robsonLeandro: {
      localCustomerIds: robsonLocalCustomerIds,
      hasSeparateLocalCustomer: robsonLocalCustomerIds.length > 0,
      result: robsonLocalCustomerIds.length > 0 ? 'SEPARATE_LOCAL_CUSTOMER' : 'NO_LOCAL_CUSTOMER_WITH_NAME',
    },
    totals: {
      customerIds: customers.length,
      borrowerIds: borrowerIds.length,
      simulations: simulationIds.length,
      operations: operationIds.length,
      proposals: proposalIds.length,
      contractsLinked: customers.reduce((total, customer) => total + customer.linkedCounts.contracts, 0),
      cashMovementsLinked: customers.reduce((total, customer) => total + customer.linkedCounts.cashMovements, 0),
      ledgerEntriesLinked: customers.reduce((total, customer) => total + customer.linkedCounts.ledgerEntries, 0),
      realContractsAffected: customers.reduce((total, customer) => total + customer.linkedCounts.realContracts, 0),
      realCashMovementsAffected: customers.reduce((total, customer) => total + customer.linkedCounts.realCashMovements, 0),
      realLedgerEntriesAffected: customers.reduce((total, customer) => total + customer.linkedCounts.realLedgerEntries, 0),
    },
  };
};
