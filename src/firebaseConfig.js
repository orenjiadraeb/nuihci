import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";

export const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT.firebaseapp.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId: "YOUR_APP_ID",
};

const hasConfig = Boolean(firebaseConfig.apiKey && !firebaseConfig.apiKey.includes("YOUR_API_KEY"));
const app = hasConfig ? initializeApp(firebaseConfig) : null;
export const db = hasConfig ? getFirestore(app) : null;
