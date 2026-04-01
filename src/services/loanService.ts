import {
  collection,
  deleteDoc,
  doc,
  runTransaction,
  serverTimestamp,
  updateDoc,
} from 'firebase/firestore';
import { db } from '../firebase';
import { Installment, Loan, LoanDraft, LoanType, MovementType } from '../types';
import { appendCashMovementInTransaction, MovementActor } from './cashService';
import { sanitizeFirestorePayload } from '../utils/firestoreSanitizer';
import { parseMovementType } from '../utils/domainParsers';

export interface LoanMovementPayload {
  type: MovementType;
  amount: number;
  description: string;
  actor?: MovementActor;
}

const round2 = (value: number): number => Number((Number.isFinite(value) ? value : 0).toFixed(2));

const toLoanType = (value: unknown): LoanType => {
  const normalized = String(value ?? '').trim().toUpperCase();
  return normalized === 'PRICE' ? 'PRICE' : 'SIMPLE';
};

const toInstallmentAmount = (installment: Installment, fallback = 0): number => {
  const value = Number(installment.amount ?? installment.value ?? fallback);
  return Number.isFinite(value) ? round2(value) : round2(fallback);
};

const calculatePricePayment = (principal: number, rate: number, installments: number): number => {
  if (installments <= 0) return 0;
  if (rate <= 0) return round2(principal / installments);
  const factor = Math.pow(1 + rate, installments);
  if (!Number.isFinite(factor) || factor <= 1) return round2(principal / installments);
  return round2(principal * ((rate * factor) / (factor - 1)));
};

const enrichPriceInstallments = (loanDraft: LoanDraft): LoanDraft => {
  if (toLoanType(loanDraft.interestType) !== 'PRICE') {
    return loanDraft;
  }

  const installments = Array.isArray(loanDraft.installments)
    ? loanDraft.installments.map((installment) => ({ ...installment }))
    : [];
  if (installments.length === 0) {
    return loanDraft;
  }

  const principalTotal = Math.max(round2(Number(loanDraft.amount || 0)), 0);
  if (principalTotal <= 0) {
    return loanDraft;
  }

  const rate = Math.max(Number(loanDraft.interestRate || 0) / 100, 0);
  const fallbackInstallmentAmount = calculatePricePayment(principalTotal, rate, installments.length);

  let saldoPrincipal = principalTotal;
  const lastIndex = installments.length - 1;

  const enrichedInstallments = installments.map((installment, index) => {
    const baseAmount = toInstallmentAmount(installment, fallbackInstallmentAmount);
    const hasExpectedValues =
      Number.isFinite(Number(installment.expectedPrincipal)) &&
      Number.isFinite(Number(installment.expectedInterest));

    if (hasExpectedValues) {
      const expectedPrincipal = Math.max(round2(Number(installment.expectedPrincipal || 0)), 0);
      const expectedInterest = Math.max(round2(Number(installment.expectedInterest || 0)), 0);
      saldoPrincipal = Math.max(round2(saldoPrincipal - expectedPrincipal), 0);
      return {
        ...installment,
        expectedPrincipal,
        expectedInterest,
      };
    }

    let expectedInterest = rate > 0 ? round2(saldoPrincipal * rate) : 0;
    let expectedPrincipal = round2(baseAmount - expectedInterest);

    if (index === lastIndex) {
      expectedPrincipal = round2(saldoPrincipal);
      expectedInterest = round2(Math.max(baseAmount - expectedPrincipal, 0));
    } else {
      expectedPrincipal = round2(Math.max(expectedPrincipal, 0));
      if (expectedPrincipal > saldoPrincipal) {
        expectedPrincipal = round2(saldoPrincipal);
        expectedInterest = round2(Math.max(baseAmount - expectedPrincipal, 0));
      }
    }

    saldoPrincipal = Math.max(round2(saldoPrincipal - expectedPrincipal), 0);

    return {
      ...installment,
      expectedPrincipal,
      expectedInterest,
    };
  });

  return {
    ...loanDraft,
    installments: enrichedInstallments,
  };
};

export const createLoan = async (loanDraft: LoanDraft, actor?: MovementActor): Promise<string> => {
  const normalizedLoanDraft = enrichPriceInstallments(loanDraft);
  const safeLoanData = sanitizeFirestorePayload(normalizedLoanDraft);
  const amount = Number(normalizedLoanDraft.amount || 0);

  const createdLoanId = await runTransaction(db, async (tx) => {
    const loanRef = doc(collection(db, 'loans'));

    await appendCashMovementInTransaction(tx, {
      type: 'RETIRADA',
      amount,
      description: `EMPRESTIMO: ${normalizedLoanDraft.customerName}`,
      loanId: loanRef.id,
      actor,
    });

    tx.set(loanRef, {
      ...safeLoanData,
      createdAt: serverTimestamp(),
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

    await appendCashMovementInTransaction(tx, {
      type: movementType,
      amount: movement.amount,
      description: movement.description,
      loanId,
      actor: movement.actor,
    });

    tx.update(loanRef, sanitizeFirestorePayload(payload));
  });
};

export const deleteLoan = async (loanId: string) => {
  await deleteDoc(doc(db, 'loans', loanId));
};
