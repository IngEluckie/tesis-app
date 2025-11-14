// chatButom.js

import React from 'react';

const ChatButton = ({
  username,
  avatarUrl,
  fallbackAvatarUrl = 'https://placehold.co/80x80?text=Chat',
  isLoadingAvatar = false,
  presenceStatus = null,
  presenceLabel = '',
  unreadCount = 0,
  className = '',
  ...buttonProps
}) => {
  const label = username || 'Chat';
  const imageSrc = avatarUrl || fallbackAvatarUrl;
  const presenceState =
    typeof presenceStatus === 'string' ? presenceStatus : presenceStatus?.status;

  let presenceClassName = 'chat-button__presence--offline';
  if (presenceState === 'connected') {
    presenceClassName = 'chat-button__presence--online';
  } else if (presenceState === 'away' || presenceState === 'idle') {
    presenceClassName = 'chat-button__presence--idle';
  }

  return (
    <button
      type="button"
      className={`chat-button ${className}`}
      title={label}
      aria-label={label}
      aria-busy={isLoadingAvatar ? 'true' : undefined}
      {...buttonProps}
    >
      <span className="chat-button__avatar-wrapper">
        <img
          src={imageSrc}
          alt={`${label} avatar`}
          className="chat-button__avatar"
        />
        {presenceStatus !== null && presenceStatus !== undefined ? (
          <span
            className={`chat-button__presence ${presenceClassName}`}
            role="status"
            aria-label={presenceLabel || (presenceState === 'connected' ? 'En línea' : 'Desconectado')}
            title={presenceLabel || undefined}
          />
        ) : null}
      </span>
      <span className="chat-button__username">{label}</span>
      {unreadCount > 0 ? (
        <span className="chat-button__unread" aria-label={`${unreadCount} mensajes sin leer`}>
          {unreadCount > 99 ? '99+' : unreadCount}
        </span>
      ) : null}
    </button>
  );
};

export default ChatButton;
