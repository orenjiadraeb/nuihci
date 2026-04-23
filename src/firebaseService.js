import { auth, db, storage, googleProvider } from "./firebaseConfig";
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signInWithPopup,
  signOut,
} from "firebase/auth";
import {
  doc,
  setDoc,
  getDoc,
  updateDoc,
  serverTimestamp,
  collection,
  addDoc,
} from "firebase/firestore";
import { ref as storageRef, uploadBytes, getDownloadURL } from "firebase/storage";

export async function signInEmail(email, password) {
  return signInWithEmailAndPassword(auth, email, password);
}

export async function registerEmail(email, password, displayName) {
  const credential = await createUserWithEmailAndPassword(auth, email, password);
  await createUserProfile(credential.user, {
    displayName,
    email,
    createdAt: serverTimestamp(),
  });
  return credential;
}

export async function signInWithGoogle() {
  const credential = await signInWithPopup(auth, googleProvider);
  await createUserProfile(credential.user, {
    displayName: credential.user.displayName || "Google User",
    email: credential.user.email || "",
    photoURL: credential.user.photoURL || "",
    createdAt: serverTimestamp(),
  });
  return credential;
}

export async function signOutUser() {
  return signOut(auth);
}

export async function createUserProfile(user, metadata = {}) {
  if (!user?.uid) {
    throw new Error("Invalid user object.");
  }
  const userRef = doc(db, "users", user.uid);
  await setDoc(
    userRef,
    {
      uid: user.uid,
      email: user.email || "",
      displayName: metadata.displayName || user.displayName || "Anonymous",
      photoURL: metadata.photoURL || user.photoURL || "",
      createdAt: metadata.createdAt || serverTimestamp(),
      updatedAt: metadata.updatedAt || serverTimestamp(),
      ...metadata,
    },
    { merge: true },
  );
  return userRef;
}

export async function getUserProfile(uid) {
  if (!uid) return null;
  const userRef = doc(db, "users", uid);
  const snapshot = await getDoc(userRef);
  return snapshot.exists() ? snapshot.data() : null;
}

export async function updateUserProfile(uid, data) {
  if (!uid) return null;
  const userRef = doc(db, "users", uid);
  await updateDoc(userRef, { ...data, updatedAt: serverTimestamp() });
  return getUserProfile(uid);
}

export async function uploadFile(uid, file) {
  if (!uid || !file) {
    throw new Error("Invalid upload request.");
  }
  const path = `uploads/${uid}/${Date.now()}_${file.name}`;
  const storagePath = storageRef(storage, path);
  await uploadBytes(storagePath, file);
  return getDownloadURL(storagePath);
}

export async function postMessage(conversationId, message) {
  if (!conversationId || !message) {
    throw new Error("Invalid message payload.");
  }
  const messagesRef = collection(db, "conversations", conversationId, "messages");
  return addDoc(messagesRef, {
    text: String(message.text || ""),
    senderId: message.senderId || null,
    senderName: message.senderName || "Unknown",
    type: message.type || "text",
    createdAt: serverTimestamp(),
    attachments: message.attachments || [],
    status: "sent",
  });
}

export async function setTypingIndicator(conversationId, userId, isTyping) {
  if (!conversationId || !userId) {
    throw new Error("Invalid typing state.");
  }
  const indicatorRef = doc(db, "typingIndicators", `${conversationId}_${userId}`);
  await setDoc(indicatorRef, {
    conversationId,
    userId,
    isTyping,
    updatedAt: serverTimestamp(),
  });
  return indicatorRef.id;
}
