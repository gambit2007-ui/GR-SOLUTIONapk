import { initializeApp, getApps } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getAuth, GoogleAuthProvider, signInWithPopup } from "firebase/auth";

const firebaseConfig = {
  apiKey: "AIzaSyBH1MWR7uSgcOF4WsrQnnkgPNpzdBkonxA",
  authDomain: "grsolution-8e6cb.firebaseapp.com",
  projectId: "grsolution-8e6cb",
  storageBucket: "grsolution-8e6cb.firebasestorage.app",
  messagingSenderId: "65708479471",
  appId: "1:65708479471:web:f9eff0ed0f59bd579b9c1a",
};

// evita reinicialização do firebase em hot reload
const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);

// serviços
export const db = getFirestore(app);
export const auth = getAuth(app);

// provider
const googleProvider = new GoogleAuthProvider();

// login google
export async function loginWithGoogle() {
  return signInWithPopup(auth, googleProvider);
}