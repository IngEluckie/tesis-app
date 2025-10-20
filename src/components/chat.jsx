// chat.jsx

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Navbar } from './chatLayout/navbar';
import { Chatsbar } from './chatLayout/chatsbar';
import { Chatbox } from './chatLayout/chatbox';
import { UserInfo } from './chatLayout/userInfo';
import { useSession } from '../context/sessionContext';
import { Settings } from './chatLayout/settings';
import { Dashito } from './chatLayout/dashito';

// Styles
import './chatLayout/chat-styles.css';

const DEFAULT_BACKEND_BASE = 'http://127.0.0.1:8000';
const DEFAULT_MESSAGES_LIMIT = 25;

const normalizeBackendBase = (value) => {
  const base = (value || '').trim();
  if (!base) {
    return DEFAULT_BACKEND_BASE;
  }
  const withProtocol = /^https?:\/\//i.test(base) ? base : `http://${base}`;
  return withProtocol.replace(/\/+$/, '');
};

const normalizeMessageRecord = (raw) => {
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  const messageId =
    raw.message_id ??
    raw.id ??
    raw.uuid ??
    raw.messageId ??
    raw.local_id ??
    null;

  return {
    ...raw,
    message_id: messageId,
  };
};

const extractNextCursor = (payload) => {
  if (!payload || typeof payload !== 'object') {
    return null;
  }
  if (payload.next_cursor !== undefined) {
    return payload.next_cursor;
  }
  if (payload.nextCursor !== undefined) {
    return payload.nextCursor;
  }
  if (payload.pagination && typeof payload.pagination === 'object') {
    const { next_cursor, nextCursor } = payload.pagination;
    if (next_cursor !== undefined) {
      return next_cursor;
    }
    if (nextCursor !== undefined) {
      return nextCursor;
    }
  }
  return null;
};

const extractHasMore = (payload) => {
  if (!payload || typeof payload !== 'object') {
    return false;
  }
  if (payload.has_more !== undefined) {
    return Boolean(payload.has_more);
  }
  if (payload.hasMore !== undefined) {
    return Boolean(payload.hasMore);
  }
  if (payload.pagination && typeof payload.pagination === 'object') {
    const { has_more, hasMore } = payload.pagination;
    if (has_more !== undefined) {
      return Boolean(has_more);
    }
    if (hasMore !== undefined) {
      return Boolean(hasMore);
    }
  }
  return Boolean(extractNextCursor(payload));
};

export const Chat = () => {
  const {
    browserUrl,
    jwt,
    connectWebsocket,
    websocket,
    websocketStatus,
    websocketLastMessage,
    sendWebsocketMessage,
  } = useSession();

  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [activeChat, setActiveChat] = useState(null);
  const [messages, setMessages] = useState([]);
  const [historyCursor, setHistoryCursor] = useState(null);
  const [historyError, setHistoryError] = useState(null);
  const [isHistoryLoading, setIsHistoryLoading] = useState(false);
  const [isHistoryLoadingMore, setIsHistoryLoadingMore] = useState(false);
  const [hasMoreHistory, setHasMoreHistory] = useState(false);

  const activeChatIdRef = useRef(null);
  const abortControllerRef = useRef(null);
  const joinedChatIdRef = useRef(null);

  const backendBaseUrl = useMemo(
    () => normalizeBackendBase(browserUrl),
    [browserUrl]
  );

  const resetHistoryState = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setMessages([]);
    setHistoryCursor(null);
    setHistoryError(null);
    setIsHistoryLoading(false);
    setIsHistoryLoadingMore(false);
    setHasMoreHistory(false);
  }, []);

  const fetchChatMessages = useCallback(
    async ({ chatId, cursor = null, mode = 'replace' } = {}) => {
      if (!jwt || !chatId) {
        return;
      }

      const isReplace = mode === 'replace';
      const isPrepend = mode === 'prepend';

      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }

      const controller = new AbortController();
      abortControllerRef.current = controller;

      if (isReplace) {
        setIsHistoryLoading(true);
        setHistoryError(null);
      } else if (isPrepend) {
        setIsHistoryLoadingMore(true);
      }

      try {
        const params = new URLSearchParams();
        params.set('limit', String(DEFAULT_MESSAGES_LIMIT));
        if (cursor) {
          params.set('cursor', String(cursor));
        }

        const response = await fetch(
          `${backendBaseUrl}/chats/get_chat/${encodeURIComponent(
            chatId
          )}?${params.toString()}`,
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

        const payload = await response.json().catch(() => ({}));

        if (!response.ok) {
          const detail =
            payload?.detail ||
            payload?.error ||
            `No se pudieron cargar los mensajes (HTTP ${response.status})`;
          throw new Error(detail);
        }

        const rawMessages = Array.isArray(payload?.messages)
          ? payload.messages
          : [];

        const normalizedMessages = rawMessages
          .map((item) => normalizeMessageRecord(item))
          .filter(Boolean)
          .sort((a, b) => {
            const aTs = new Date(a.created_at || a.createdAt || 0).getTime();
            const bTs = new Date(b.created_at || b.createdAt || 0).getTime();
            return aTs - bTs;
          });

        const nextCursor = extractNextCursor(payload);
        const hasMore = extractHasMore(payload);

        if (activeChatIdRef.current !== chatId) {
          return;
        }

        setMessages((prev) => {
          if (isReplace) {
            return normalizedMessages;
          }
          if (isPrepend) {
            const existingIds = new Set(prev.map((msg) => msg.message_id));
            const merged = normalizedMessages.filter(
              (msg) => !existingIds.has(msg.message_id)
            );
            return [...merged, ...prev];
          }
          const existingIds = new Set(prev.map((msg) => msg.message_id));
          const merged = normalizedMessages.filter(
            (msg) => !existingIds.has(msg.message_id)
          );
          return [...prev, ...merged];
        });

        setHistoryCursor(nextCursor);
        setHasMoreHistory(Boolean(hasMore));
      } catch (error) {
        if (controller.signal.aborted) {
          return;
        }
        if (activeChatIdRef.current === chatId) {
          setHistoryError(
            error?.message || 'No fue posible recuperar la conversación'
          );
        }
      } finally {
        if (abortControllerRef.current === controller) {
          abortControllerRef.current = null;
        }
        if (isReplace && activeChatIdRef.current === chatId) {
          setIsHistoryLoading(false);
        }
        if (mode === 'prepend' && activeChatIdRef.current === chatId) {
          setIsHistoryLoadingMore(false);
        }
      }
    },
    [backendBaseUrl, jwt]
  );

  const handleSelectChat = useCallback(
    (chat) => {
      if (!chat || !chat.id) {
        return;
      }
      activeChatIdRef.current = chat.id;
      setActiveChat(chat);
      resetHistoryState();
      fetchChatMessages({ chatId: chat.id, mode: 'replace' });
    },
    [fetchChatMessages, resetHistoryState]
  );

  const handleLoadOlderMessages = useCallback(() => {
    if (!activeChat || !historyCursor || isHistoryLoadingMore) {
      return;
    }
    fetchChatMessages({
      chatId: activeChat.id,
      cursor: historyCursor,
      mode: 'prepend',
    });
  }, [activeChat, fetchChatMessages, historyCursor, isHistoryLoadingMore]);

  const handleSendMessage = useCallback(
    async (content) => {
      if (!jwt || !activeChat || !activeChat.id || !content?.trim()) {
        return { ok: false, error: 'Mensaje no válido' };
      }

      try {
        const response = await fetch(
          `${backendBaseUrl}/chats/${encodeURIComponent(
            activeChat.id
          )}/send_message`,
          {
            method: 'POST',
            headers: {
              Accept: 'application/json',
              'Content-Type': 'application/json',
              Authorization: `Bearer ${jwt}`,
            },
            credentials: 'include',
            body: JSON.stringify({ content }),
          }
        );

        const payload = await response.json().catch(() => ({}));

        if (!response.ok) {
          const detail =
            payload?.detail ||
            payload?.error ||
            `No fue posible enviar el mensaje (HTTP ${response.status})`;
          throw new Error(detail);
        }

        const normalized = normalizeMessageRecord(payload);
        if (normalized && activeChatIdRef.current === activeChat.id) {
          setMessages((prev) => {
            const exists = prev.some(
              (msg) =>
                msg.message_id &&
                normalized.message_id &&
                msg.message_id === normalized.message_id
            );
            if (exists) {
              return prev;
            }
            return [...prev, normalized];
          });
        }

        return { ok: true };
      } catch (error) {
        return { ok: false, error: error?.message || 'Error al enviar mensaje' };
      }
    },
    [activeChat, backendBaseUrl, jwt]
  );

  useEffect(() => {
    if (jwt) {
      return;
    }
    activeChatIdRef.current = null;
    setActiveChat(null);
    resetHistoryState();
  }, [jwt, resetHistoryState]);

  useEffect(() => {
    if (!jwt) {
      return;
    }
    connectWebsocket().catch((error) => {
      console.warn('No fue posible iniciar el WebSocket:', error);
    });
  }, [connectWebsocket, jwt]);

  useEffect(() => {
    if (websocketStatus === 'open' || websocketStatus === 'connecting') {
      return;
    }
    joinedChatIdRef.current = null;
  }, [websocketStatus]);

  useEffect(() => {
    const socket = websocket;
    const chatIdRaw = activeChat?.id;

    if (!socket) {
      return undefined;
    }

    if (chatIdRaw === undefined || chatIdRaw === null) {
      const previousChatId = joinedChatIdRef.current;
      if (previousChatId !== null && socket.readyState === WebSocket.OPEN) {
        sendWebsocketMessage({ type: 'leave', chat_id: previousChatId });
        joinedChatIdRef.current = null;
      }
      return undefined;
    }

    const chatId = Number(chatIdRaw);
    if (!Number.isFinite(chatId)) {
      return undefined;
    }

    const leaveChat = (targetId) => {
      if (targetId === null || targetId === undefined) {
        return;
      }
      sendWebsocketMessage({ type: 'leave', chat_id: targetId });
      if (joinedChatIdRef.current === targetId) {
        joinedChatIdRef.current = null;
      }
    };

    const joinChat = () => {
      const success = sendWebsocketMessage({ type: 'join', chat_id: chatId });
      if (success) {
        joinedChatIdRef.current = chatId;
      }
      return success;
    };

    const openState =
      typeof window !== 'undefined' && window.WebSocket
        ? window.WebSocket.OPEN
        : 1;

    const ensureJoined = () => {
      const previousChatId = joinedChatIdRef.current;
      if (previousChatId !== null && previousChatId !== chatId) {
        leaveChat(previousChatId);
      }
      if (joinedChatIdRef.current !== chatId) {
        joinChat();
      }
    };

    if (socket.readyState === openState) {
      ensureJoined();
    } else {
      const handleOpen = () => {
        ensureJoined();
      };
      socket.addEventListener('open', handleOpen, { once: true });
      return () => {
        socket.removeEventListener('open', handleOpen);
        leaveChat(chatId);
      };
    }

    return () => {
      leaveChat(chatId);
    };
  }, [activeChat, sendWebsocketMessage, websocket]);

  useEffect(() => {
    if (!websocketLastMessage) {
      return;
    }

    let parsed;
    try {
      parsed =
        typeof websocketLastMessage === 'string'
          ? JSON.parse(websocketLastMessage)
          : websocketLastMessage;
    } catch (error) {
      console.warn('Mensaje WebSocket inválido:', websocketLastMessage);
      return;
    }

    const eventType =
      parsed?.type || parsed?.event || parsed?.action || parsed?.kind;

    if (eventType !== 'chat.message') {
      return;
    }

    const payload = parsed?.payload || parsed?.data || parsed?.message || {};
    const messageRecord = payload?.message || payload;
    const chatId = Number(
      messageRecord?.chat_id ?? payload?.chat_id ?? payload?.chatId
    );

    if (!activeChat || Number(activeChat.id) !== chatId) {
      return;
    }

    const normalized = normalizeMessageRecord(messageRecord);
    if (!normalized) {
      return;
    }

    setMessages((prev) => {
      const exists = prev.some(
        (msg) => msg.message_id && msg.message_id === normalized.message_id
      );
      if (exists) {
        return prev.map((msg) =>
          msg.message_id === normalized.message_id ? { ...msg, ...normalized } : msg
        );
      }
      return [...prev, normalized];
    });
  }, [activeChat, websocketLastMessage]);

  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      const leaveId = joinedChatIdRef.current;
      if (leaveId !== null) {
        sendWebsocketMessage({ type: 'leave', chat_id: leaveId });
        joinedChatIdRef.current = null;
      }
    };
  }, [sendWebsocketMessage]);

  return (
    <div className="chat-page">
      <div className="nava">
        <Navbar onOpenSettings={() => setIsSettingsOpen(true)} />
      </div>
      <div className="main-container">
        <Chatsbar className="chats-bar" onSelectChat={handleSelectChat} />
        {activeChat ? (
          <Chatbox
            key={activeChat.id}
            className="chatbox"
            chat={activeChat}
            messages={messages}
            isLoading={isHistoryLoading && messages.length === 0}
            isLoadingMore={isHistoryLoadingMore}
            hasMore={hasMoreHistory}
            error={historyError}
            onLoadMore={handleLoadOlderMessages}
            onSendMessage={handleSendMessage}
            websocketStatus={websocketStatus}
          />
        ) : (
          <Dashito className="chatbox" />
        )}
        <UserInfo className="user-info" />
      </div>
      <Settings
        className="settings-box"
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
      />
    </div>
  );
};
