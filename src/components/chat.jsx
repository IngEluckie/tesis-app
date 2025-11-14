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
import { useRealtime, useSession } from '../context/sessionContext';
import { Settings } from './chatLayout/settings';
import { Dashito } from './chatLayout/dashito';
import { useRealtimeStore } from '../context/realtimeStore';

// Styles
import './chatLayout/chat-styles.css';
import {
  mergeAttachmentLists,
  normalizeMessageRecord,
  toAttachmentId,
} from '../utils/messages';

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
    websocketStatus,
    sendWebsocketMessage,
  } = useSession();
  const realtime = useRealtime();
  const {
    registerChatHistory,
    setActiveChat: setActiveChatInStore,
    markChatAsRead,
    getChatMeta,
    messagesByChatId,
  } = useRealtimeStore();

  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [activeChat, setActiveChatState] = useState(null);
  const [historyError, setHistoryError] = useState(null);
  const [isHistoryLoading, setIsHistoryLoading] = useState(false);
  const [isHistoryLoadingMore, setIsHistoryLoadingMore] = useState(false);

  const activeChatIdRef = useRef(null);
  const abortControllerRef = useRef(null);
  const joinedChatIdRef = useRef(null);

  const backendBaseUrl = useMemo(
    () => normalizeBackendBase(browserUrl),
    [browserUrl]
  );

  const messages = useMemo(() => {
    if (!activeChat || !activeChat.id) {
      return [];
    }
    const chatKey = String(activeChat.id);
    return messagesByChatId[chatKey] || [];
  }, [activeChat, messagesByChatId]);

  const chatMeta = useMemo(() => {
    if (!activeChat || !activeChat.id) {
      return null;
    }
    return getChatMeta(activeChat.id);
  }, [activeChat, getChatMeta]);

  const realtimeStatus = realtime?.status || '';

  const resetHistoryState = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setHistoryError(null);
    setIsHistoryLoading(false);
    setIsHistoryLoadingMore(false);
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
          .filter(Boolean);

        const nextCursor = extractNextCursor(payload) ?? null;
        const hasMore = Boolean(extractHasMore(payload));

        registerChatHistory(chatId, normalizedMessages, {
          mode,
          hasMore,
          nextCursor,
        });

        if (isReplace && activeChatIdRef.current === chatId) {
          markChatAsRead(chatId);
        }
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
        if (isPrepend && activeChatIdRef.current === chatId) {
          setIsHistoryLoadingMore(false);
        }
      }
    },
    [backendBaseUrl, jwt, markChatAsRead, registerChatHistory]
  );

  const handleSelectChat = useCallback(
    (chat) => {
      if (!chat || !chat.id) {
        return;
      }
      activeChatIdRef.current = chat.id;
      setActiveChatState(chat);
      setActiveChatInStore(chat.id);
      markChatAsRead(chat.id);
      resetHistoryState();
      fetchChatMessages({ chatId: chat.id, mode: 'replace' });
    },
    [fetchChatMessages, markChatAsRead, resetHistoryState, setActiveChatInStore]
  );

  const handleOpenChatByUsername = useCallback(
    async (username) => {
      const target = (username || '').trim();
      if (!target || !jwt) {
        return;
      }

      const params = new URLSearchParams();
      params.set('limit', String(DEFAULT_MESSAGES_LIMIT));

      try {
        setHistoryError(null);

        const response = await fetch(
          `${backendBaseUrl}/chats/open_single_chat/${encodeURIComponent(
            target
          )}?${params.toString()}`,
          {
            method: 'GET',
            headers: {
              Accept: 'application/json',
              Authorization: `Bearer ${jwt}`,
            },
            credentials: 'include',
          }
        );

        const payload = await response.json().catch(() => ({}));

        if (!response.ok) {
          const detail =
            payload?.detail ||
            payload?.error ||
            `No fue posible abrir la conversación (HTTP ${response.status})`;
          throw new Error(detail);
        }

        const chatId = payload?.chat_id ?? payload?.chatId;
        if (!chatId) {
          throw new Error(
            'La respuesta del servidor no incluyó el identificador del chat.'
          );
        }

        handleSelectChat({
          id: chatId,
          name: target,
          isGroup: false,
          contactUsername: target,
        });
      } catch (error) {
        console.error('No se pudo abrir el chat individual:', error);
        setHistoryError(
          error?.message || 'No fue posible abrir la conversación'
        );
      }
    },
    [backendBaseUrl, handleSelectChat, jwt]
  );

  const handleLoadOlderMessages = useCallback(() => {
    if (!activeChat || isHistoryLoadingMore) {
      return;
    }
    const nextCursor = chatMeta?.nextCursor;
    const hasMore = chatMeta?.hasMore;
    if (!hasMore) {
      return;
    }
    if (!nextCursor) {
      return;
    }
    fetchChatMessages({
      chatId: activeChat.id,
      cursor: nextCursor,
      mode: 'prepend',
    });
  }, [activeChat, chatMeta, fetchChatMessages, isHistoryLoadingMore]);

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
        if (normalized) {
          registerChatHistory(activeChat.id, [normalized], {
            mode: 'append',
          });
          markChatAsRead(activeChat.id);
        }

        return { ok: true };
      } catch (error) {
        return { ok: false, error: error?.message || 'Error al enviar mensaje' };
      }
    },
    [activeChat, backendBaseUrl, jwt, markChatAsRead, registerChatHistory]
  );

  const handleUploadAttachment = useCallback(
    async (file) => {
      if (!jwt || !activeChat || !activeChat.id || !file) {
        return { ok: false, error: 'Archivo no válido' };
      }

      const formData = new FormData();
      formData.append('file', file);

      try {
        const response = await fetch(
          `${backendBaseUrl}/files/chats/${encodeURIComponent(
            activeChat.id
          )}/attachments`,
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${jwt}`,
            },
            credentials: 'include',
            body: formData,
          }
        );

        let payload = null;
        const contentType = response.headers.get('content-type') || '';

        if (contentType.includes('application/json')) {
          payload = await response.json().catch(() => ({}));
        } else {
          const text = await response.text().catch(() => '');
          try {
            payload = JSON.parse(text);
          } catch (_) {
            payload = { detail: text };
          }
        }

        if (!response.ok) {
          let errorMessage =
            payload?.detail ||
            payload?.error ||
            `No se pudo subir el archivo (HTTP ${response.status})`;
          if (response.status === 413) {
            errorMessage = 'El archivo excede el tamaño máximo permitido.';
          } else if (response.status === 400) {
            errorMessage =
              payload?.detail ||
              payload?.error ||
              'Formato de archivo no permitido.';
          }
          return { ok: false, error: errorMessage };
        }

        const messageRecord = payload?.message ?? payload;
        let normalized = normalizeMessageRecord(messageRecord);
        if (normalized && payload?.attachment) {
          normalized = {
            ...normalized,
            attachments: mergeAttachmentLists(normalized.attachments, [
              payload.attachment,
            ]),
          };
        }

        if (normalized) {
          registerChatHistory(activeChat.id, [normalized], {
            mode: 'append',
          });
          markChatAsRead(activeChat.id);
        }

        return { ok: true, message: normalized };
      } catch (error) {
        return {
          ok: false,
          error: error?.message || 'No se pudo subir el archivo.',
        };
      }
    },
    [activeChat, backendBaseUrl, jwt, markChatAsRead, registerChatHistory]
  );

  const handleDownloadAttachment = useCallback(
    async (attachment) => {
      if (!jwt || !attachment || typeof attachment !== 'object') {
        return { ok: false, error: 'Adjunto no disponible' };
      }

      const attachmentId = toAttachmentId(attachment);
      if (attachmentId === null || attachmentId === undefined) {
        return { ok: false, error: 'Adjunto no válido' };
      }

      if (typeof window === 'undefined') {
        return {
          ok: false,
          error: 'La descarga sólo está disponible en el navegador.',
        };
      }

      try {
        const response = await fetch(
          `${backendBaseUrl}/files/attachments/${encodeURIComponent(
            attachmentId
          )}/download`,
          {
            method: 'GET',
            headers: {
              Authorization: `Bearer ${jwt}`,
            },
            credentials: 'include',
          }
        );

        if (!response.ok) {
          const payload = await response.json().catch(() => ({}));
          const errorMessage =
            payload?.detail ||
            payload?.error ||
            `No fue posible descargar el archivo (HTTP ${response.status})`;
          return { ok: false, error: errorMessage };
        }

        const blob = await response.blob();
        const fileName =
          attachment.original_name ||
          attachment.file_name ||
          `archivo-${attachmentId}`;

        const blobUrl = window.URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = blobUrl;
        link.download = fileName;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        window.setTimeout(() => window.URL.revokeObjectURL(blobUrl), 0);

        return { ok: true };
      } catch (error) {
        return {
          ok: false,
          error:
            error?.message || 'No fue posible descargar el archivo en este momento.',
        };
      }
    },
    [backendBaseUrl, jwt]
  );

  useEffect(() => {
    if (jwt) {
      return;
    }
    activeChatIdRef.current = null;
    setActiveChatState(null);
    setActiveChatInStore(null);
    resetHistoryState();
  }, [jwt, resetHistoryState, setActiveChatInStore]);

  useEffect(() => {
    const chatIdRaw = activeChat?.id;

    const leaveChat = (targetId, options = {}) => {
      if (targetId === null || targetId === undefined) {
        return;
      }
      const payload = { type: 'leave', chat_id: targetId };
      if (realtime?.send) {
        realtime.send(payload, { enqueue: options.enqueue ?? false });
      } else {
        sendWebsocketMessage(payload);
      }
      if (joinedChatIdRef.current === targetId) {
        joinedChatIdRef.current = null;
      }
    };

    if (chatIdRaw === undefined || chatIdRaw === null) {
      if (joinedChatIdRef.current !== null) {
        leaveChat(joinedChatIdRef.current, { enqueue: false });
      }
      return undefined;
    }

    const chatId = Number(chatIdRaw);
    if (!Number.isFinite(chatId)) {
      return undefined;
    }

    const joinChat = () => {
      const payload = { type: 'join', chat_id: chatId };
      if (realtime?.send) {
        const result = realtime.send(payload);
        if (result?.ok || result?.queued) {
          joinedChatIdRef.current = chatId;
        }
      } else {
        const success = sendWebsocketMessage(payload);
        if (success) {
          joinedChatIdRef.current = chatId;
        }
      }
    };

    const previousChatId = joinedChatIdRef.current;
    if (previousChatId !== null && previousChatId !== chatId) {
      leaveChat(previousChatId, { enqueue: false });
    }

    if (
      realtimeStatus === 'open' ||
      websocketStatus === 'open'
    ) {
      joinChat();
    } else if (
      realtimeStatus !== 'registering' &&
      realtimeStatus !== 'connecting' &&
      realtimeStatus !== 'reconnecting' &&
      websocketStatus !== 'connecting'
    ) {
      connectWebsocket().catch((error) => {
        console.warn('No fue posible reconectar el WebSocket:', error);
      });
    }

    return () => {
      if (joinedChatIdRef.current === chatId) {
        leaveChat(chatId, { enqueue: false });
      }
    };
  }, [activeChat, connectWebsocket, realtime, realtimeStatus, sendWebsocketMessage, websocketStatus]);

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
        <Navbar
          onSearch={handleOpenChatByUsername}
          onOpenSettings={() => setIsSettingsOpen(true)}
        />
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
            hasMore={chatMeta?.hasMore ?? false}
            error={historyError}
            onLoadMore={handleLoadOlderMessages}
            onSendMessage={handleSendMessage}
            onUploadAttachment={handleUploadAttachment}
            onDownloadAttachment={handleDownloadAttachment}
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
