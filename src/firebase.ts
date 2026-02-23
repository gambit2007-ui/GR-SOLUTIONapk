import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyBH1MWR7uSgcOF4WsrQnnkgPNpzdBkonxA",
  authDomain: "grsolution-8e6cb.firebaseapp.com",
  projectId: "grsolution-8e6cb",
  storageBucket: "grsolution-8e6cb.firebasestorage.app",
  messagingSenderId: "65708479471",
  appId: "1:65708479471:web:b6196202e1bf1c269b9c1a"
};

const app = initializeApp(firebaseConfig);

export const db = getFirestore(app);