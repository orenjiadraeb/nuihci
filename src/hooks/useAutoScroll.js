import { useEffect, useRef } from 'react';

/**
 * Custom hook for auto-scrolling to the latest message
 * @param {Array} messages - Array of messages to track
 * @param {boolean} enabled - Whether auto-scroll is enabled
 */
export const useAutoScroll = (messages, enabled = true) => {
  const messagesEndRef = useRef(null);
  const containerRef = useRef(null);

  const scrollToBottom = () => {
    if (messagesEndRef.current && enabled) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, enabled]);

  return { messagesEndRef, containerRef, scrollToBottom };
};
