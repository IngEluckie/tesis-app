import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSession } from '../../context/sessionContext';

import defaultUser from '../icons/default_user.png';

const normalizeId = (value) => {
  if (value === undefined || value === null) {
    return null;
  }
  const numeric = Number(value);
  return Number.isNaN(numeric) ? String(value) : numeric;
};

const formatTime = (isoString) => {
  if (!isoString) {
    return '';
  }
  try {
    const date = new Date(isoString);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch (_) {
    return '';
  }
};

const scheduleMicrotask = (callback) => {
  if (typeof queueMicrotask === 'function') {
    queueMicrotask(callback);
    return;
  }
  Promise.resolve()
    .then(callback)
    .catch(() => {});
};

export const Chatbox = ({
  className = '',
  chat,
  messages = [],
  isLoading = false,
  isLoadingMore = false,
  hasMore = false,
  error = null,
  websocketStatus = 'idle',
  onLoadMore = () => {},
  onSendMessage = async () => ({ ok: false }),
}) => {
  const { userData } = useSession();
  const [composerValue, setComposerValue] = useState('');
  const [sendError, setSendError] = useState(null);
  const [isSending, setIsSending] = useState(false);

  const historyContainerRef = useRef(null);
  const lastMessageIdRef = useRef(null);
  const activeChatId = chat?.id ?? null;

  const currentUserId = useMemo(() => {
    if (!userData || typeof userData !== 'object') {
      return null;
    }
    return (
      normalizeId(userData.id) ??
      normalizeId(userData.user_id) ??
      normalizeId(userData.iD) ??
      null
    );
  }, [userData]);

  const sortedMessages = useMemo(() => {
    if (!Array.isArray(messages)) {
      return [];
    }
    return [...messages].sort((a, b) => {
      const aTs = new Date(a.created_at || a.createdAt || 0).getTime();
      const bTs = new Date(b.created_at || b.createdAt || 0).getTime();
      return aTs - bTs;
    });
  }, [messages]);

  const scrollHistoryToBottom = useCallback(
    (behavior = 'smooth') => {
      scheduleMicrotask(() => {
        const container = historyContainerRef.current;
        if (!container) {
          return;
        }

        const scrollBehavior = behavior === 'smooth' ? 'smooth' : 'auto';
        if (typeof container.scrollTo === 'function') {
          try {
            container.scrollTo({
              top: container.scrollHeight,
              behavior: scrollBehavior,
            });
            return;
          } catch (_) {
            // Ignorar y usar fallback.
          }
        }
        container.scrollTop = container.scrollHeight;
      });
    },
    []
  );

  useEffect(() => {
    if (!sortedMessages.length) {
      lastMessageIdRef.current = null;
      scheduleMicrotask(() => {
        const container = historyContainerRef.current;
        if (container) {
          container.scrollTop = container.scrollHeight;
        }
      });
      return;
    }
    const newestMessage =
      sortedMessages[sortedMessages.length - 1] || undefined;
    const newestId = newestMessage?.message_id ?? newestMessage?.id;

    if (!newestId || lastMessageIdRef.current === newestId) {
      return;
    }

    lastMessageIdRef.current = newestId;
    scrollHistoryToBottom('smooth');
  }, [scrollHistoryToBottom, sortedMessages]);

  useEffect(() => {
    if (!activeChatId) {
      return;
    }
    scrollHistoryToBottom('auto');
  }, [activeChatId, scrollHistoryToBottom]);

  const handleComposerChange = useCallback((event) => {
    setComposerValue(event.target.value);
  }, []);

  const handleSubmit = useCallback(
    async (event) => {
      event.preventDefault();
      const trimmed = composerValue.trim();
      if (!trimmed || isSending) {
        return;
      }

      setIsSending(true);
      setSendError(null);

      try {
        const result = await onSendMessage(trimmed);
        if (!result?.ok) {
          setSendError(result?.error || 'No se pudo enviar el mensaje');
        } else {
          setComposerValue('');
        }
      } catch (error) {
        setSendError(error?.message || 'No se pudo enviar el mensaje');
      } finally {
        setIsSending(false);
      }
    },
    [composerValue, isSending, onSendMessage]
  );

  const renderMessage = (message, index) => {
    const messageId = message.message_id ?? message.id;
    const senderId =
      normalizeId(message.user_id) ??
      normalizeId(message.sender_id) ??
      normalizeId(message.author_id);
    const isOwn = currentUserId !== null && senderId === currentUserId;
    const bubbleClass = isOwn ? 'chatbox__message--me' : 'chatbox__message--contact';

    return (
      <li
        key={messageId ?? `message-${index}`}
        className={`chatbox__message ${bubbleClass}`}
      >
        <span className="chatbox__bubble">
          {message.content || message.body || ''}
          <span className="chatbox__timestamp">{formatTime(message.created_at || message.createdAt)}</span>
        </span>
      </li>
    );
  };

  const renderHistory = () => {
    if (isLoading && !sortedMessages.length) {
      return <div className="chatbox__placeholder">Cargando conversación...</div>;
    }
    if (error && !sortedMessages.length) {
      return <div className="chatbox__error">{error}</div>;
    }
    if (!sortedMessages.length) {
      return <div className="chatbox__placeholder">Aún no hay mensajes. ¡Saluda!</div>;
    }
    return (
      <ul className="chatbox__messages">
        {hasMore && (
          <li className="chatbox__history-loader">
            <button
              type="button"
              className="chatbox__load-more"
              onClick={onLoadMore}
              disabled={isLoadingMore}
            >
              {isLoadingMore ? 'Cargando...' : 'Ver mensajes anteriores'}
            </button>
          </li>
        )}
        {error && (
          <li className="chatbox__history-error" role="alert">
            {error}
          </li>
        )}
        {sortedMessages.map((message, index) => renderMessage(message, index))}
      </ul>
    );
  };

  return (
    <section
      className={`chatbox ${className}`}
      aria-label={`Ventana de conversación con ${chat?.name || 'contacto'}`}
    >
      <header className="chatbox__header">
        <div className="chatbox__counterpart">
          <img
            className="chatbox__avatar"
            src={chat?.avatarUrl || defaultUser}
            alt={`Avatar de ${chat?.name || 'contacto'}`}
          />
          <div className="chatbox__meta">
            <span className="chatbox__name">{chat?.name || 'Chat'}</span>
            <span className="chatbox__status">
              {websocketStatus === 'open'
                ? 'Conectado'
                : websocketStatus === 'connecting'
                ? 'Conectando...'
                : websocketStatus === 'registering'
                ? 'Registrando...'
                : websocketStatus === 'error'
                ? 'Desconectado'
                : ''}
            </span>
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

      <div
        className="chatbox__history"
        role="log"
        ref={historyContainerRef}
      >
        {renderHistory()}
      </div>

      <form
        className="chatbox__composer"
        aria-label="Enviar mensaje"
        onSubmit={handleSubmit}
      >
        <button
          type="button"
          className="chatbox__action-btn chatbox__action-btn--clip"
          title="Adjuntar archivo"
          disabled
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
          value={composerValue}
          onChange={handleComposerChange}
          disabled={isSending}
        />
        <button
          type="submit"
          className="chatbox__action-btn chatbox__action-btn--send"
          title="Enviar mensaje"
          disabled={isSending || !composerValue.trim()}
        >
          <span aria-hidden="true">➤</span>
          <span className="sr-only">Enviar mensaje</span>
        </button>
      </form>
      {sendError && (
        <div className="chatbox__composer-error" role="alert">
          {sendError}
        </div>
      )}
    </section>
  );
};
