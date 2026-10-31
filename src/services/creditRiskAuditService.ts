import { collection, getDocs, limit, orderBy, query, type Timestamp } from 'firebase/firestore';
import { db } from '../firebase';

export interface CreditRiskDecisionRecord {
  id: string;
  action: string;
  status: string;
  customerId: string;
  customerName?: string;
  actorName?: string | null;
  actorEmail?: string | null;
  activeLoanIds: string[];
  openAmount: number;
  overdueAmount: number;
  maxCurrentOverdueDays: number;
  maxHistoricalOverdueDays: number;
  justification?: string | null;
  loanId?: string | null;
  operationId?: string | null;
  createdAt?: Timestamp;
}

export const listRecentCreditRiskDecisions = async (): Promise<CreditRiskDecisionRecord[]> => {
  const snapshot = await getDocs(query(
    collection(db, 'creditRiskDecisions'), orderBy('createdAt', 'desc'), limit(50),
  ));
  return snapshot.docs.map((document) => ({
    ...document.data(), id: document.id,
  } as CreditRiskDecisionRecord));
};
