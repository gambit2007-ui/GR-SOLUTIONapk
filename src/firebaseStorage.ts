import { getStorage } from 'firebase/storage';
import { firebaseApp, firebaseProjectId } from './firebase';

export const storage = getStorage(firebaseApp);
export const storageAppspotFallback = getStorage(firebaseApp, `gs://${firebaseProjectId}.appspot.com`);
export const storageFirebasestorageFallback = getStorage(firebaseApp, `gs://${firebaseProjectId}.firebasestorage.app`);
