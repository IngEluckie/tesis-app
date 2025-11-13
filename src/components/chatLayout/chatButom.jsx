// chatButom.js

import React from 'react';

const ChatButton = ({
  username,
  avatarUrl,
  fallbackAvatarUrl = 'https://placehold.co/80x80?text=Chat',
  isLoadingAvatar = false,
  className = '',
  ...buttonProps
}) => {
  const label = username || 'Chat';
  const imageSrc = avatarUrl || fallbackAvatarUrl;

  return (
    <button
      type="button"
      className={`chat-button ${className}`}
      title={label}
      aria-label={label}
      aria-busy={isLoadingAvatar ? 'true' : undefined}
      {...buttonProps}
    >
      <img
        src={imageSrc}
        alt={`${label} avatar`}
        className="chat-button__avatar"
      />
      <span className="chat-button__username">{label}</span>
    </button>
  );
};

export default ChatButton;
