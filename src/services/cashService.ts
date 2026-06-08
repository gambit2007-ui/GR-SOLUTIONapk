import {
  collection,
  doc,
  getDocs,
  runTransaction,
  serverTimestamp,
  setDoc,
  Transaction,
} from 'firebase/firestore';
import { db } from '../firebase';
import { CashMovement, CashMovementSourceType, CashMovementStatus, MovementType } from '../types';
import { parseCashMovement, parseMovementType, resolveCashDelta } from '../utils/domainParsers';
import { sanitizeFirestorePayload } from '../utils/firestoreSanitizer';

export interface MovementActor {
  uid?: string | null;
  email?: string | null;
  displayName?: string | null;
}

export interface CashMovementPayload {
  type: MovementType;
  amount: number;
  description: string;
  loanId?: string;
  sourceId?: string;
  sourceType?: CashMovementSourceType;
  status?: CashMovementStatus;
  customerId?: string;
  customerName?: string;
  installmentId?: string;
  installmentNumber?: number;
  balanceBefore?: number;
  reversedMovementId?: string;
  notes?: string;
  actor?: MovementActor;
}

const caixaRef = doc(db, 'settings', 'caixa');

export const readCashBalanceInTransaction = async (tx: Transaction): Promise<number> => {
  const caixaSnap = await tx.get(caixaRef);
  return caixaSnap.exists() ? Number(caixaSnap.data().value) || 0 : 0;
};

const normalizeAmount = (value: number): number => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error('VALOR_INVALIDO');
  }
  return Number(parsed.toFixed(2));
};

const normalizeDescription = (value: string): string => {
  const parsed = String(value ?? '').trim();
  if (!parsed) {
    throw new Error('MOTIVO_OBRIGATORIO');
  }
  return parsed.toUpperCase();
};

const buildMovementActorPayload = (actor?: MovementActor) => {
  const payload: Partial<Pick<CashMovement, 'createdByUid' | 'createdByEmail' | 'createdByName'>> = {};
  if (actor?.uid) payload.createdByUid = actor.uid;
  if (actor?.email) payload.createdByEmail = actor.email.toLowerCase();
  if (actor?.displayName) payload.createdByName = actor.displayName;
  return payload;
};

const inferSourceType = (type: MovementType, description: string, loanId?: string): CashMovementSourceType => {
  const normalizedDescription = description.toUpperCase();
  if (type === 'PAGAMENTO') {
    if (normalizedDescription.includes('RENOVACAO JUROS')) return 'LOAN_RENEWAL_INTEREST';
    return 'LOAN_PAYMENT';
  }
  if (type === 'RETIRADA') {
    if (normalizedDescription.includes('EMPRESTIMO') || loanId) return 'LOAN_DISBURSEMENT';
    return 'MANUAL_EXIT';
  }
  if (type === 'ESTORNO') return 'REVERSAL';
  if (type === 'APORTE' || type === 'ENTRADA') return 'MANUAL_ENTRY';
  return 'MANUAL_EXIT';
};

export const appendCashMovementInTransaction = async (
  tx: Transaction,
  payload: CashMovementPayload,
  options?: { currentCashBalance?: number },
) => {
  const type = parseMovementType(payload.type);
  const amount = normalizeAmount(payload.amount);
  const description = normalizeDescription(payload.description);
  const movementRef = doc(collection(db, 'cashMovement'));
  const providedCashBalance = Number(options?.currentCashBalance);
  const saldoAtual = Number.isFinite(providedCashBalance)
    ? providedCashBalance
    : await readCashBalanceInTransaction(tx);
  const balanceBefore = Number(
    Number.isFinite(Number(payload.balanceBefore)) ? Number(payload.balanceBefore) : saldoAtual,
  );
  const sourceType = payload.sourceType ?? inferSourceType(type, description, payload.loanId);
  const status = payload.status ?? 'POSTED';
  const balanceAfter = Number((balanceBefore + resolveCashDelta({ type, amount, description, date: new Date().toISOString() })).toFixed(2));

  const movement: CashMovement = {
    id: movementRef.id,
    type,
    amount,
    value: amount,
    description,
    date: new Date().toISOString(),
    loanId: payload.loanId,
    sourceId: payload.sourceId ?? payload.loanId,
    sourceType,
    status,
    customerId: payload.customerId,
    customerName: payload.customerName,
    installmentId: payload.installmentId,
    installmentNumber: payload.installmentNumber,
    balanceBefore,
    balanceAfter,
    reversedMovementId: payload.reversedMovementId,
    createdAt: new Date().toISOString(),
    notes: payload.notes,
    ...buildMovementActorPayload(payload.actor),
  };
  const sanitizedMovement = sanitizeFirestorePayload(movement);

  const novoSaldo = balanceAfter;

  tx.set(movementRef, sanitizedMovement);
  tx.set(caixaRef, { value: novoSaldo, updatedAt: serverTimestamp() }, { merge: true });

  return { movement, novoSaldo, movementRef };
};

export const addCashMovement = async (payload: CashMovementPayload) => {
  await runTransaction(db, async (tx) => {
    await appendCashMovementInTransaction(tx, payload);
  });
};

export const recalculateCashBalance = async (): Promise<number> => {
  const movementSnap = await getDocs(collection(db, 'cashMovement'));
  const movements = movementSnap.docs.map((movementDoc) => parseCashMovement(movementDoc.id, movementDoc.data()));

  const saldoCalculado = movements.reduce((acc, movement) => acc + resolveCashDelta(movement), 0);
  const novoSaldo = Number(saldoCalculado.toFixed(2));

  await setDoc(caixaRef, { value: novoSaldo, updatedAt: serverTimestamp() }, { merge: true });
  return novoSaldo;
};
