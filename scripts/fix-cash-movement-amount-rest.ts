type JsonRecord = Record<string, unknown>;

type FirestoreValue =
  | { nullValue: null }
  | { booleanValue: boolean }
  | { integerValue: string }
  | { doubleValue: number }
  | { timestampValue: string }
  | { stringValue: string }
  | { mapValue: { fields?: Record<string, FirestoreValue> } }
  | { arrayValue: { values?: FirestoreValue[] } };

const API_KEY = 'AIzaSyBH1MWR7uSgcOF4WsrQnnkgPNpzdBkonxA';
const PROJECT_ID = 'grsolution-8e6cb';
const DATABASE = '(default)';
const BASE_URL = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/${DATABASE}/documents`;

const round2 = (value: number): number => Number((Number.isFinite(value) ? value : 0).toFixed(2));

const decodeValue = (value: FirestoreValue | undefined): unknown => {
  if (!value || typeof value !== 'object') return undefined;
  if ('nullValue' in value) return null;
  if ('booleanValue' in value) return Boolean(value.booleanValue);
  if ('integerValue' in value) return Number(value.integerValue);
  if ('doubleValue' in value) return Number(value.doubleValue);
  if ('timestampValue' in value) return String(value.timestampValue);
  if ('stringValue' in value) return String(value.stringValue);
  if ('arrayValue' in value) return (value.arrayValue.values ?? []).map((entry) => decodeValue(entry));
  if ('mapValue' in value) {
    const fields = value.mapValue.fields ?? {};
    const obj: JsonRecord = {};
    for (const [k, v] of Object.entries(fields)) obj[k] = decodeValue(v);
    return obj;
  }
  return undefined;
};

const encodeValue = (value: unknown): FirestoreValue => {
  if (value === null || value === undefined) return { nullValue: null };
  if (typeof value === 'boolean') return { booleanValue: value };
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return { doubleValue: 0 };
    return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  }
  if (typeof value === 'string') return { stringValue: value };
  if (Array.isArray(value)) return { arrayValue: { values: value.map((entry) => encodeValue(entry)) } };
  if (typeof value === 'object') {
    const fields: Record<string, FirestoreValue> = {};
    for (const [key, entry] of Object.entries(value as JsonRecord)) fields[key] = encodeValue(entry);
    return { mapValue: { fields } };
  }
  return { stringValue: String(value) };
};

const parseAmountArg = (value: string | undefined, fallback: number) => {
  if (!value) return fallback;
  const normalized = value.includes(',')
    ? value.replace(/\./g, '').replace(',', '.')
    : value;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? round2(parsed) : fallback;
};

const normalizeType = (value: unknown) =>
  String(value ?? '')
    .trim()
    .toUpperCase();

const getAuthToken = async (): Promise<string> => {
  const email = process.env.FIREBASE_EMAIL;
  const password = process.env.FIREBASE_PASSWORD;
  if (!email || !password) throw new Error('Missing FIREBASE_EMAIL/FIREBASE_PASSWORD');

  const response = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, returnSecureToken: true }),
    },
  );

  if (!response.ok) throw new Error(`Auth failed: ${response.status} ${await response.text()}`);
  const payload = (await response.json()) as { idToken?: string };
  if (!payload.idToken) throw new Error('Auth response missing idToken');
  return payload.idToken;
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
    if (key?.startsWith('--')) args.set(key.slice(2), valueParts.join('='));
  }

  return {
    apply,
    oldAmount: parseAmountArg(args.get('old-amount'), 40412),
    newAmount: parseAmountArg(args.get('new-amount'), 404.12),
    datePrefix: String(args.get('date-prefix') ?? '').trim(),
  };
};

const fetchCollection = async (idToken: string, collectionId: string) => {
  const response = await fetch(`${BASE_URL}:runQuery`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${idToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      structuredQuery: {
        from: [{ collectionId }],
      },
    }),
  });

  if (!response.ok) throw new Error(`runQuery ${collectionId} failed: ${response.status} ${await response.text()}`);
  const rows = (await response.json()) as Array<{ document?: { name?: string; fields?: Record<string, FirestoreValue> } }>;
  return rows
    .map((row) => row.document)
    .filter((doc): doc is { name: string; fields?: Record<string, FirestoreValue> } => Boolean(doc?.name));
};

const decodeDocument = (document: { name: string; fields?: Record<string, FirestoreValue> }) => {
  const data: JsonRecord = {};
  for (const [key, value] of Object.entries(document.fields ?? {})) data[key] = decodeValue(value);
  return {
    id: document.name.split('/').pop() ?? '',
    name: document.name,
    data,
  };
};

const movementAmount = (movement: JsonRecord) => round2(Math.abs(Number(movement.amount ?? movement.value ?? 0)));

const resolveCashDelta = (movement: JsonRecord) => {
  const amount = movementAmount(movement);
  if (amount <= 0) return 0;
  const type = normalizeType(movement.type || 'ENTRADA');
  return type === 'APORTE' || type === 'PAGAMENTO' || type === 'ENTRADA' ? amount : -amount;
};

const patchDocument = async (idToken: string, documentPath: string, fields: JsonRecord, updateMask: string[]) => {
  const mask = updateMask.map((field) => `updateMask.fieldPaths=${encodeURIComponent(field)}`).join('&');
  const response = await fetch(`${BASE_URL}/${documentPath}?${mask}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${idToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      fields: Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, encodeValue(value)])),
    }),
  });

  if (!response.ok) throw new Error(`Patch failed: ${response.status} ${await response.text()}`);
};

const run = async () => {
  const { apply, oldAmount, newAmount, datePrefix } = parseArgs();
  const idToken = await getAuthToken();
  const documents = await fetchCollection(idToken, 'cashMovement');
  const decoded = documents.map(decodeDocument);

  const candidates = decoded.filter(({ data }) => {
    const type = normalizeType(data.type || 'ENTRADA');
    const isWithdrawal = type === 'RETIRADA' || type === 'SAIDA';
    const amountMatches = movementAmount(data) === oldAmount;
    const dateMatches = datePrefix ? String(data.date ?? '').startsWith(datePrefix) : true;
    return isWithdrawal && amountMatches && dateMatches;
  });

  const summary = {
    ok: true,
    dryRun: !apply,
    oldAmount,
    newAmount,
    datePrefix: datePrefix || undefined,
    scanned: decoded.length,
    matched: candidates.length,
    candidates: candidates.map(({ id, data }) => ({
      id,
      type: data.type,
      amount: movementAmount(data),
      description: data.description,
      date: data.date,
      createdByEmail: data.createdByEmail,
    })),
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
  await patchDocument(
    idToken,
    `cashMovement/${target.id}`,
    {
      amount: newAmount,
      value: newAmount,
      correctedAt: new Date().toISOString(),
      correctionReason: `Valor corrigido de ${oldAmount.toFixed(2)} para ${newAmount.toFixed(2)}`,
    },
    ['amount', 'value', 'correctedAt', 'correctionReason'],
  );

  const correctedMovements = decoded.map(({ id, data }) =>
    id === target.id ? { ...data, amount: newAmount, value: newAmount } : data,
  );
  const newCashBalance = round2(correctedMovements.reduce((sum, movement) => sum + resolveCashDelta(movement), 0));
  await patchDocument(
    idToken,
    'settings/caixa',
    { value: newCashBalance, updatedAt: new Date().toISOString() },
    ['value', 'updatedAt'],
  );

  console.log(JSON.stringify({ ...summary, correctedId: target.id, newCashBalance }, null, 2));
};

run().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(JSON.stringify({ ok: false, message }, null, 2));
  process.exit(1);
});
