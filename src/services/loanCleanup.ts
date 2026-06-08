import {
  collection,
  doc,
  getDocs,
  query,
  where,
  writeBatch,
  type DocumentReference,
} from 'firebase/firestore';
import { db } from '../firebase';
import { recalculateCashBalance } from './cashService';

const MAX_BATCH_SIZE = 450;

const deleteRefsInBatches = async (refs: DocumentReference[]) => {
  let index = 0;
  while (index < refs.length) {
    const batch = writeBatch(db);
    refs.slice(index, index + MAX_BATCH_SIZE).forEach((ref) => batch.delete(ref));
    await batch.commit();
    index += MAX_BATCH_SIZE;
  }
};

export const deleteLoansAndLinkedMovements = async (loanIds: string[]) => {
  const uniqueLoanIds = Array.from(new Set(loanIds.filter(Boolean)));
  if (uniqueLoanIds.length === 0) {
    return { removedLoans: 0, removedMovements: 0 };
  }

  const movementRefsById = new Map<string, DocumentReference>();
  for (const loanId of uniqueLoanIds) {
    const movementSnap = await getDocs(query(collection(db, 'cashMovement'), where('loanId', '==', loanId)));
    movementSnap.docs.forEach((movementDoc) => {
      movementRefsById.set(movementDoc.id, movementDoc.ref);
    });
  }

  const loanRefs = uniqueLoanIds.map((loanId) => doc(db, 'loans', loanId));
  const refsToDelete = [...loanRefs, ...movementRefsById.values()];

  await deleteRefsInBatches(refsToDelete);
  await recalculateCashBalance();

  return {
    removedLoans: uniqueLoanIds.length,
    removedMovements: movementRefsById.size,
  };
};
