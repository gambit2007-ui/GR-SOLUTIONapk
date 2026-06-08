import {
  collection,
  doc,
  getDocs,
  serverTimestamp,
  setDoc,
  updateDoc,
} from 'firebase/firestore';
import { createFirebaseScriptSession } from './shared/firebaseClient.ts';

type CashMovementRecord = {
  id: string;
  type: string;
  amount: number;
  description: string;
  date: string;
};

const round2 = (value: number) => Number((Number.isFinite(value) ? value : 0).toFixed(2));

const normalizeType = (value: unknown) =>
  String(value ?? '')
    .trim()
    .toUpperCase();

const parseAmountArg = (value: string | undefined, fallback: number) => {
  if (!value) return fallback;
  const normalized = value.includes(',')
    ? value.replace(/\./g, '').replace(',', '.')
    : value;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? round2(parsed) : fallback;
};

const parseArgs = () => {
  const args = new Map<string, string>();
  let apply = false;

  for (const token of process.argv.slice(2)) {
    if (token === '--apply') {
      apply = true;
      continue;
    }

    const [key, ...valueParts] = token.split('=');
    if (!key?.startsWith('--')) continue;
    args.set(key.slice(2), valueParts.join('='));
  }

  return {
    apply,
    oldAmount: parseAmountArg(args.get('old-amount'), 40412),
    newAmount: parseAmountArg(args.get('new-amount'), 404.12),
    datePrefix: String(args.get('date-prefix') ?? '').trim(),
  };
};

const normalizeMovement = (id: string, raw: Record<string, unknown>): CashMovementRecord => ({
  id,
  type: normalizeType(raw.type || 'ENTRADA') || 'ENTRADA',
  amount: round2(Math.abs(Number(raw.amount ?? raw.value ?? 0))),
  description: String(raw.description ?? 'MOVIMENTACAO'),
  date: String(raw.date ?? ''),
});

const resolveCashDelta = (movement: CashMovementRecord) => {
  if (movement.amount <= 0) return 0;
  return movement.type === 'APORTE' || movement.type === 'PAGAMENTO' || movement.type === 'ENTRADA'
    ? movement.amount
    : -movement.amount;
};

const recalculateCashBalance = async (
  db: Awaited<ReturnType<typeof createFirebaseScriptSession>>['db'],
  movements: CashMovementRecord[],
) => {
  const value = round2(movements.reduce((sum, movement) => sum + resolveCashDelta(movement), 0));
  await setDoc(doc(db, 'settings', 'caixa'), { value, updatedAt: serverTimestamp() }, { merge: true });
  return value;
};

const run = async () => {
  const { apply, oldAmount, newAmount, datePrefix } = parseArgs();
  const session = await createFirebaseScriptSession();
  const snapshot = await getDocs(collection(session.db, 'cashMovement'));
  const movements = snapshot.docs.map((docSnap) =>
    normalizeMovement(docSnap.id, docSnap.data() as Record<string, unknown>),
  );

  const candidates = movements.filter((movement) => {
    const isWithdrawal = movement.type === 'RETIRADA' || movement.type === 'SAIDA';
    const amountMatches = movement.amount === oldAmount;
    const dateMatches = datePrefix ? movement.date.startsWith(datePrefix) : true;
    return isWithdrawal && amountMatches && dateMatches;
  });

  const summary = {
    ok: true,
    dryRun: !apply,
    oldAmount,
    newAmount,
    datePrefix: datePrefix || undefined,
    scanned: movements.length,
    matched: candidates.length,
    candidates,
  };

  if (candidates.length !== 1) {
    console.log(JSON.stringify(summary, null, 2));
    throw new Error(`Esperado exatamente 1 lancamento para corrigir, encontrado ${candidates.length}.`);
  }

  if (!apply) {
    console.log(JSON.stringify(summary, null, 2));
    return;
  }

  const target = candidates[0];
  await updateDoc(doc(session.db, 'cashMovement', target.id), {
    amount: newAmount,
    value: newAmount,
    correctedAt: serverTimestamp(),
    correctionReason: `Valor corrigido de ${oldAmount.toFixed(2)} para ${newAmount.toFixed(2)}`,
  });

  const correctedMovements = movements.map((movement) =>
    movement.id === target.id ? { ...movement, amount: newAmount } : movement,
  );
  const newCashBalance = await recalculateCashBalance(session.db, correctedMovements);

  console.log(JSON.stringify({
    ...summary,
    correctedId: target.id,
    newCashBalance,
  }, null, 2));
};

run().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(JSON.stringify({ ok: false, message }, null, 2));
  process.exit(1);
});
