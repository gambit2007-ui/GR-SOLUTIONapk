import { doc, runTransaction, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase';

export const enableAccessControlForCurrentUser = async (uid: string): Promise<'ENABLED' | 'ALREADY_ENABLED'> => {
  const normalizedUid = String(uid || '').trim();
  if (!normalizedUid) throw new Error('USUARIO_INVALIDO');

  return runTransaction(db, async (tx) => {
    const accessControlRef = doc(db, 'settings', 'accessControl');
    const authorizedUserRef = doc(db, 'authorizedUsers', normalizedUid);
    const accessControlSnap = await tx.get(accessControlRef);
    const authorizedUserSnap = await tx.get(authorizedUserRef);

    if (accessControlSnap.exists() && accessControlSnap.data().enforced === true) {
      if (!authorizedUserSnap.exists()) throw new Error('ACESSO_JA_PROTEGIDO_POR_OUTRO_ADMIN');
      return 'ALREADY_ENABLED';
    }

    tx.set(authorizedUserRef, {
      uid: normalizedUid,
      role: 'ADMIN',
      createdAt: serverTimestamp(),
    }, { merge: true });
    tx.set(accessControlRef, {
      enforced: true,
      enabledByUid: normalizedUid,
      enabledAt: serverTimestamp(),
    });
    return 'ENABLED';
  });
};
