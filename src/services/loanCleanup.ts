import {
  doc,
  writeBatch,
  serverTimestamp,
} from 'firebase/firestore';
import { db } from '../firebase';
import { sanitizeFirestorePayload } from '../utils/firestoreSanitizer';

const MAX_BATCH_SIZE = 450;

export const deleteLoansAndLinkedMovements = async (loanIds: string[]) => {
  const uniqueLoanIds = Array.from(new Set(loanIds.filter(Boolean)));
  if (uniqueLoanIds.length === 0) {
    return { removedLoans: 0, removedMovements: 0 };
  }

  let index = 0;
  while (index < uniqueLoanIds.length) {
    const batch = writeBatch(db);
    uniqueLoanIds.slice(index, index + MAX_BATCH_SIZE).forEach((loanId) => {
      batch.set(
        doc(db, 'loans', loanId),
        sanitizeFirestorePayload({
          status: 'CANCELADO',
          archivedAt: serverTimestamp(),
          archiveReason: 'SAFE_DELETE',
        }),
        { merge: true },
      );
    });
    await batch.commit();
    index += MAX_BATCH_SIZE;
  }

  return {
    removedLoans: uniqueLoanIds.length,
    removedMovements: 0,
  };
};
