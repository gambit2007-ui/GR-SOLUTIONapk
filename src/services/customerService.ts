import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  query,
  updateDoc,
  where,
} from 'firebase/firestore';
import { db } from '../firebase';
import { Customer } from '../types';
import { sanitizeFirestorePayload } from '../utils/firestoreSanitizer';
import { deleteLoansAndLinkedMovements } from './loanCleanup';

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
  const loanIds = loansSnap.docs.map((loanDoc) => loanDoc.id);

  await deleteLoansAndLinkedMovements(loanIds);

  await deleteDoc(doc(db, 'clientes', customerId));
  return loanIds.length;
};
