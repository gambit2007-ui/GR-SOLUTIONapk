import fs from 'node:fs/promises';
import { initializeApp, getApps } from 'firebase/app';
import { getAuth, signInWithEmailAndPassword } from 'firebase/auth';
import { getFirestore, doc, writeBatch, serverTimestamp } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: 'AIzaSyBH1MWR7uSgcOF4WsrQnnkgPNpzdBkonxA',
  authDomain: 'grsolution-8e6cb.firebaseapp.com',
  projectId: 'grsolution-8e6cb',
  storageBucket: 'grsolution-8e6cb.firebasestorage.app',
  messagingSenderId: '65708479471',
  appId: '1:65708479471:web:f9eff0ed0f59bd579b9c1a',
};

const inputPath = process.argv[2] ?? 'output/spreadsheet/gr-import.json';
const email = process.env.FIREBASE_EMAIL;
const password = process.env.FIREBASE_PASSWORD;

if (!email || !password) {
  console.error('Missing FIREBASE_EMAIL/FIREBASE_PASSWORD');
  process.exit(1);
}

const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const raw = await fs.readFile(inputPath, 'utf8');
const payload = JSON.parse(raw.replace(/^\uFEFF/, '')); 

await signInWithEmailAndPassword(auth, email, password);

const customers = Array.isArray(payload.customers) ? payload.customers : [];
const loans = Array.isArray(payload.loans) ? payload.loans : [];
const caixa = Number(payload?.settings?.caixa ?? 0);

const operations = [];
for (const c of customers) {
  operations.push({ type: 'customer', id: c.id, data: c });
}
for (const l of loans) {
  operations.push({ type: 'loan', id: l.id, data: l });
}
operations.push({
  type: 'settings',
  id: 'caixa',
  data: { value: caixa, updatedAt: serverTimestamp() },
});

const CHUNK = 450;
let total = 0;
for (let i = 0; i < operations.length; i += CHUNK) {
  const slice = operations.slice(i, i + CHUNK);
  const batch = writeBatch(db);

  for (const op of slice) {
    if (op.type === 'customer') {
      batch.set(doc(db, 'clientes', op.id), op.data, { merge: true });
    } else if (op.type === 'loan') {
      batch.set(doc(db, 'loans', op.id), op.data, { merge: true });
    } else {
      batch.set(doc(db, 'settings', op.id), op.data, { merge: true });
    }
  }

  await batch.commit();
  total += slice.length;
}

console.log(`Imported ${customers.length} customers, ${loans.length} loans, and caixa=${caixa}.`);
console.log(`Total write operations: ${total}`);


