export type Frequency = 'DIARIO' | 'SEMANAL' | 'MENSAL';
export type InterestType = 'SIMPLES' | 'PRICE';

export interface Customer {
  id: string;
  name: string;
  cpf: string;
  phone?: string;
}

export interface Installment {
  id: string;
  number: number;
  dueDate: string;
  value: number;
  status: 'PENDENTE' | 'PAGO' | 'ATRASADO';
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
  installments: Installment[];
}