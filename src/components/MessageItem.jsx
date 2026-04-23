import React from "react";

export default function MessageItem({ message, isOwn, onReply }) {
  const readableType = message.type === "image" ? "image" : message.type === "file" ? "file" : "text";
  const statusLabel = {
    sent: "Sent",
    delivered: "Delivered",
    seen: "Seen",
  }[message.status] || "";

  const renderContent = () => {
    if (message.type === "image") {
      return (
        <img
          className="message-image"
          src={message.url}
          alt={message.alt || `Image from ${message.sender}`}
        />
      );
    }

    if (message.type === "file") {
      return (
        <div className="message-file">
          <span>{message.filename || "Shared file"}</span>
          <a href={message.url} target="_blank" rel="noreferrer">
            Download
          </a>
        </div>
      );
    }

    return <p>{message.text}</p>;
  };

  return (
    <li className={`message-item ${isOwn ? "message-own" : "message-remote"}`}>
      <div className="message-header">
        <span className="message-sender">{message.sender}</span>
        <span className="message-time">{message.time}</span>
      </div>

      {message.replyTo && (
        <div className="message-reply-preview" aria-label={`Reply to ${message.replyTo.sender}`}>
          <span>{message.replyTo.sender}</span>
          <p>{message.replyTo.text}</p>
        </div>
      )}

      <div className={`message-bubble ${isOwn ? "own" : "remote"}`}>{renderContent()}</div>

      <div className="message-footer">
        {onReply ? (
          <button type="button" className="message-reply-btn" onClick={() => onReply(message)}>
            Reply
          </button>
        ) : null}
        <span className={`message-status ${message.status || ""}`}>{statusLabel}</span>
      </div>
    </li>
  );
}
