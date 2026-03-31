import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  query,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import { db } from '../firebase';
import { Customer } from '../types';
import { sanitizeFirestorePayload } from '../utils/firestoreSanitizer';

export const createCustomer = async (cliente: Customer) => {
  const { id, ...payload } = cliente;
  await addDoc(
    collection(db, 'clientes'),
    sanitizeFirestorePayload({
      ...payload,
      createdAt: Date.now(),
    }),
  );
};

export const updateCustomer = async (cliente: Customer) => {
  const { id, ...payload } = cliente;
  await updateDoc(doc(db, 'clientes', id), sanitizeFirestorePayload(payload));
};

export const deleteCustomerAndLoans = async (customerId: string): Promise<number> => {
  const loansSnap = await getDocs(query(collection(db, 'loans'), where('customerId', '==', customerId)));
  const loanDocs = loansSnap.docs;

  const MAX_BATCH_SIZE = 450;
  let index = 0;

  while (index < loanDocs.length) {
    const batch = writeBatch(db);
    const slice = loanDocs.slice(index, index + MAX_BATCH_SIZE);
    slice.forEach((loanDoc) => batch.delete(doc(db, 'loans', loanDoc.id)));
    await batch.commit();
    index += MAX_BATCH_SIZE;
  }

  await deleteDoc(doc(db, 'clientes', customerId));
  return loanDocs.length;
};

