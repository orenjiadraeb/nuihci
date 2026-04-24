import { auth, db, storage, googleProvider } from "./firebaseConfig";
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signInWithPopup,
  signOut,
  sendEmailVerification,
  updateProfile,
} from "firebase/auth";
import {
  doc,
  setDoc,
  getDoc,
  updateDoc,
  deleteDoc,
  serverTimestamp,
  collection,
  addDoc,
  query,
  where,
  getDocs,
  onSnapshot,
  orderBy,
} from "firebase/firestore";
import { ref as storageRef, uploadBytes, getDownloadURL } from "firebase/storage";

export async function signInEmail(email, password) {
  return signInWithEmailAndPassword(auth, email, password);
}

export async function registerEmail(email, password, displayName) {
  const credential = await createUserWithEmailAndPassword(auth, email, password);
  await updateProfile(credential.user, { displayName });
  
  // Try to create Firestore profile, but handle permission errors gracefully
  try {
    await createUserProfile(credential.user, {
      displayName,
      email,
      createdAt: serverTimestamp(),
      emailVerified: false,
    });
  } catch (firestoreError) {
    console.log("Firestore profile creation failed (permissions):", firestoreError);
    // Continue anyway - user can still log in with Firebase Auth
  }
  
  await sendEmailVerification(credential.user);
  return credential;
}

export async function sendVerificationEmail(user) {
  if (!user) throw new Error("No user provided");
  return sendEmailVerification(user);
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

export async function getUserByUsername(username) {
  if (!username) return null;
  const usersRef = collection(db, "users");
  const q = query(usersRef, where("displayName", "==", username.toLowerCase()));
  const snapshot = await getDocs(q);
  if (snapshot.empty) return null;
  return snapshot.docs[0].data();
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

// Friend System Functions

export async function searchUsers(searchTerm) {
  if (!searchTerm) return [];
  const usersRef = collection(db, "users");
  const searchLower = searchTerm.toLowerCase();
  
  try {
    // Search by displayName
    const nameQuery = query(usersRef, where("displayName", ">=", searchLower), where("displayName", "<=", searchLower + "\uf8ff"));
    const nameSnapshot = await getDocs(nameQuery);
    const nameResults = nameSnapshot.docs.map(doc => ({ uid: doc.id, ...doc.data() }));
    
    // Search by email (exact match or starts with)
    const emailQuery = query(usersRef, where("email", ">=", searchLower), where("email", "<=", searchLower + "\uf8ff"));
    const emailSnapshot = await getDocs(emailQuery);
    const emailResults = emailSnapshot.docs.map(doc => ({ uid: doc.id, ...doc.data() }));
    
    // Merge and deduplicate results
    const allResults = [...nameResults, ...emailResults];
    const uniqueResults = allResults.filter((user, index, self) => 
      index === self.findIndex(u => u.uid === user.uid)
    );
    
    return uniqueResults;
  } catch (error) {
    console.log("Search failed (Firestore permissions):", error);
    // Return empty array but throw a specific error for the UI to handle
    throw new Error("Database permissions not configured. Please set Firestore rules.");
  }
}

export async function sendFriendRequest(fromUserId, fromUsername, toUserId) {
  if (!fromUserId || !toUserId) throw new Error("User IDs required");
  
  // Check if already friends
  const friendshipRef = doc(db, "friendships", `${fromUserId}_${toUserId}`);
  const friendshipSnap = await getDoc(friendshipRef);
  if (friendshipSnap.exists()) throw new Error("Already friends");
  
  // Check if request already exists
  const requestsRef = collection(db, "friendRequests");
  const existingQuery = query(requestsRef, where("fromUserId", "==", fromUserId), where("toUserId", "==", toUserId), where("status", "==", "pending"));
  const existingSnap = await getDocs(existingQuery);
  if (!existingSnap.empty) throw new Error("Friend request already sent");
  
  // Create friend request
  const requestRef = doc(collection(db, "friendRequests"));
  await setDoc(requestRef, {
    fromUserId,
    fromUsername,
    toUserId,
    status: "pending",
    createdAt: serverTimestamp(),
  });
  
  return requestRef.id;
}

export async function getFriendRequests(userId) {
  if (!userId) return [];
  const requestsRef = collection(db, "friendRequests");
  const q = query(requestsRef, where("toUserId", "==", userId), where("status", "==", "pending"));
  const snapshot = await getDocs(q);
  return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
}

export async function acceptFriendRequest(requestId) {
  const requestRef = doc(db, "friendRequests", requestId);
  const requestSnap = await getDoc(requestRef);
  if (!requestSnap.exists()) throw new Error("Request not found");
  
  const request = requestSnap.data();
  
  // Create bidirectional friendship
  const friendship1Ref = doc(db, "friendships", `${request.fromUserId}_${request.toUserId}`);
  const friendship2Ref = doc(db, "friendships", `${request.toUserId}_${request.fromUserId}`);
  
  await setDoc(friendship1Ref, {
    userId: request.fromUserId,
    friendId: request.toUserId,
    createdAt: serverTimestamp(),
  });
  
  await setDoc(friendship2Ref, {
    userId: request.toUserId,
    friendId: request.fromUserId,
    createdAt: serverTimestamp(),
  });
  
  // Update request status
  await updateDoc(requestRef, { status: "accepted", updatedAt: serverTimestamp() });
  
  return true;
}

export async function rejectFriendRequest(requestId) {
  const requestRef = doc(db, "friendRequests", requestId);
  await updateDoc(requestRef, { status: "rejected", updatedAt: serverTimestamp() });
  return true;
}

export async function getFriends(userId) {
  if (!userId) return [];
  const friendshipsRef = collection(db, "friendships");
  const q = query(friendshipsRef, where("userId", "==", userId));
  const snapshot = await getDocs(q);
  
  const friendIds = snapshot.docs.map(doc => doc.data().friendId);
  
  // Get friend profiles
  const friends = [];
  for (const friendId of friendIds) {
    const friendProfile = await getUserProfile(friendId);
    if (friendProfile) {
      friends.push({ ...friendProfile, uid: friendId });
    }
  }
  
  return friends;
}

export async function unfriend(userId, friendId) {
  if (!userId || !friendId) throw new Error("User IDs required");
  
  // Delete bidirectional friendship
  const friendship1Ref = doc(db, "friendships", `${userId}_${friendId}`);
  const friendship2Ref = doc(db, "friendships", `${friendId}_${userId}`);
  
  await deleteDoc(friendship1Ref);
  await deleteDoc(friendship2Ref);
  
  return true;
}

// Conversation Functions

export async function createConversation(conversation) {
  if (!conversation.id || !conversation.type) throw new Error("Invalid conversation");
  const convoRef = doc(db, "conversations", conversation.id);
  await setDoc(convoRef, {
    ...conversation,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return conversation.id;
}

export async function getConversations(userId) {
  if (!userId) return [];
  const conversationsRef = collection(db, "conversations");
  const q = query(conversationsRef, where("participants", "array-contains", userId));
  const snapshot = await getDocs(q);
  return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
}

export function listenToMessages(conversationId, callback) {
  if (!conversationId) return () => {};
  const messagesRef = collection(db, "conversations", conversationId, "messages");
  const q = query(messagesRef, orderBy("createdAt", "asc"));
  
  // First, fetch existing messages immediately
  getDocs(q).then(snapshot => {
    console.log("Initial fetch of messages, docs:", snapshot.docs.length);
    const messages = snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data(),
      createdAt: doc.data().createdAt?.toDate() || new Date(),
    }));
    console.log("Initial messages loaded:", messages);
    callback(messages);
  }).catch(error => {
    console.error("Initial message fetch error:", error);
  });
  
  // Then set up real-time listener for updates
  return onSnapshot(q, (snapshot) => {
    console.log("Firestore snapshot received, docs:", snapshot.docs.length);
    const messages = snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data(),
      createdAt: doc.data().createdAt?.toDate() || new Date(),
    }));
    console.log("Processed messages:", messages);
    callback(messages);
  }, (error) => {
    console.error("Message listener error:", error);
  });
}

export function listenToConversations(userId, callback) {
  if (!userId) return () => {};
  const conversationsRef = collection(db, "conversations");
  const q = query(conversationsRef, where("participants", "array-contains", userId));
  return onSnapshot(q, (snapshot) => {
    const conversations = snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data(),
      createdAt: doc.data().createdAt?.toDate() || new Date(),
      updatedAt: doc.data().updatedAt?.toDate() || new Date(),
    }));
    callback(conversations);
  });
}
