import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase';
import type { ResourceSubscription } from '../utils/realtimeResource';

export interface AccessControlState {
  loading: boolean;
  enforced: boolean;
  authorized: boolean;
  role?: string;
}
export const pendingAccess: AccessControlState = { loading: true, enforced: false, authorized: false };

export const accessControlSubscription = (uid: string): ResourceSubscription<AccessControlState> => (next, fail) => {
  let active = true;
  let userGeneration = 0;
  let stopUser = () => {};
  const stopSettings = onSnapshot(doc(db, 'settings', 'accessControl'), { includeMetadataChanges: true }, (snapshot) => {
    if (!active) return;
    const current = ++userGeneration;
    stopUser();
    stopUser = () => {};
    if (snapshot.metadata.fromCache) { next(pendingAccess, false); return; }
    const enforced = snapshot.exists() && snapshot.data().enforced === true;
    if (!enforced) {
      next({ loading: false, enforced: false, authorized: true });
      return;
    }
    next({ loading: true, enforced: true, authorized: false });
    stopUser = onSnapshot(doc(db, 'authorizedUsers', uid), { includeMetadataChanges: true }, (user) => {
      if (!active || current !== userGeneration) return;
      if (user.metadata.fromCache) { next({ loading: true, enforced: true, authorized: false }, false); return; }
      next({ loading: false, enforced: true, authorized: user.exists(),
        role: user.exists() ? String(user.data().role || 'USER') : undefined });
    }, (error) => { if (active && current === userGeneration) fail(error); });
  }, (error) => { if (active) { ++userGeneration; stopUser(); fail(error); } });
  return () => { active = false; ++userGeneration; stopUser(); stopSettings(); };
};
