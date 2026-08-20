import {
  addDoc,
  collection,
  doc,
  getDocs,
  getCountFromServer,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from 'firebase/firestore';
import { db } from '../firebase';
import { Customer } from '../types';
import { sanitizeFirestorePayload } from '../utils/firestoreSanitizer';
import type { MovementActor } from './cashService';

export const createCustomer = async (cliente: Customer) => {
  const { id, ...payload } = cliente;
  await addDoc(
    collection(db, 'clientes'),
    sanitizeFirestorePayload({
      ...payload,
      archived: false,
      createdAt: Date.now(),
    }),
  );
};

export const updateCustomer = async (cliente: Customer) => {
  const { id, ...payload } = cliente;
  await updateDoc(doc(db, 'clientes', id), sanitizeFirestorePayload(payload));
};

export const getCustomerCount = async (): Promise<number> => {
  const [totalSnapshot, archivedSnapshot] = await Promise.all([
    getCountFromServer(collection(db, 'clientes')),
    getCountFromServer(query(collection(db, 'clientes'), where('archived', '==', true))),
  ]);
  return Math.max(0, totalSnapshot.data().count - archivedSnapshot.data().count);
};

export const archiveCustomer = async (customerId: string, actor?: MovementActor): Promise<void> => {
  const loansSnap = await getDocs(query(collection(db, 'loans'), where('customerId', '==', customerId)));
  if (!loansSnap.empty) throw new Error('CLIENTE_POSSUI_CONTRATOS');

  await updateDoc(doc(db, 'clientes', customerId), sanitizeFirestorePayload({
    archived: true,
    archivedAt: serverTimestamp(),
    archivedByUid: actor?.uid || undefined,
    archivedByEmail: actor?.email?.toLowerCase() || undefined,
    archivedByName: actor?.displayName || undefined,
  }));
};
