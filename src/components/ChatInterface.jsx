import { useEffect, useRef, useState } from "react";
import {
  collection,
  doc,
  query,
  orderBy,
  onSnapshot,
  addDoc,
  deleteDoc,
  setDoc,
  serverTimestamp,
} from "firebase/firestore";
import { db } from "../firebaseConfig.js";
import ConversationList from "./ConversationList.jsx";
import MessageItem from "./MessageItem.jsx";

export default function ChatInterface({
  currentUserName,
  conversations,
  activeConversation,
  activeConversationId,
  onConversationSelect,
  chatMessage,
  setChatMessage,
  sendMessage,
  newGroupName,
  setNewGroupName,
  createGroupChat,
  setStatus,
  setConversations,
}) {
  const [typingUsers, setTypingUsers] = useState([]);
  const [onlineStatuses, setOnlineStatuses] = useState({ Ava: "Online", Noah: "Away", Mia: "Offline" });
  const [replyTarget, setReplyTarget] = useState(null);
  const [uploadError, setUploadError] = useState("");
  const firestoreEnabled = Boolean(db);
  const typingTimeoutRef = useRef(null);
  const userName = currentUserName || "You";

  const activeChat = activeConversation ?? conversations.find((conversation) => conversation.id === activeConversationId);

  useEffect(() => {
    if (!firestoreEnabled) return undefined;

    const conversationQuery = query(collection(db, "conversations"), orderBy("updatedAt", "desc"));
    const unsubscribe = onSnapshot(conversationQuery, (snapshot) => {
      setConversations((current) => {
        const currentMap = new Map(current.map((conversation) => [conversation.id, conversation]));
        snapshot.docs.forEach((docSnap) => {
          currentMap.set(docSnap.id, { id: docSnap.id, ...docSnap.data() });
        });
        return Array.from(currentMap.values());
      });
    });

    return unsubscribe;
  }, [firestoreEnabled, setConversations]);

  useEffect(() => {
    if (!firestoreEnabled || !activeChat?.id) return undefined;

    const messagesRef = collection(db, "conversations", activeChat.id, "messages");
    const messagesQuery = query(messagesRef, orderBy("timestamp", "asc"));

    const unsubscribe = onSnapshot(messagesQuery, (snapshot) => {
      const remoteMessages = snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));

      setConversations((current) =>
        current.map((conversation) => {
          if (conversation.id !== activeChat.id) return conversation;

          const merged = new Map();
          (conversation.messages || []).forEach((message) => merged.set(message.id, message));
          remoteMessages.forEach((message) => merged.set(message.id, message));

          return {
            ...conversation,
            messages: Array.from(merged.values()).sort((a, b) => {
              const aTs = a.timestamp?.seconds ?? a.localTime ?? 0;
              const bTs = b.timestamp?.seconds ?? b.localTime ?? 0;
              return aTs - bTs;
            }),
          };
        }),
      );
    });

    return unsubscribe;
  }, [firestoreEnabled, activeChat?.id, setConversations]);

  const handleTypingState = async (typing) => {
    if (!firestoreEnabled) return;

    const typingRef = doc(db, "typingIndicators", userName);
    try {
      if (typing) {
        await setDoc(
          typingRef,
          {
            userName,
            lastActive: serverTimestamp(),
          },
          { merge: true },
        );
      } else {
        await deleteDoc(typingRef);
      }
    } catch (error) {
      // ignore network failures
    }
  };

  useEffect(() => {
    if (!firestoreEnabled) return undefined;

    const typingRef = collection(db, "typingIndicators");
    const unsubscribe = onSnapshot(typingRef, (snapshot) => {
      setTypingUsers(snapshot.docs.map((docSnap) => docSnap.data().userName || ""));
    });

    const presenceRef = collection(db, "presence");
    const presenceUnsubscribe = onSnapshot(presenceRef, (snapshot) => {
      const statuses = {};
      snapshot.docs.forEach((docSnap) => {
        statuses[docSnap.id] = docSnap.data().status || "Offline";
      });
      setOnlineStatuses(statuses);
    });

    return () => {
      unsubscribe();
      presenceUnsubscribe();
    };
  }, [firestoreEnabled]);

  useEffect(() => {
    if (!firestoreEnabled) return undefined;

    const presenceRef = doc(db, "presence", userName);
    const setPresence = async (status) => {
      try {
        await setDoc(
          presenceRef,
          {
            userName,
            status,
            updatedAt: serverTimestamp(),
          },
          { merge: true },
        );
      } catch (error) {
        // ignore write issues
      }
    };

    setPresence("Online");

    return () => {
      window.clearTimeout(typingTimeoutRef.current);
      handleTypingState(false);
      setPresence("Offline");
    };
  }, [firestoreEnabled, userName]);

  const handleChatChange = (value) => {
    setChatMessage(value);
    if (!firestoreEnabled) return;

    handleTypingState(true);
    window.clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = window.setTimeout(() => {
      handleTypingState(false);
    }, 1400);
  };

  const handleSend = async () => {
    const text = (chatMessage || "").trim();
    if (!text || !activeChat) return;

    const messageId = `${activeChat.id}-${Date.now()}`;
    const timestamp = new Date().toLocaleTimeString();
    const messagePayload = {
      id: messageId,
      sender: "You",
      type: "text",
      text,
      time: timestamp,
      localTime: Date.now(),
      status: "sent",
      replyTo: replyTarget
        ? { sender: replyTarget.sender, text: replyTarget.text }
        : undefined,
    };

    sendMessage();
    setReplyTarget(null);
    setUploadError("");
    setStatus("Sending message...");

    if (!firestoreEnabled) {
      setStatus("Offline mode: message queued locally.");
      handleTypingState(false);
      return;
    }

    try {
      const conversationRef = doc(db, "conversations", activeChat.id);
      await setDoc(
        conversationRef,
        {
          id: activeChat.id,
          title: activeChat.title,
          participants: activeChat.participants,
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      );

      const messagesRef = collection(conversationRef, "messages");
      await addDoc(messagesRef, {
        ...messagePayload,
        timestamp: serverTimestamp(),
      });

      setStatus("Message delivered.");
      handleTypingState(false);
    } catch (error) {
      setStatus("Unable to sync message to Firestore.");
    }
  };

  const handleFileUpload = async (event) => {
    const file = event.target.files?.[0];
    if (!file || !activeChat) return;

    const messageId = `${activeChat.id}-${Date.now()}`;
    const timestamp = new Date().toLocaleTimeString();
    const isImage = file.type.startsWith("image/");
    const newMessage = {
      id: messageId,
      sender: "You",
      type: isImage ? "image" : "file",
      time: timestamp,
      status: "sent",
      localTime: Date.now(),
      url: URL.createObjectURL(file),
      alt: file.name,
      filename: file.name,
    };

    setConversations((current) =>
      current.map((conversation) =>
        conversation.id === activeChat.id
          ? { ...conversation, messages: [...(conversation.messages || []), newMessage] }
          : conversation,
      ),
    );

    if (!firestoreEnabled) {
      setStatus("File message queued locally.");
      return;
    }

    try {
      const conversationRef = doc(db, "conversations", activeChat.id);
      await setDoc(
        conversationRef,
        {
          id: activeChat.id,
          title: activeChat.title,
          participants: activeChat.participants,
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      );

      const messagesRef = collection(conversationRef, "messages");
      await addDoc(messagesRef, {
        ...newMessage,
        url: file.name,
        timestamp: serverTimestamp(),
      });
      setStatus("File message sent.");
    } catch (error) {
      setUploadError("Unable to sync file metadata to Firestore.");
      setStatus("File queued locally.");
    }
  };

  return (
    <section className="card chat-pane chat-interface" aria-label="Chat interface">
      <div className="chat-interface-sidebar">
        <div className="chat-interface-header">
          <h3>Chatbox</h3>
          <p className="muted">Real-time messaging with typing and presence.</p>
        </div>
        <ConversationList
          conversations={conversations}
          activeConversationId={activeConversationId}
          onConversationSelect={onConversationSelect}
          onlineStatuses={onlineStatuses}
          typingUsers={typingUsers}
        />
      </div>

      <div className="messages-panel">
        <div className="messages-panel-header">
          <div>
            <h4>{activeChat?.title || "Select a conversation"}</h4>
            <p className="muted">
              {activeChat?.participants?.join(", ")} • {firestoreEnabled ? "Firestore sync enabled" : "Local preview only"}
            </p>
          </div>
          <div className="typing-indicator" aria-live="polite">
            {typingUsers.length > 0 ? `${typingUsers.join(", ")} typing…` : ""}
          </div>
        </div>

        <ul className="list messages-list" aria-label="Conversation messages">
          {activeChat?.messages?.length ? (
            activeChat.messages.map((message) => (
              <MessageItem
                key={message.id}
                message={message}
                isOwn={message.sender === "You"}
                onReply={setReplyTarget}
              />
            ))
          ) : (
            <li className="message-empty">No messages yet. Start the conversation.</li>
          )}
        </ul>

        {replyTarget ? (
          <div className="reply-bar" aria-live="assertive">
            Replying to <strong>{replyTarget.sender}</strong>: {replyTarget.text}
            <button type="button" className="small-btn" onClick={() => setReplyTarget(null)}>
              Cancel
            </button>
          </div>
        ) : null}

        {uploadError ? <p className="error-text">{uploadError}</p> : null}

        <div className="message-actions">
          <div className="chat-input-row">
            <input
              type="text"
              value={chatMessage}
              onChange={(e) => handleChatChange(e.target.value)}
              placeholder="Type a new message"
              aria-label="Type a new message"
            />
            <button type="button" className="send-button" onClick={handleSend}>
              Send
            </button>
          </div>

          <div className="chat-upload-actions">
            <label className="upload-button">
              Attach file
              <input type="file" accept="image/*,.pdf,.doc,.txt" onChange={handleFileUpload} className="file-input" />
            </label>
            <div className="inline-input small-gap">
              <input
                type="text"
                value={newGroupName}
                onChange={(e) => setNewGroupName(e.target.value)}
                placeholder="Create a group chat"
                aria-label="Create a group chat"
              />
              <button type="button" onClick={createGroupChat}>
                Create Group
              </button>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
