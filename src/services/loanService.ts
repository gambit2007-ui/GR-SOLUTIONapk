import {
  collection,
  deleteDoc,
  doc,
  runTransaction,
  serverTimestamp,
  updateDoc,
} from 'firebase/firestore';
import { db } from '../firebase';
import { Loan, LoanDraft, MovementType } from '../types';
import { appendCashMovementInTransaction, MovementActor } from './cashService';
import { sanitizeFirestorePayload } from '../utils/firestoreSanitizer';
import { parseMovementType } from '../utils/domainParsers';

export interface LoanMovementPayload {
  type: MovementType;
  amount: number;
  description: string;
  actor?: MovementActor;
}

export const createLoan = async (loanDraft: LoanDraft, actor?: MovementActor): Promise<string> => {
  const safeLoanData = sanitizeFirestorePayload(loanDraft);
  const amount = Number(loanDraft.amount || 0);

  const createdLoanId = await runTransaction(db, async (tx) => {
    const loanRef = doc(collection(db, 'loans'));

    tx.set(loanRef, {
      ...safeLoanData,
      createdAt: serverTimestamp(),
    });

    await appendCashMovementInTransaction(tx, {
      type: 'RETIRADA',
      amount,
      description: `EMPRESTIMO: ${loanDraft.customerName}`,
      loanId: loanRef.id,
      actor,
    });

    return loanRef.id;
  });

  return createdLoanId;
};

export const updateLoan = async (loanId: string, payload: Partial<Loan>) => {
  await updateDoc(doc(db, 'loans', loanId), sanitizeFirestorePayload(payload));
};

export const updateLoanAndAddMovement = async (
  loanId: string,
  payload: Partial<Loan>,
  movement: LoanMovementPayload,
) => {
  const movementType = parseMovementType(movement.type);

  await runTransaction(db, async (tx) => {
    const loanRef = doc(db, 'loans', loanId);
    const loanSnap = await tx.get(loanRef);
    if (!loanSnap.exists()) throw new Error('CONTRATO_NAO_ENCONTRADO');

    tx.update(loanRef, sanitizeFirestorePayload(payload));

    await appendCashMovementInTransaction(tx, {
      type: movementType,
      amount: movement.amount,
      description: movement.description,
      loanId,
      actor: movement.actor,
    });
  });
};

export const deleteLoan = async (loanId: string) => {
  await deleteDoc(doc(db, 'loans', loanId));
};

