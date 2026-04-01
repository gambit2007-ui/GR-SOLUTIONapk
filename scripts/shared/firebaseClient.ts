import { getApps, initializeApp } from 'firebase/app';
import { getAuth, signInWithEmailAndPassword } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import type { Firestore } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: 'AIzaSyBH1MWR7uSgcOF4WsrQnnkgPNpzdBkonxA',
  authDomain: 'grsolution-8e6cb.firebaseapp.com',
  projectId: 'grsolution-8e6cb',
  storageBucket: 'grsolution-8e6cb.firebasestorage.app',
  messagingSenderId: '65708479471',
  appId: '1:65708479471:web:f9eff0ed0f59bd579b9c1a',
};

export interface FirebaseScriptSession {
  db: Firestore;
  email: string;
  projectId: string;
}

export const createFirebaseScriptSession = async (): Promise<FirebaseScriptSession> => {
  const email = process.env.FIREBASE_EMAIL;
  const password = process.env.FIREBASE_PASSWORD;

  if (!email || !password) {
    throw new Error('Missing FIREBASE_EMAIL/FIREBASE_PASSWORD');
  }

  const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
  const auth = getAuth(app);
  const db = getFirestore(app);

  await signInWithEmailAndPassword(auth, email, password);

  return {
    db,
    email: email.toLowerCase(),
    projectId: firebaseConfig.projectId,
  };
};


