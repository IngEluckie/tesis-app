import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSession } from '../../context/sessionContext';
import ChatButton from './chatButom';

import default_user from '../icons/default_user.png';

const DEFAULT_BACKEND_BASE = 'http://127.0.0.1:8000';
const DEFAULT_PAGE_SIZE = 10;

const normalizeChatsPayload = (payload) => {
  if (!payload || typeof payload !== 'object') {
    return [];
  }

  const entries = Array.isArray(payload.chats) ? payload.chats : [];
  return entries
    .map((entry) => {
      if (!entry || typeof entry !== 'object') {
        return null;
      }
      const chatId = entry.chat_id ?? entry.id;
      if (chatId === undefined || chatId === null) {
        return null;
      }
      return {
        id: chatId,
        name: entry.chat_name || 'Chat sin nombre',
        isGroup: Boolean(entry.is_group),
        lastActivity: entry.last_activity || null,
      };
    })
    .filter(Boolean);
};

export const Chatsbar = ({
  className = '',
  pageSize = DEFAULT_PAGE_SIZE,
  onSelectChat = () => {},
}) => {
  const { jwt, browserUrl } = useSession();
  const [chats, setChats] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(true);

  const requestAbortRef = useRef(null);

  const backendBaseUrl = useMemo(() => {
    const raw = (browserUrl || '').trim();
    const withProtocol = raw
      ? /^https?:\/\//i.test(raw)
        ? raw
        : `http://${raw}`
      : DEFAULT_BACKEND_BASE;
    return withProtocol.replace(/\/+$/, '');
  }, [browserUrl]);

  const fetchChats = useCallback(
    async ({ append = false, startOffset = 0 } = {}) => {
      if (!jwt) {
        setChats([]);
        setHasMore(false);
        setError(null);
        return;
      }

      if (requestAbortRef.current) {
        requestAbortRef.current.abort();
      }

      const controller = new AbortController();
      requestAbortRef.current = controller;
      setIsLoading(true);
      setError(null);

      try {
        const response = await fetch(
          `${backendBaseUrl}/chats/my_chats?limit=${encodeURIComponent(pageSize)}&offset=${encodeURIComponent(
            startOffset
          )}`,
          {
            method: 'GET',
            headers: {
              Accept: 'application/json',
              Authorization: `Bearer ${jwt}`,
            },
            credentials: 'include',
            signal: controller.signal,
          }
        );

        if (!response.ok) {
          let message = `No se pudieron obtener los chats (HTTP ${response.status})`;
          try {
            const errorPayload = await response.json();
            message = errorPayload?.detail || errorPayload?.error || message;
          } catch (readError) {
            console.warn('No se pudo leer el cuerpo de error de chats:', readError);
          }
          throw new Error(message);
        }

        const payload = await response.json();
        const normalized = normalizeChatsPayload(payload);

        setChats((prev) => (append ? [...prev, ...normalized] : normalized));
        setOffset(startOffset + normalized.length);
        setHasMore(normalized.length >= pageSize);
      } catch (requestError) {
        if (requestError.name === 'AbortError') {
          return;
        }
        console.error('Error recuperando chats:', requestError);
        setError(requestError?.message || 'No fue posible cargar tus chats');
        setHasMore(false);
      } finally {
        if (requestAbortRef.current === controller) {
          requestAbortRef.current = null;
        }
        setIsLoading(false);
      }
    },
    [backendBaseUrl, jwt, pageSize]
  );

  useEffect(() => {
    setChats([]);
    setOffset(0);
    setHasMore(true);
    setError(null);

    if (!jwt) {
      return undefined;
    }

    fetchChats({ append: false, startOffset: 0 });

    return () => {
      if (requestAbortRef.current) {
        requestAbortRef.current.abort();
        requestAbortRef.current = null;
      }
    };
  }, [fetchChats, jwt]);

  const handleLoadMore = useCallback(() => {
    if (isLoading || !hasMore) {
      return;
    }
    fetchChats({ append: true, startOffset: offset });
  }, [fetchChats, hasMore, isLoading, offset]);

  const renderContent = () => {
    if (!jwt) {
      return <div className="chats-bar__placeholder">Inicia sesión para ver tus chats.</div>;
    }
    if (isLoading && chats.length === 0) {
      return <div className="chats-bar__placeholder">Cargando chats...</div>;
    }
    if (error && chats.length === 0) {
      return <div className="chats-bar__error">{error}</div>;
    }
    if (chats.length === 0) {
      return <div className="chats-bar__placeholder">Aún no hay conversaciones recientes.</div>;
    }
    return chats.map((chat) => (
      <ChatButton
        key={chat.id}
        username={chat.name}
        avatarUrl={default_user}
        onClick={() => onSelectChat(chat)}
      />
    ));
  };

  return (
    <aside className={`chats-bar ${className}`}>
      <h2 className="chats-bar__title">Chats recientes</h2>
      <div className="chats-bar__list">{renderContent()}</div>
      {hasMore && chats.length > 0 && (
        <button
          type="button"
          className="chats-bar__load-more"
          onClick={handleLoadMore}
          disabled={isLoading}
        >
          {isLoading ? 'Cargando...' : 'Ver más'}
        </button>
      )}
      {error && chats.length > 0 && <div className="chats-bar__error">{error}</div>}
    </aside>
  );
};

export default Chatsbar;
