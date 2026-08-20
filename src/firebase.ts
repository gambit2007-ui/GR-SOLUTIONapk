import { initializeApp, getApps } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getAuth } from "firebase/auth";
import { getStorage } from "firebase/storage";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || "AIzaSyBH1MWR7uSgcOF4WsrQnnkgPNpzdBkonxA",
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || "grsolution-8e6cb.firebaseapp.com",
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || "grsolution-8e6cb",
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || "grsolution-8e6cb.firebasestorage.app",
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || "65708479471",
  appId: import.meta.env.VITE_FIREBASE_APP_ID || "1:65708479471:web:f9eff0ed0f59bd579b9c1a",
};

if (import.meta.env.DEV && !import.meta.env.VITE_FIREBASE_PROJECT_ID) {
  console.warn('[Firebase] Ambiente local usando o projeto padrao. Configure .env.local para isolar os dados.');
}

// Evita reinicializacao do Firebase em hot reload
const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);

// Servicos
export const db = getFirestore(app);
export const auth = getAuth(app);
export const storage = getStorage(app);
export const storageAppspotFallback = getStorage(app, `gs://${firebaseConfig.projectId}.appspot.com`);
export const storageFirebasestorageFallback = getStorage(app, `gs://${firebaseConfig.projectId}.firebasestorage.app`);
