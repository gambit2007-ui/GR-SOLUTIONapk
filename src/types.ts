export type Frequency =
  | 'DIARIO'
  | 'SEMANAL'
  | 'QUINZENAL'
  | 'MENSAL'
  | 'DAILY'
  | 'WEEKLY'
  | 'BIWEEKLY'
  | 'MONTHLY';

export type InterestType = 'SIMPLES' | 'PRICE' | 'SIMPLE' | 'SPLIT';
export type LoanType = 'SIMPLE' | 'PRICE';

export type InstallmentStatus = 'PENDENTE' | 'PAGO' | 'ATRASADO' | 'PENDING' | 'PAID' | 'OVERDUE';
export type PaymentStatus = InstallmentStatus;

export type LoanStatus =
  | 'ATIVO'
  | 'QUITADO'
  | 'ATRASADO'
  | 'CANCELADO'
  | 'ACTIVE'
  | 'COMPLETED'
  | 'CANCELLED';

export type CashMovementType = 'APORTE' | 'RETIRADA' | 'PAGAMENTO' | 'ESTORNO' | 'ENTRADA' | 'SAIDA';
export type MovementType = CashMovementType;
export type CashOutflowCategory =
  | 'DEVOLUCAO_APORTE'
  | 'PAGAMENTO_EMPRESTIMO_EXTERNO'
  | 'REPASSE_INVESTIDOR_PARCEIRO'
  | 'PRO_LABORE'
  | 'DESPESA_OPERACIONAL'
  | 'IMPOSTO_MEI'
  | 'MARKETING'
  | 'COMISSAO'
  | 'REINVESTIMENTO';

export interface FirestoreTimestampLike {
  toDate: () => Date;
}

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  createdAt: number;
}

export interface CashMovement {
  id?: string;
  type: CashMovementType;
  amount: number;
  description: string;
  date: string;
  category?: CashOutflowCategory;
  loanId?: string;
  createdByUid?: string;
  createdByEmail?: string;
  createdByName?: string;
  operationId?: string;
  discountApplied?: number;
  recordedAt?: FirestoreTimestampLike | Date | number | string;
  value?: number;
}

export interface FeeSettings {
  dailyLateFeeRate: number;
}

export interface MonthlySnapshot {
  id?: string;
  month: string;
  openingCash: number;
  closingCash: number;
  totalIncome: number;
  totalExpense: number;
  principalReceived: number;
  interestReceived: number;
  lateFeesReceived: number;
  serviceFeesReceived: number;
  realProfit: number;
  lentAmount: number;
  roi: number;
  movementCount: number;
  createdLoansCount: number;
  totalReceived?: number;
  projectedReceipts?: number;
  projectedProfit?: number;
  manualWithdrawals?: number;
  loanOutflows?: number;
  reversals?: number;
  overdueAmount?: number;
  outflowCategoryTotals?: Partial<Record<CashOutflowCategory, number>>;
  schemaVersion?: number;
  status?: 'CLOSED';
  closedAt?: FirestoreTimestampLike | Date | number | string;
  createdAt?: FirestoreTimestampLike | Date | number | string;
  updatedAt?: FirestoreTimestampLike | Date | number | string;
  closedByUid?: string;
}

export interface CustomerDocument {
  id?: string;
  name: string;
  type: string;
  data?: string;
  url?: string;
  uploadedAt?: string;
}

export interface Customer {
  id: string;
  name: string;
  cpf?: string;
  rg?: string;
  email?: string;
  phone?: string;
  address?: string;
  notes?: string;
  observations?: string;
  avatar?: string;
  photoUrl?: string;
  birthDate?: string;
  documents?: CustomerDocument[];
  createdAt?: number;
  archived?: boolean;
  archivedAt?: FirestoreTimestampLike | Date | number | string;
  archivedByUid?: string;
  archivedByEmail?: string;
  archivedByName?: string;
}

export interface Installment {
  id?: string;
  number: number;
  value?: number;
  amount?: number;
  dueDate: string;
  status: PaymentStatus;
  paymentDate?: string;
  paidAt?: string;
  lastPaymentDate?: string;
  partialPaid?: number;
  paidAmount?: number;
  paymentAmount?: number;
  lastPaidValue?: number;
  originalValue?: number;
  carriedLateFee?: number;
  expectedPrincipal?: number;
  expectedInterest?: number;
  paymentBreakdown?: PaymentBreakdown;
  paymentEntries?: InstallmentPaymentEntry[];
  breakdownSource?: BreakdownSource | string;
  needsFiscalReview?: boolean;
}

export interface PaymentBreakdown {
  principalPaid: number;
  interestPaid: number;
  lateFeePaid: number;
  serviceFeePaid: number;
  discountApplied: number;
  totalPaid: number;
}

export interface InstallmentPaymentEntry {
  id: string;
  recordedAt: string;
  kind?: 'PAYMENT' | 'REVERSAL';
  principalPaid: number;
  interestPaid: number;
  lateFeePaid: number;
  serviceFeePaid: number;
  discountApplied: number;
  totalPaid: number;
  operationId?: string;
  installmentNumber?: number;
}

export type BreakdownSource =
  | 'migrated_simple_ratio'
  | 'migrated_price_schedule'
  | 'estimated_price_fallback';

export interface InterestOnlyRenewalRecord {
  id: string;
  type: 'interest_only_renewal';
  amount: number;
  interestPaid?: number;
  lateFeePaid?: number;
  lateFeeCarried?: number;
  totalPaid?: number;
  paymentDate: string;
  previousDueDate?: string;
  newDueDate?: string;
  notes?: string;
  principalUnchanged?: number;
  performedByUid?: string;
  performedByEmail?: string;
  performedByName?: string;
}

export interface Loan {
  id: string;
  contractNumber?: string;
  customerId: string;
  customerName: string;
  customerPhone?: string;
  amount: number;
  interestRate: number;
  installmentCount?: number;
  installmentsCount?: number;
  frequency: Frequency;
  interestType: InterestType;
  monthlyPaidInterestRate?: number;
  monthlyAccruedInterestRate?: number;
  totalToReturn?: number;
  installmentValue?: number;
  startDate: string;
  dueDate?: string;
  createdAt?: FirestoreTimestampLike | Date | number | string;
  notes?: string;
  installments: Installment[];
  status: LoanStatus;
  paidAmount?: number;
  renewCount?: number;
  lastRenewAt?: string;
  allowInterestOnlyRenewal?: boolean;
  renewalHistory?: InterestOnlyRenewalRecord[];
  fiscalPaymentEntries?: InstallmentPaymentEntry[];
  version?: number;
  updatedAt?: FirestoreTimestampLike | Date | number | string;
  canceledAt?: FirestoreTimestampLike | Date | number | string;
  canceledByUid?: string;
  canceledByEmail?: string;
  canceledByName?: string;
  cancellationReason?: string;
  lastOperationId?: string;
  lastOperationType?: 'LOAN_CREATED' | 'CONTRACT_EDIT' | 'PAYMENT' | 'PAYMENT_REVERSAL' | 'INTEREST_RENEWAL' | 'CANCELLATION';
  lastOperationAt?: FirestoreTimestampLike | Date | number | string;
  lastOperationByUid?: string;
  lastOperationByEmail?: string;
  lastOperationByName?: string;
  hasFinancialHistory?: boolean;
}

export type PaymentApplyMode =
  | 'INSTALLMENTS'
  | 'TOTAL_BALANCE'
  | 'REDISTRIBUTE_BALANCE'
  | 'EARLY_SETTLEMENT';

export interface LoanPaymentRequest {
  operationId: string;
  amount?: number;
  installmentIndex: number;
  applyMode: PaymentApplyMode;
  processedAt: string;
  redistributionStartDate?: string;
  redistributionInstallmentsCount?: number;
}

export interface LoanPaymentResult {
  operationId: string;
  appliedAmount: number;
  unappliedAmount: number;
  discountApplied: number;
  duplicate: boolean;
}

export interface LoanPaymentReversalRequest {
  operationId: string;
  installmentIndex: number;
}

export interface LoanPaymentReversalResult {
  operationId: string;
  reversedAmount: number;
  duplicate: boolean;
}

export interface CreatedLoanResult {
  id: string;
  contractNumber: string;
}

export type LoanDraft = Omit<Loan, 'id' | 'createdAt'>;

export type View = 'DASHBOARD' | 'CUSTOMERS' | 'LOANS' | 'SIMULATION' | 'REPORTS' | 'AUDIT';


