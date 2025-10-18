import React from 'react';
import ChatButton from './chatButom';

import default_user from '../icons/default_user.png'

const mockChats = [
  { id: 'chat-1', username: 'Laura Sánchez', avatarUrl: default_user },
  { id: 'chat-2', username: 'Equipo Marketing', avatarUrl: default_user },
  { id: 'chat-3', username: 'Carlos Rivera', avatarUrl: default_user },
  { id: 'chat-4', username: 'Design Squad', avatarUrl: default_user },
  { id: 'chat-5', username: 'Sofia Ortega', avatarUrl: default_user },
];

export const Chatsbar = ({ className = '' }) => {
  return (
    <aside className={`chats-bar ${className}`}>
      <h2 className="chats-bar__title">Chats recientes</h2>
      <div className="chats-bar__list">
        {mockChats.map((chat) => (
          <ChatButton key={chat.id} username={chat.username} avatarUrl={chat.avatarUrl} />
        ))}
      </div>
    </aside>
  );
};

export default Chatsbar;
