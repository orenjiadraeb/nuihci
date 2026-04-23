import React from "react";

export default function ConversationList({
  conversations,
  activeConversationId,
  onConversationSelect,
  onlineStatuses,
  typingUsers,
}) {
  return (
    <aside className="conversation-list card" aria-label="Conversation list">
      <h3>Conversations</h3>
      <ul className="conversation-list-items">
        {conversations.map((conversation) => {
          const lastMessage = conversation.messages?.[conversation.messages.length - 1] ?? {};
          const otherParticipant = conversation.participants?.find((participant) => participant !== "You") || "You";
          const online = onlineStatuses?.[otherParticipant] || "Offline";
          const isTyping = typingUsers?.includes(otherParticipant);

          return (
            <li
              key={conversation.id}
              className={`conversation-item${conversation.id === activeConversationId ? " active" : ""}`}
            >
              <button
                type="button"
                className="conversation-select"
                onClick={() => onConversationSelect(conversation.id)}
                aria-current={conversation.id === activeConversationId ? "true" : "false"}
              >
                <div className="conversation-title-row">
                  <span className="conversation-title">{conversation.title}</span>
                  <span className="conversation-time">{lastMessage.time || "—"}</span>
                </div>
                <div className="conversation-preview">
                  <span className="conversation-snippet">
                    {lastMessage.text || lastMessage.filename || "No messages yet."}
                  </span>
                  <span className={`status-pill ${online.toLowerCase()}`}>{online}</span>
                </div>
                {isTyping ? <div className="typing-badge">Typing…</div> : null}
              </button>
            </li>
          );
        })}
      </ul>
    </aside>
  );
}
