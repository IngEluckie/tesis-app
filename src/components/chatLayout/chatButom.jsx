// chatButom.js

import React from 'react';

const ChatButton = ({
  username,
  avatarUrl,
  fallbackAvatarUrl = 'https://placehold.co/80x80?text=Chat',
  className = '',
  ...buttonProps
}) => {
  const imageSrc = avatarUrl || fallbackAvatarUrl;

  return (
    <button
      type="button"
      className={`chat-button ${className}`}
      {...buttonProps}
    >
      <img
        src={imageSrc}
        alt={`${username} avatar`}
        className="chat-button__avatar"
      />
      <span className="chat-button__username">{username}</span>
    </button>
  );
};

export default ChatButton;
