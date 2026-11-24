import { useMemo, useSyncExternalStore } from 'react';
import type { User } from 'firebase/auth';
import { accessControlSubscription, pendingAccess, type AccessControlState } from '../services/accessControlSubscription';
import { createRealtimeResource } from '../utils/realtimeResource';

export const useAccessControlState = (user: User | null): AccessControlState => {
  const uid = user?.uid;
  const resource = useMemo(() => createRealtimeResource(pendingAccess, Boolean(uid),
    accessControlSubscription(uid || '')), [uid]);
  const snapshot = useSyncExternalStore(resource.subscribe, resource.getSnapshot, resource.getSnapshot);
  if (snapshot.status === 'error') return { loading: false, enforced: true, authorized: false };
  return snapshot.status === 'ready' ? snapshot.data : pendingAccess;
};
