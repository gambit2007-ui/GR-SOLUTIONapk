import { useEffect, useState } from 'react';
import type { User } from 'firebase/auth';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase';

interface AccessControlState {
  loading: boolean;
  enforced: boolean;
  authorized: boolean;
  role?: string;
}

const initialState: AccessControlState = {
  loading: true,
  enforced: false,
  authorized: false,
};

export const useAccessControlState = (user: User | null): AccessControlState => {
  const [state, setState] = useState<AccessControlState>(initialState);

  useEffect(() => {
    if (!user) {
      setState(initialState);
      return;
    }

    let unsubscribeUser = () => {};
    const unsubscribeSettings = onSnapshot(
      doc(db, 'settings', 'accessControl'),
      (snapshot) => {
        unsubscribeUser();
        const enforced = snapshot.exists() && snapshot.data().enforced === true;
        if (!enforced) {
          setState({ loading: false, enforced: false, authorized: true });
          return;
        }

        setState((previous) => ({ ...previous, loading: true, enforced: true }));
        unsubscribeUser = onSnapshot(
          doc(db, 'authorizedUsers', user.uid),
          (userSnapshot) => {
            setState({
              loading: false,
              enforced: true,
              authorized: userSnapshot.exists(),
              role: userSnapshot.exists() ? String(userSnapshot.data().role || 'USER') : undefined,
            });
          },
          () => setState({ loading: false, enforced: true, authorized: false }),
        );
      },
      () => setState({ loading: false, enforced: true, authorized: false }),
    );

    return () => {
      unsubscribeUser();
      unsubscribeSettings();
    };
  }, [user]);

  return state;
};
