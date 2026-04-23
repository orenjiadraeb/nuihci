import * as functions from "firebase-functions";
import admin from "firebase-admin";
import express from "express";
import cors from "cors";

admin.initializeApp();
const db = admin.firestore();
const messaging = admin.messaging();
const app = express();
app.use(cors({ origin: true }));
app.use(express.json());

app.post("/users", async (req, res) => {
  try {
    const { email, password, displayName } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: "Email and password are required." });
    }

    const userRecord = await admin.auth().createUser({ email, password, displayName });
    await db.collection("users").doc(userRecord.uid).set({
      uid: userRecord.uid,
      email: userRecord.email,
      displayName: userRecord.displayName || "Anonymous",
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    return res.status(201).json({ uid: userRecord.uid, email: userRecord.email });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

app.get("/users/:uid", async (req, res) => {
  try {
    const { uid } = req.params;
    const snapshot = await db.collection("users").doc(uid).get();
    if (!snapshot.exists) {
      return res.status(404).json({ error: "User not found." });
    }
    return res.json(snapshot.data());
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

app.put("/users/:uid", async (req, res) => {
  try {
    const { uid } = req.params;
    const updates = req.body;
    await db.collection("users").doc(uid).update({
      ...updates,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    const updated = await db.collection("users").doc(uid).get();
    return res.json(updated.data());
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

app.delete("/users/:uid", async (req, res) => {
  try {
    const { uid } = req.params;
    await admin.auth().deleteUser(uid);
    await db.collection("users").doc(uid).delete();
    return res.json({ success: true });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

app.post("/notifications", async (req, res) => {
  try {
    const { token, title, body, data } = req.body;
    if (!token || !title || !body) {
      return res.status(400).json({ error: "token, title, and body are required." });
    }

    const message = {
      token,
      notification: {
        title,
        body,
      },
      data: data || {},
    };

    const response = await messaging.send(message);
    return res.json({ success: true, response });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

export const api = functions.https.onRequest(app);

export const onMessageCreate = functions.firestore
  .document("conversations/{conversationId}/messages/{messageId}")
  .onCreate(async (snapshot, context) => {
    const message = snapshot.data();
    const conversationId = context.params.conversationId;
    const conversation = await db.collection("conversations").doc(conversationId).get();

    if (!conversation.exists) {
      return null;
    }

    const participants = conversation.data().participants || [];
    const payload = {
      notification: {
        title: `New message in ${conversation.data().title || "conversation"}`,
        body: `${message.senderName}: ${message.text}`,
      },
      data: {
        conversationId,
        senderId: message.senderId || "",
      },
    };

    const tokensSnapshot = await db.collection("fcmTokens").where("uid", "in", participants).get();
    const tokens = tokensSnapshot.docs.map((doc) => doc.data().token).filter(Boolean);
    if (tokens.length === 0) {
      return null;
    }

    return messaging.sendMulticast({ tokens, ...payload });
  });
