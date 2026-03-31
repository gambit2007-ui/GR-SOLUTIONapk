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

export interface FirestoreTimestampLike {
  toDate: () => Date;
}

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  password?: string;
  createdAt: number;
}

export interface CashMovement {
  id?: string;
  type: CashMovementType;
  amount: number;
  description: string;
  date: string;
  loanId?: string;
  createdByUid?: string;
  createdByEmail?: string;
  createdByName?: string;
  value?: number;
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
  lastPaidValue?: number;
  originalValue?: number;
  expectedPrincipal?: number;
  expectedInterest?: number;
  paymentBreakdown?: PaymentBreakdown;
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
}

export type LoanDraft = Omit<Loan, 'id' | 'createdAt'>;

export type View = 'DASHBOARD' | 'CUSTOMERS' | 'LOANS' | 'SIMULATION' | 'REPORTS';


