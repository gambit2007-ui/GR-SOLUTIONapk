
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
export interface Transaction {
  id: string;
  type: 'INCOME' | 'EXPENSE'; // INCOME = Entrada (Verde), EXPENSE = Saída (Laranja)
  category: string;
  amount: number;
  date: string; // Formato ISO "2024-03-25"
  description: string;
  loanId?: string; // Opcional, caso a transação venha de um empréstimo específico
}
export interface Installment {
  number: number;
  value: number;
  dueDate: string;
  status: 'PENDENTE' | 'PAGO';
  partialPaid?: number;    // Para o valor que foi abatido parcialmente
  lastPaidValue?: number;  // Para o valor total que foi pago na última operação
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
  status?: string;
  paidAmount?: number;        // <--- ADICIONE ESTA LINHA (Opcional)
}

export type View = 'DASHBOARD' | 'CUSTOMERS' | 'LOANS' | 'SIMULATION' | 'REPORTS';
