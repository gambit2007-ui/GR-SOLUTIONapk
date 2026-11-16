import {
  collection,
  doc,
  getDoc,
  getDocs,
  runTransaction,
  serverTimestamp,
  Transaction,
} from 'firebase/firestore';
import { db } from '../firebase';
import { CashMovement, CashMovementCategory, MovementType } from '../types';
import { parseCashInflowCategory, parseCashOutflowCategory } from '../utils/cashCategories';
import { parseCashMovement, parseMovementType, resolveCashDelta } from '../utils/domainParsers';
import { sanitizeFirestorePayload } from '../utils/firestoreSanitizer';
import { appendFinancialAuditEventInTransaction } from './financialAuditEventService';

export interface MovementActor {
  uid?: string | null;
  email?: string | null;
  displayName?: string | null;
}

export interface CashMovementPayload {
  type: MovementType;
  amount: number;
  description: string;
  category?: CashMovementCategory;
  loanId?: string;
  actor?: MovementActor;
  operationId?: string;
  discountApplied?: number;
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

export const appendCashMovementInTransaction = async (
  tx: Transaction,
  payload: CashMovementPayload,
  options?: { currentCashBalance?: number; movementId?: string },
) => {
  const type = parseMovementType(payload.type);
  const amount = normalizeAmount(payload.amount);
  const description = normalizeDescription(payload.description);
  const movementRef = options?.movementId
    ? doc(db, 'cashMovement', options.movementId)
    : doc(collection(db, 'cashMovement'));
  const providedCashBalance = Number(options?.currentCashBalance);
  const saldoAtual = Number.isFinite(providedCashBalance)
    ? providedCashBalance
    : await readCashBalanceInTransaction(tx);

  const movement: CashMovement = {
    id: movementRef.id,
    type,
    amount,
    value: amount,
    description,
    date: new Date().toISOString(),
    category: type === 'SAIDA'
      ? parseCashOutflowCategory(payload.category) || 'DESPESA_OPERACIONAL'
      : type === 'ENTRADA' || type === 'APORTE'
        ? parseCashInflowCategory(payload.category) || 'OUTRAS_ENTRADAS'
        : undefined,
    loanId: payload.loanId,
    operationId: payload.operationId,
    discountApplied: payload.discountApplied,
    ...buildMovementActorPayload(payload.actor),
  };
  const sanitizedMovement = sanitizeFirestorePayload(movement);

  const novoSaldo = Number((saldoAtual + resolveCashDelta(movement)).toFixed(2));

  tx.set(movementRef, {
    ...sanitizedMovement,
    recordedAt: serverTimestamp(),
  });
  tx.set(caixaRef, {
    value: novoSaldo,
    lastMovementId: movementRef.id,
    updatedByUid: payload.actor?.uid || undefined,
    updatedAt: serverTimestamp(),
  }, { merge: true });

  return { movement, novoSaldo, movementRef };
};

export const addCashMovement = async (payload: CashMovementPayload) => {
  await runTransaction(db, async (tx) => {
    await appendCashMovementInTransaction(tx, payload);
  });
};

export const recalculateCashBalance = async (actor?: MovementActor): Promise<number> => {
  if (!actor?.uid) throw new Error('RESPONSAVEL_PELA_CONCILIACAO_OBRIGATORIO');
  const previousCashSnapshot = await getDoc(caixaRef);
  const movementSnap = await getDocs(collection(db, 'cashMovement'));
  const movements = movementSnap.docs.map((movementDoc) => parseCashMovement(movementDoc.id, movementDoc.data()));

  const saldoCalculado = movements.reduce((acc, movement) => acc + resolveCashDelta(movement), 0);
  const novoSaldo = Number(saldoCalculado.toFixed(2));

  const auditId = `cash-reconciliation-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  await runTransaction(db, async (tx) => {
    const currentCashSnapshot = await tx.get(caixaRef);
    const previousMovementId = String(previousCashSnapshot.data()?.lastMovementId || '');
    const currentMovementId = String(currentCashSnapshot.data()?.lastMovementId || '');
    if (previousMovementId !== currentMovementId) {
      throw new Error('CAIXA_MUDOU_DURANTE_A_CONCILIACAO');
    }
    const previousCash = currentCashSnapshot.exists() ? Number(currentCashSnapshot.data().value || 0) : 0;
    tx.set(caixaRef, {
      value: novoSaldo,
      reconciledByUid: actor.uid,
      reconciledAuditId: auditId,
      reconciledAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    }, { merge: true });
    appendFinancialAuditEventInTransaction(tx, {
      id: auditId,
      type: 'CASH_RECONCILIATION',
      previousCash,
      newCash: novoSaldo,
      reason: 'Conciliacao manual com movimentos do livro caixa',
    }, actor);
  });
  return novoSaldo;
};
