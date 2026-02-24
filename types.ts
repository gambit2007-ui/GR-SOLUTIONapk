
export type Frequency = 'DIARIO' | 'SEMANAL' | 'MENSAL';
export type InterestType = 'SIMPLES' | 'PRICE';
export type PaymentStatus = 'PENDENTE' | 'PAGO' | 'ATRASADO';
export type CashMovementType = 'APORTE' | 'RETIRADA' | 'RECEBIMENTO' | 'ESTORNO';

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  password?: string;
  createdAt: number;
}

export interface CustomerDocument {
  name: string;
  type: string;
  data: string; // base64
}

export interface Customer {
  id: string;
  name: string;
  cpf: string;
  rg: string;
  email: string;
  phone: string;
  address: string;
  notes?: string;
  avatar?: string; // base64 image string
  documents?: CustomerDocument[];
  createdAt: number;
}

export interface PaymentRecord {
  id: string;
  date: number;
  amount: number;
  penalty?: number;
  interest?: number;
  notes?: string;
}

export interface Installment {
  id: string;
  number: number;
  dueDate: string;
  value: number; // Valor original
  status: PaymentStatus;
  paidAt?: number;
  paidValue?: number; // Valor total já pago (incluindo pagamentos parciais)
  penaltyApplied?: number; // Valor da multa acumulada
  paymentHistory?: PaymentRecord[];
}

export interface CashMovement {
  id: string;
  type: CashMovementType;
  amount: number;
  description: string;
  date: number;
}

export interface Loan {
  id: string;
  contractNumber: string;
  customerId: string;
  customerName: string;
  customerPhone?: string;
  amount: number;
  interestRate: number;
  installmentCount: number;
  frequency: Frequency;
  interestType: InterestType;
  totalToReturn: number;
  installmentValue: number;
  startDate: string; // ISO string
  dueDate: string;   // Primeiro vencimento
  createdAt: number;
  notes?: string;
  installments: Installment[];
}

export type View = 'DASHBOARD' | 'CUSTOMERS' | 'LOANS' | 'SIMULATION' | 'REPORTS';
