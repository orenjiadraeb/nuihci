import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";

const firebaseConfig = {
  apiKey: "AIzaSyBuSb49AgcFwcGdfYPdZUA7kZqQQguoRpU",
  authDomain: "nuihcitest.firebaseapp.com",
  projectId: "nuihcitest",
  storageBucket: "nuihcitest.firebasestorage.app",
  messagingSenderId: "46869266731",
  appId: "1:46869266731:web:07d191762265cd1f01456e",
  measurementId: "G-QXDDW1TQJ8"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const storage = getStorage(app);
const googleProvider = new GoogleAuthProvider();

export { auth, db, storage, googleProvider };
