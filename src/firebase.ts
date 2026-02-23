import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getAnalytics } from "firebase/analytics";

const firebaseConfig = {
  apiKey: "AIzaSyBH1MWR7uSgcOF4WsrQnnkgPNpzdBkonxA",
  authDomain: "grsolution-8e6cb.firebaseapp.com",
  projectId: "grsolution-8e6cb",
  storageBucket: "grsolution-8e6cb.firebasestorage.app",
  messagingSenderId: "65708479471",
  appId: "1:65708479471:web:f9eff0ed0f59bd579b9c1a",
  measurementId: "G-Y7G3ZG6204"
};

// Inicializa o Firebase
const app = initializeApp(firebaseConfig);

// Inicializa os serviços e exporta
export const db = getFirestore(app);
export const analytics = typeof window !== "undefined" ? getAnalytics(app) : null;