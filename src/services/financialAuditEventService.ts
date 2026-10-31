import {
  collection,
  doc,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  type Transaction,
} from 'firebase/firestore';
import { db } from '../firebase';
import type { MovementActor } from './cashService';
import { sanitizeFirestorePayload } from '../utils/firestoreSanitizer';

export type FinancialAuditEventType =
  | 'CONTRACT_EDIT'
  | 'CANCELLATION'
  | 'LOAN_DELETION'
  | 'CASH_RECONCILIATION';

export interface FinancialAuditEvent {
  id: string;
  type: FinancialAuditEventType;
  actorUid: string;
  actorEmail?: string;
  actorName?: string;
  loanId?: string;
  previousAmount?: number;
  newAmount?: number;
  previousCash?: number;
  newCash?: number;
  reason?: string;
  recordedAt?: { toDate: () => Date };
}

export const appendFinancialAuditEventInTransaction = (
  tx: Transaction,
  event: Omit<FinancialAuditEvent, 'actorUid' | 'actorEmail' | 'actorName' | 'recordedAt'>,
  actor?: MovementActor,
) => {
  if (!actor?.uid) throw new Error('RESPONSAVEL_PELO_EVENTO_OBRIGATORIO');
  tx.set(doc(db, 'financialAuditEvents', event.id), sanitizeFirestorePayload({
    ...event,
    actorUid: actor.uid,
    actorEmail: actor.email?.toLowerCase(),
    actorName: actor.displayName,
    recordedAt: serverTimestamp(),
  }));
};

export const listRecentFinancialAuditEvents = async (): Promise<FinancialAuditEvent[]> => {
  const snapshot = await getDocs(query(
    collection(db, 'financialAuditEvents'), orderBy('recordedAt', 'desc'), limit(50),
  ));
  return snapshot.docs.map((item) => ({ id: item.id, ...item.data() } as FinancialAuditEvent));
};
