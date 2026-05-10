import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  serverTimestamp,
  setDoc,
} from 'firebase/firestore';
import { createFirebaseScriptSession } from './shared/firebaseClient.ts';

type CashMovementRecord = {
  id: string;
  type: string;
  amount: number;
  description: string;
  date: string;
  loanId?: string;
  createdByEmail?: string;
};

type DuplicateGroup = {
  key: string;
  minuteBucket: string;
  amount: number;
  description: string;
  type: string;
  loanId?: string;
  createdByEmail?: string;
  keep: CashMovementRecord;
  remove: CashMovementRecord[];
};

const round2 = (value: number) => Number((Number.isFinite(value) ? value : 0).toFixed(2));

const normalizeText = (value: unknown) =>
  String(value ?? '')
    .trim()
    .toUpperCase();

const normalizeEmail = (value: unknown) =>
  String(value ?? '')
    .trim()
    .toLowerCase();

const normalizeMovement = (id: string, raw: Record<string, unknown>): CashMovementRecord => ({
  id,
  type: normalizeText(raw.type || 'ENTRADA') || 'ENTRADA',
  amount: round2(Math.abs(Number(raw.amount ?? raw.value ?? 0))),
  description: normalizeText(raw.description || 'MOVIMENTACAO') || 'MOVIMENTACAO',
  date: String(raw.date ?? ''),
  loanId: String(raw.loanId ?? '').trim() || undefined,
  createdByEmail: normalizeEmail(raw.createdByEmail) || undefined,
});

const resolveCashDelta = (movement: CashMovementRecord) => {
  if (movement.amount <= 0) return 0;
  return movement.type === 'APORTE' || movement.type === 'PAGAMENTO' || movement.type === 'ENTRADA'
    ? movement.amount
    : -movement.amount;
};

const toMinuteBucket = (value: string) => {
  const parsed = new Date(value);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toISOString().slice(0, 16);
  }
  return String(value || '').slice(0, 16);
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
    const value = valueParts.join('=').trim();
    if (!value) continue;
    args.set(key.slice(2), value);
  }

  const amountRaw = args.get('amount');
  const amount = amountRaw ? round2(Number(amountRaw.replace(',', '.'))) : undefined;
  const keep = args.get('keep') === 'newest' ? 'newest' : 'oldest';

  return {
    apply,
    keep,
    description: normalizeText(args.get('description')),
    type: normalizeText(args.get('type')),
    loanId: String(args.get('loan-id') ?? '').trim(),
    createdByEmail: normalizeEmail(args.get('created-by-email')),
    datePrefix: String(args.get('date-prefix') ?? '').trim(),
    amount,
  };
};

const ensureSafeCriteria = (criteria: ReturnType<typeof parseArgs>) => {
  if (!criteria.description) {
    throw new Error('Use --description="..." para limitar a busca.');
  }

  if (!Number.isFinite(criteria.amount)) {
    throw new Error('Use --amount=123.45 para limitar a busca.');
  }

  if (!criteria.loanId && !criteria.createdByEmail && !criteria.datePrefix) {
    throw new Error('Use pelo menos um entre --loan-id, --created-by-email ou --date-prefix para evitar remocoes indevidas.');
  }
};

const matchesCriteria = (
  movement: CashMovementRecord,
  criteria: ReturnType<typeof parseArgs>,
) => {
  if (criteria.description && movement.description !== criteria.description) return false;
  if (Number.isFinite(criteria.amount) && movement.amount !== criteria.amount) return false;
  if (criteria.type && movement.type !== criteria.type) return false;
  if (criteria.loanId && movement.loanId !== criteria.loanId) return false;
  if (criteria.createdByEmail && movement.createdByEmail !== criteria.createdByEmail) return false;
  if (criteria.datePrefix && !movement.date.startsWith(criteria.datePrefix)) return false;
  return true;
};

const sortForKeeping = (items: CashMovementRecord[], keep: 'oldest' | 'newest') =>
  [...items].sort((a, b) => {
    const aTime = new Date(a.date).getTime();
    const bTime = new Date(b.date).getTime();
    const safeATime = Number.isFinite(aTime) ? aTime : 0;
    const safeBTime = Number.isFinite(bTime) ? bTime : 0;

    if (safeATime !== safeBTime) {
      return keep === 'oldest' ? safeATime - safeBTime : safeBTime - safeATime;
    }

    return keep === 'oldest'
      ? a.id.localeCompare(b.id)
      : b.id.localeCompare(a.id);
  });

const buildDuplicateGroups = (
  movements: CashMovementRecord[],
  keep: 'oldest' | 'newest',
): DuplicateGroup[] => {
  const groups = new Map<string, CashMovementRecord[]>();

  for (const movement of movements) {
    const minuteBucket = toMinuteBucket(movement.date);
    const key = [
      movement.type,
      movement.amount.toFixed(2),
      movement.description,
      movement.loanId || '',
      movement.createdByEmail || '',
      minuteBucket,
    ].join('|');

    const bucket = groups.get(key) ?? [];
    bucket.push(movement);
    groups.set(key, bucket);
  }

  return Array.from(groups.entries())
    .filter(([, entries]) => entries.length > 1)
    .map(([key, entries]) => {
      const ordered = sortForKeeping(entries, keep);
      const [keeper, ...remove] = ordered;
      return {
        key,
        minuteBucket: toMinuteBucket(keeper.date),
        amount: keeper.amount,
        description: keeper.description,
        type: keeper.type,
        loanId: keeper.loanId,
        createdByEmail: keeper.createdByEmail,
        keep: keeper,
        remove,
      };
    });
};

const recalculateCashBalance = async (db: Awaited<ReturnType<typeof createFirebaseScriptSession>>['db']) => {
  const snapshot = await getDocs(collection(db, 'cashMovement'));
  const movements = snapshot.docs.map((docSnap) => normalizeMovement(docSnap.id, docSnap.data() as Record<string, unknown>));
  const value = round2(movements.reduce((sum, movement) => sum + resolveCashDelta(movement), 0));
  await setDoc(doc(db, 'settings', 'caixa'), { value, updatedAt: serverTimestamp() }, { merge: true });
  return value;
};

const run = async () => {
  const criteria = parseArgs();
  ensureSafeCriteria(criteria);

  const session = await createFirebaseScriptSession();
  const snapshot = await getDocs(collection(session.db, 'cashMovement'));
  const movements = snapshot.docs.map((docSnap) => normalizeMovement(docSnap.id, docSnap.data() as Record<string, unknown>));
  const candidates = movements.filter((movement) => matchesCriteria(movement, criteria));
  const duplicateGroups = buildDuplicateGroups(candidates, criteria.keep);
  const toRemove = duplicateGroups.flatMap((group) => group.remove);

  const summary = {
    ok: true,
    dryRun: !criteria.apply,
    criteria: {
      description: criteria.description,
      amount: criteria.amount,
      type: criteria.type || undefined,
      loanId: criteria.loanId || undefined,
      createdByEmail: criteria.createdByEmail || undefined,
      datePrefix: criteria.datePrefix || undefined,
      keep: criteria.keep,
    },
    scanned: movements.length,
    matched: candidates.length,
    duplicateGroups: duplicateGroups.length,
    duplicateDocuments: toRemove.length,
    groups: duplicateGroups.map((group) => ({
      minuteBucket: group.minuteBucket,
      type: group.type,
      amount: group.amount,
      description: group.description,
      loanId: group.loanId,
      createdByEmail: group.createdByEmail,
      keep: group.keep,
      remove: group.remove,
    })),
  };

  if (!criteria.apply) {
    console.log(JSON.stringify(summary, null, 2));
    return;
  }

  for (const movement of toRemove) {
    await deleteDoc(doc(session.db, 'cashMovement', movement.id));
  }

  const newCashBalance = await recalculateCashBalance(session.db);

  console.log(JSON.stringify({
    ...summary,
    deletedIds: toRemove.map((movement) => movement.id),
    newCashBalance,
  }, null, 2));
};

run().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(JSON.stringify({ ok: false, message }, null, 2));
  process.exit(1);
});
