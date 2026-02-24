import { initializeApp } from "firebase/app";
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

const app = initializeApp(firebaseConfig);

export const db = getFirestore(app);
export const auth = getAuth(app);

export async function loginWithGoogle() {
  const provider = new GoogleAuthProvider();
  return signInWithPopup(auth, provider);
}