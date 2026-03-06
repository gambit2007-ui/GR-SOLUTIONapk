export type Frequency = 'DIARIO' | 'SEMANAL' | 'QUINZENAL' | 'MENSAL';
export type InterestType = 'SIMPLES' | 'PRICE';
export type PaymentStatus = 'PENDENTE' | 'PAGO' | 'ATRASADO';

// Padronizado para bater com as funções handleAddTransaction do App.tsx
export type CashMovementType = 'APORTE' | 'RETIRADA' | 'PAGAMENTO' | 'ESTORNO' | 'ENTRADA' | 'SAIDA';

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  createdAt: number;
}

export interface CashMovement {
  id?: string;
  type: CashMovementType;
  amount: number; // ✅ Corrigido de 'amout' para 'amount'
  description: string;
  date: string;
  loanId?: string;
  value?: number; // Fallback para compatibilidade com Dashboard antigo
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
  id?: string;
  number: number;
  value: number; // ✅ Use 'value' ou 'amount', mas garanta que o Dashboard use o mesmo
  amount?: number; // ✅ Adicionado como opcional para evitar quebra de tipos
  dueDate: string;
  status: 'PENDENTE' | 'PAGO' | 'ATRASADO'; // ✅ Adicionado ATRASADO
  paymentDate?: string; // ✅ Adicionado: essencial para o histórico do Dashboard
  lastPaymentDate?: string; 
  partialPaid?: number;
  lastPaidValue?: number;
  originalValue?: number;
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
  createdAt: any; // ✅ Alterado para 'any' pois o Firebase usa Timestamp ou ServerTimestamp
  notes?: string;
  installments: Installment[];
  status: 'ATIVO' | 'QUITADO' | 'ATRASADO' | 'CANCELADO';
  paidAmount: number;
}

export type View = 'DASHBOARD' | 'CUSTOMERS' | 'LOANS' | 'SIMULATION' | 'REPORTS';