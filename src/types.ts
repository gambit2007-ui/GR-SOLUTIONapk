export type Frequency = 'DIARIO' | 'SEMANAL' | 'QUINZENAL' | 'MENSAL'; // Adicionei QUINZENAL que usamos no LoanSection
export type InterestType = 'SIMPLES' | 'PRICE';
export type PaymentStatus = 'PENDENTE' | 'PAGO' | 'ATRASADO';

// ✅ Padronizei os tipos de movimentação para bater com o que usamos nas funções
export type CashMovementType = 'APORTE' | 'RETIRADA' | 'PAGAMENTO' | 'ESTORNO';

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  password?: string;
  createdAt: number;
}

// ✅ Esta é a interface que o TypeScript não estava achando
export interface CashMovement {
  id?: string;
  type: CashMovementType; // Usa o type acima
  amout: number;
  description: string;
  date: string;
  loanId?: string;
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
  avatar?: string;
  documents?: CustomerDocument[];
  createdAt: number;
}

export interface Installment {
  id?: string; // Adicionei ID para facilitar a busca no Firebase
  number: number;
  amout: number;
  dueDate: string;
  status: 'PENDENTE' | 'PAGO';
  partialPaid?: number;
  lastPaidValue?: number;
  originalValue?: number; // Para controle de juros/mora futuro
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
  startDate: string;
  dueDate: string;
  createdAt: number;
  notes?: string;
  installments: Installment[];
  status: 'ATIVO' | 'QUITADO' | 'ATRASADO' | 'CANCELADO';
  paidAmount: number;
}

export type View = 'DASHBOARD' | 'CUSTOMERS' | 'LOANS' | 'SIMULATION' | 'REPORTS';