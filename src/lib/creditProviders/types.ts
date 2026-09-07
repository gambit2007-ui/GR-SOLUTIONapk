import type { CredigrupoLoanStatus, FundingSourceType } from '../../types';
export type { CredigrupoLoanStatus, FundingSourceType } from '../../types';
export type CredigrupoAccountMode = 'OWN_INVESTOR_KEY';

export type CredigrupoKycStatus =
  | 'pending_kyc'
  | 'pending_approval'
  | 'approved'
  | 'rejected'
  | 'blocked'
  | string;

export interface CredigrupoIntegrationStatus {
  enabled: boolean;
  configured: boolean;
  environment: 'sandbox';
  accountMode: CredigrupoAccountMode;
  investor: 'GR SOLUTION';
  provider: 'CREDIGRUPO';
  message?: string;
  hasExistingOperations?: boolean;
  isAdmin?: boolean;
  configurationIssues?: Array<
    | 'CREDIGRUPO_API_KEY_MISSING'
    | 'CREDIGRUPO_SANDBOX_KEY_REQUIRED'
    | 'CREDIGRUPO_LIVE_KEY_BLOCKED'
    | 'CREDIGRUPO_ENV_INVALID'
    | 'CREDIGRUPO_ACCOUNT_MODE_INVALID'
    | 'CREDIGRUPO_WEBHOOK_SECRET_MISSING'
  >;
}

export interface CredigrupoRuntimeDiagnostics {
  apiKeyPresent: boolean;
  apiKeyIsSandbox: boolean;
  envPresent: boolean;
  envIsSandbox: boolean;
  enabledPresent: boolean;
  integrationEnabled: boolean;
  webhookSecretPresent: boolean;
  webhookSecretLength: number;
  webhookSecretFingerprint: string | null;
  webhookConfigurationAvailable: boolean;
  webhookUrl: string | null;
  webhookUrlMatchesExpected: boolean;
  webhookSecretConfigured: boolean | null;
  webhookConfigurationError: string | null;
  accountMode: CredigrupoAccountMode | null;
  investor: 'GR SOLUTION';
}

export interface CredigrupoHomologationAuditCustomer {
  customer: {
    id: string;
    name?: string;
    exists: boolean;
    environment?: string;
    testData?: boolean;
    archived?: boolean;
  };
  borrowerLinks: Array<{ id: string; borrowerId?: string }>;
  simulations: Array<{ id: string; externalId?: string; usedByOperationId?: string }>;
  operations: Array<{ id: string; proposalId?: string }>;
  linkedCounts: {
    contracts: number;
    cashMovements: number;
    ledgerEntries: number;
    realContracts: number;
    realCashMovements: number;
    realLedgerEntries: number;
  };
}

export interface CredigrupoHomologationAudit {
  scope: { environment: 'sandbox'; testData: true; readOnly: true };
  customers: CredigrupoHomologationAuditCustomer[];
  robsonLeandro: {
    localCustomerIds: string[];
    hasSeparateLocalCustomer: boolean;
    result: 'SEPARATE_LOCAL_CUSTOMER' | 'NO_LOCAL_CUSTOMER_WITH_NAME';
  };
  totals: {
    customerIds: number;
    borrowerIds: number;
    simulations: number;
    operations: number;
    proposals: number;
    contractsLinked: number;
    cashMovementsLinked: number;
    ledgerEntriesLinked: number;
    realContractsAffected: number;
    realCashMovementsAffected: number;
    realLedgerEntriesAffected: number;
  };
}

export interface CredigrupoInstallmentPixResult {
  brCode: string;
  qrCodeImage: string;
  correlationID: string;
  amountCents: number;
  totalCents: number;
  serviceFee: number;
}

export interface CredigrupoInvestorSummary {
  id: string;
  externalId: string;
  name: string;
  emailMasked?: string;
  documentMasked?: string;
  kycStatus: CredigrupoKycStatus;
  externalStatus: string;
  provider: 'CREDIGRUPO';
  capitalOrigin: FundingSourceType;
  active: boolean;
  documentsSubmitted?: CredigrupoInvestorDocumentType[];
  documentsComplete?: boolean;
  documentsSubmittedAt?: string;
  createdAt?: string;
  syncedAt?: string;
}

export type CredigrupoInvestorDocumentType =
  | 'selfie'
  | 'idFront'
  | 'idBack'
  | 'proofOfResidence';

export interface CredigrupoInvestorDocumentReference {
  type: CredigrupoInvestorDocumentType;
  storagePath: string;
}

export interface UploadCredigrupoInvestorDocumentsRequest {
  investorId: string;
  documents: CredigrupoInvestorDocumentReference[];
}

export interface CredigrupoInvestorStatistics {
  operationsFinanced: number;
  capitalAllocated: number;
  activeContracts: number;
  completedContracts: number;
  amountRepaid: number;
}

export interface CredigrupoInvestorDetails extends CredigrupoInvestorSummary {
  statistics: CredigrupoInvestorStatistics;
}

export interface CredigrupoGrInvestorSettings {
  configured: boolean;
  investorInternalId?: string;
  investorIdMasked?: string;
  investorName?: string;
  kycStatus?: CredigrupoKycStatus;
  syncedAt?: string;
  updatedAt?: string;
}

export interface UpdateCredigrupoGrInvestorRequest {
  investorInternalId: string;
}

export interface CredigrupoInvestorKycData {
  address_street: string;
  address_number: string;
  address_neighborhood: string;
  address_city: string;
  address_state: string;
  address_zip: string;
  maritalStatus: 'SINGLE' | 'MARRIED' | 'DIVORCED' | 'WIDOWED';
  monthlyIncome: number;
  bankCode: string;
  bankAgency: string;
  bankAccount: string;
  pixKey: string;
  pixKeyType: 'CPF' | 'CNPJ' | 'EMAIL' | 'PHONE' | 'RANDOM';
}

export interface CreateCredigrupoInvestorRequest {
  email: string;
  display_name: string;
  phone: string;
  document: string;
  birth_date: string;
  kyc_data: CredigrupoInvestorKycData;
}

export interface CreateCredigrupoInvestorResult {
  investor: CredigrupoInvestorSummary;
  message?: string;
}

export type CredigrupoInvestorAction = 'SYNC' | 'ACTIVATE' | 'DEACTIVATE';

export interface UpdateCredigrupoInvestorRequest {
  id: string;
  action: CredigrupoInvestorAction;
}

export interface CredigrupoKycData {
  address_street: string;
  address_number: string;
  address_neighborhood: string;
  address_city: string;
  address_state: string;
  address_zip: string;
  maritalStatus: 'SINGLE' | 'MARRIED' | 'DIVORCED' | 'WIDOWED';
  monthlyIncome: number;
  documentType: 'RG' | 'CNH' | 'RNE';
  documentNumber: string;
  issueDate: string;
  issuingEntity?: string;
  issuingState?: string;
  bankCode: string;
  bankAgency: string;
  bankAccount: string;
  bankAccountType?: 'CHECKING' | 'SAVINGS';
  pixKey: string;
  pixKeyType: 'CPF' | 'CNPJ' | 'EMAIL' | 'PHONE' | 'RANDOM';
  spouseName?: string;
  spouseDocument?: string;
  spouseBirthDate?: string;
}

export interface EnsureCredigrupoBorrowerRequest {
  customerId: string;
  fundingSource: 'GR';
  email: string;
  displayName: string;
  phone: string;
  document: string;
  birthDate: string;
  kycData: CredigrupoKycData;
}

export interface CredigrupoBorrowerState {
  borrowerId: string;
  kycStatus: CredigrupoKycStatus;
  ccbEligible: boolean | null;
  eligibilityErrors: string[];
  eligibilityCachedAt: string | null;
}

export interface CredigrupoSimulationRequest {
  customerId: string;
  fundingSource: 'GR';
  amountCents: number;
  installments: number;
  interestRate: number;
  firstPaymentDate: string;
  frequency: 'monthly' | 'weekly';
  interestType: 'simple' | 'compound';
}

export interface CredigrupoSimulationInstallment {
  installmentNumber: number;
  amount: number;
  dueDate: string;
  interest: number;
  principal: number;
  outstandingBalance: number;
}

export interface CredigrupoSimulationValues {
  netAmount: number;
  grossAmount: number;
  totalAmount: number;
  totalInterest: number;
  totalIof: number;
  totalFee: number;
  installments: CredigrupoSimulationInstallment[];
}

export interface CredigrupoSimulationResult {
  simulationId: string;
  externalId: string;
  interestRate: number;
  simulation: CredigrupoSimulationValues;
}

export interface CreateBancarizedLoanRequest {
  operationId: string;
  simulationId: string;
  fundingSource: 'GR';
}

export interface CreateBancarizedLoanResult {
  operationId: string;
  proposalId: string;
  requestId?: string;
  status: string;
  internalStatus: string;
  formalizationStatus?: string;
  unknownProviderStatus: boolean;
  duplicate: boolean;
  pix?: {
    brcode?: string;
    qrCodeImage?: string;
    expiresAt?: string;
    amountCents?: number;
    correlationId?: string;
  };
}

export interface CredigrupoOperationSummary {
  id: string;
  customerId: string;
  customerName: string;
  investorId?: string;
  investorName: string;
  fundingSource: FundingSourceType;
  proposalId?: string;
  localLoanId?: string;
  status: string;
  externalStatus?: string;
  formalizationStatus?: string;
  unknownProviderStatus?: boolean;
  amountCents: number;
  installments: number;
  createdAt?: string;
  pix?: CreateBancarizedLoanResult['pix'];
  testPayStatus?: 'REQUESTING' | 'SUCCEEDED' | 'FAILED';
  borrowerSignUrl?: string;
  investorSignUrl?: string;
  investorSignaturePreSigned?: boolean;
  ccbUrl?: string;
}

export interface CredigrupoInstallmentActionRequest {
  contractId: string;
  installmentId: string;
}

export type CredigrupoTestPayRequest =
  | { operationId: string; contractId?: never; installmentId?: never }
  | { operationId?: never; contractId: string; installmentId: string };
