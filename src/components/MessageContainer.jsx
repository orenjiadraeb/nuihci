import React from 'react';
import { useAutoScroll } from '../hooks/useAutoScroll';

export const MessageContainer = ({ messages, isLoading }) => {
  const { messagesEndRef, containerRef } = useAutoScroll(messages);

  return (
    <div className="message-container" ref={containerRef}>
      <div className="message-container__messages">
        {messages && messages.length > 0 ? (
          messages.map((message, index) => (
            <div
              key={message.id || index}
              className={`message-container__message message-container__message--${message.sender}`}
            >
              <div className="message-container__message-content">
                {message.text}
              </div>
              <div className="message-container__message-time">
                {new Date(message.timestamp).toLocaleTimeString()}
              </div>
            </div>
          ))
        ) : (
          <div className="message-container__empty">
            {isLoading ? 'Loading messages...' : 'No messages yet. Start a conversation!'}
          </div>
        )}
        <div ref={messagesEndRef} className="message-container__scroll-anchor" />
      </div>
    </div>
  );
};
