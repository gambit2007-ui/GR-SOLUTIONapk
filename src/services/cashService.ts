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
import { CashMovement, MovementType } from '../types';
import { parseCashMovement, parseMovementType, resolveCashDelta } from '../utils/domainParsers';

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
  actor?: MovementActor;
}

const caixaRef = doc(db, 'settings', 'caixa');

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

export const appendCashMovementInTransaction = async (
  tx: Transaction,
  payload: CashMovementPayload,
) => {
  const type = parseMovementType(payload.type);
  const amount = normalizeAmount(payload.amount);
  const description = normalizeDescription(payload.description);
  const movementRef = doc(collection(db, 'cashMovement'));

  const caixaSnap = await tx.get(caixaRef);
  const saldoAtual = caixaSnap.exists() ? Number(caixaSnap.data().value) || 0 : 0;

  const movement: CashMovement = {
    id: movementRef.id,
    type,
    amount,
    value: amount,
    description,
    date: new Date().toISOString(),
    loanId: payload.loanId,
    ...buildMovementActorPayload(payload.actor),
  };

  const novoSaldo = Number((saldoAtual + resolveCashDelta(movement)).toFixed(2));

  tx.set(movementRef, movement);
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

