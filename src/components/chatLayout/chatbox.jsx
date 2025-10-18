import React from 'react';

import default_user from '../icons/default_user.png'

const mockConversation = [
  { id: 'msg-1', sender: 'contact', text: 'Hola!' },
  { id: 'msg-2', sender: 'me', text: '¿Qué tal?' },
  { id: 'msg-3', sender: 'contact', text: 'Todo bien por aquí, ¿y tú?' },
  { id: 'msg-4', sender: 'me', text: 'Excelente, disfrutando del buen clima.' },
];

export const Chatbox = ({ className = '' }) => {
  return (
    <section className={`chatbox ${className}`} aria-label="Ventana de conversación">
      <header className="chatbox__header">
        <div className="chatbox__counterpart">
          <img
            className="chatbox__avatar"
            src={default_user}
            alt="Avatar del contacto"
          />
          <div className="chatbox__meta">
            <span className="chatbox__name">username</span>
            <span className="chatbox__status">En línea hace 5 minutos</span>
          </div>
        </div>
        <button
          type="button"
          className="chatbox__info-btn"
          title="Ver información del contacto"
        >
          Info.
        </button>
      </header>

      <div className="chatbox__history">
        <ol className="chatbox__messages">
          {mockConversation.map((message) => (
            <li
              key={message.id}
              className={`chatbox__message chatbox__message--${message.sender}`}
            >
              <span className="chatbox__bubble">{message.text}</span>
            </li>
          ))}
        </ol>
      </div>

      <form className="chatbox__composer" aria-label="Enviar mensaje">
        <button
          type="button"
          className="chatbox__action-btn chatbox__action-btn--clip"
          title="Adjuntar archivo"
        >
          <span aria-hidden="true">📎</span>
          <span className="sr-only">Adjuntar archivo</span>
        </button>
        <label className="sr-only" htmlFor="chatbox-message">
          Escribe tu mensaje
        </label>
        <input
          id="chatbox-message"
          name="message"
          type="text"
          className="chatbox__input"
          placeholder="Escribe un mensaje..."
          autoComplete="off"
        />
        <button
          type="submit"
          className="chatbox__action-btn chatbox__action-btn--send"
          title="Enviar mensaje"
        >
          <span aria-hidden="true">➤</span>
          <span className="sr-only">Enviar mensaje</span>
        </button>
      </form>
    </section>
  );
};
    
