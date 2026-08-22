import type { FundingSourceType } from '../../types';
export type { FundingSourceType } from '../../types';

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
  provider: 'CREDIGRUPO';
  message?: string;
  hasExistingOperations?: boolean;
}

export interface CredigrupoInvestorSummary {
  id: string;
  name: string;
  email?: string;
  kycStatus: CredigrupoKycStatus;
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
  investorId: string;
  email: string;
  displayName: string;
  phone: string;
  document: string;
  birthDate: string;
  kycData: CredigrupoKycData;
}

export interface CredigrupoBorrowerState {
  borrowerId: string;
  investorId: string;
  kycStatus: CredigrupoKycStatus;
  ccbEligible?: boolean;
  eligibilityErrors?: string[];
}

export interface CredigrupoSimulationRequest {
  customerId: string;
  investorId: string;
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
  fundingSource: FundingSourceType;
}

export interface CreateBancarizedLoanResult {
  operationId: string;
  proposalId: string;
  requestId: string;
  status: string;
  duplicate: boolean;
  pix: {
    brcode: string;
    qrCodeImage: string;
    expiresAt: string;
    amountCents: number;
    correlationId: string;
  };
}

export interface CredigrupoOperationSummary {
  id: string;
  customerId: string;
  customerName: string;
  investorId: string;
  investorName: string;
  fundingSource: FundingSourceType;
  proposalId?: string;
  localLoanId?: string;
  status: string;
  externalStatus?: string;
  amountCents: number;
  installments: number;
  createdAt?: string;
  pix?: CreateBancarizedLoanResult['pix'];
  borrowerSignUrl?: string;
  investorSignUrl?: string;
  ccbUrl?: string;
}
