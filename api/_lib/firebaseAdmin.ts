import { applicationDefault, cert, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';

const initializeFirebaseAdmin = () => {
  if (getApps().length > 0) return getApps()[0];

  const projectId = String(process.env.FIREBASE_PROJECT_ID || process.env.VITE_FIREBASE_PROJECT_ID || '').trim();
  const clientEmail = String(process.env.FIREBASE_CLIENT_EMAIL || '').trim();
  const privateKey = String(process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n').trim();
  const storageBucket = String(
    process.env.FIREBASE_STORAGE_BUCKET
      || process.env.VITE_FIREBASE_STORAGE_BUCKET
      || (projectId ? `${projectId}.firebasestorage.app` : ''),
  ).trim();

  if (projectId && clientEmail && privateKey) {
    return initializeApp({
      credential: cert({ projectId, clientEmail, privateKey }),
      projectId,
      storageBucket: storageBucket || undefined,
    });
  }

  return initializeApp({
    credential: applicationDefault(),
    projectId: projectId || undefined,
    storageBucket: storageBucket || undefined,
  });
};

export const firebaseAdminApp = initializeFirebaseAdmin();
export const adminAuth = getAuth(firebaseAdminApp);
export const adminDb = getFirestore(firebaseAdminApp);
export const adminStorage = getStorage(firebaseAdminApp);
