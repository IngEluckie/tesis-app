import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSession } from '../../context/sessionContext';
import { useRealtimeStore } from '../../context/realtimeStore';
import ChatButton from './chatButom';

import default_user from '../icons/default_user.png';
import { fetchAvatarBlob } from '../../services/avatarService';

const DEFAULT_BACKEND_BASE = 'http://127.0.0.1:8000';
const DEFAULT_PAGE_SIZE = 10;

const revokeObjectUrl = (url) => {
  if (!url) {
    return;
  }
  URL.revokeObjectURL(url);
};

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
      const isGroup = Boolean(entry.is_group);
      const contactUsername = (() => {
        if (isGroup) {
          return null;
        }
        const raw = typeof entry.chat_name === 'string' ? entry.chat_name.trim() : '';
        return raw || null;
      })();
      return {
        id: chatId,
        name: entry.chat_name || 'Chat sin nombre',
        isGroup,
        lastActivity: entry.last_activity || null,
        contactUsername,
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
  const { trackUsernames, getStatusForUsername, unreadByChatId } = useRealtimeStore();
  const [chats, setChats] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(true);

  const requestAbortRef = useRef(null);
  const avatarsRef = useRef({});
  const [avatars, setAvatars] = useState(() => {
    const initial = {};
    avatarsRef.current = initial;
    return initial;
  });
  const avatarAbortControllersRef = useRef(new Map());

  const updateAvatars = useCallback((updater) => {
    setAvatars((previous) => {
      const next = updater(previous);
      avatarsRef.current = next;
      return next;
    });
  }, []);

  useEffect(() => {
    if (jwt) {
      return;
    }
    avatarAbortControllersRef.current.forEach((controller) => {
      try {
        controller.abort();
      } catch (_) {
        // Ignore abort errors.
      }
    });
    avatarAbortControllersRef.current.clear();
    updateAvatars((previous) => {
      if (!previous || Object.keys(previous).length === 0) {
        return previous;
      }
      Object.values(previous).forEach((entry) => {
        if (entry?.objectUrl) {
          revokeObjectUrl(entry.objectUrl);
        }
      });
      return {};
    });
  }, [jwt, updateAvatars]);

  useEffect(() => {
    const controllersSnapshot = avatarAbortControllersRef.current;
    const avatarsSnapshot = avatarsRef.current;
    return () => {
      controllersSnapshot.forEach((controller) => {
        try {
          controller.abort();
        } catch (_) {
          // Ignore abort errors.
        }
      });
      controllersSnapshot.clear();
      Object.values(avatarsSnapshot).forEach((entry) => {
        if (entry?.objectUrl) {
          revokeObjectUrl(entry.objectUrl);
        }
      });
      avatarsRef.current = {};
      avatarAbortControllersRef.current = new Map();
    };
  }, []);

  const backendBaseUrl = useMemo(() => {
    const raw = (browserUrl || '').trim();
    const withProtocol = raw
      ? /^https?:\/\//i.test(raw)
        ? raw
        : `http://${raw}`
      : DEFAULT_BACKEND_BASE;
    return withProtocol.replace(/\/+$/, '');
  }, [browserUrl]);

  const formatPresenceLabel = useCallback((presence) => {
    if (!presence) {
      return 'Desconectado';
    }
    if (presence.status === 'connected') {
      if (Number(presence.connection_count) > 1) {
        return `En línea en ${presence.connection_count} dispositivos`;
      }
      return 'En línea';
    }
    if (presence.last_seen) {
      try {
        const lastSeenDate = new Date(presence.last_seen);
        if (!Number.isNaN(lastSeenDate.getTime())) {
          return `Últ. vez ${lastSeenDate.toLocaleString()}`;
        }
      } catch (error) {
        console.warn('No se pudo formatear last_seen:', error);
      }
    }
    return 'Desconectado';
  }, []);

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

  useEffect(() => {
    const usernames = chats
      .map((chat) => chat.contactUsername)
      .filter(Boolean);
    if (usernames.length === 0) {
      return;
    }
    trackUsernames(usernames);
  }, [chats, trackUsernames]);

  useEffect(() => {
    if (!jwt) {
      return;
    }

    const usernames = new Set();
    chats.forEach((chat) => {
      if (!chat || chat.isGroup) {
        return;
      }
      const raw = typeof chat.contactUsername === 'string' ? chat.contactUsername.trim() : '';
      if (raw) {
        usernames.add(raw);
      }
    });

    const storedKeys = Object.keys(avatarsRef.current || {});
    const keysToRemove = storedKeys.filter((key) => !usernames.has(key));
    if (keysToRemove.length > 0) {
      updateAvatars((previous) => {
        if (!previous) {
          return previous;
        }
        const next = { ...previous };
        keysToRemove.forEach((key) => {
          const pending = avatarAbortControllersRef.current.get(key);
          if (pending) {
            try {
              pending.abort();
            } catch (_) {
              // Ignore abort errors.
            }
            avatarAbortControllersRef.current.delete(key);
          }
          const entry = next[key];
          if (entry?.objectUrl) {
            revokeObjectUrl(entry.objectUrl);
          }
          delete next[key];
        });
        return next;
      });
    }

    usernames.forEach((username) => {
      const existingEntry = avatarsRef.current[username];
      if (existingEntry && (existingEntry.status === 'loaded' || existingEntry.status === 'not-found')) {
        return;
      }
      if (existingEntry && existingEntry.status === 'loading') {
        return;
      }

      const controller = new AbortController();
      avatarAbortControllersRef.current.set(username, controller);

      updateAvatars((previous) => ({
        ...previous,
        [username]: {
          url: previous?.[username]?.url ?? null,
          objectUrl: previous?.[username]?.objectUrl ?? null,
          status: 'loading',
        },
      }));

      fetchAvatarBlob({
        baseUrl: backendBaseUrl,
        jwt,
        username,
        signal: controller.signal,
      })
        .then((result) => {
          if (controller.signal.aborted) {
            return;
          }

          if (!result.ok) {
            updateAvatars((previous) => {
              const next = { ...previous };
              const entry = next[username];
              if (entry?.status === 'not-found') {
                return previous;
              }
              if (entry?.objectUrl) {
                revokeObjectUrl(entry.objectUrl);
              }
              next[username] = {
                url: null,
                objectUrl: null,
                status: 'not-found',
              };
              return next;
            });
            return;
          }

          const objectUrl = URL.createObjectURL(result.blob);
          updateAvatars((previous) => {
            const next = { ...previous };
            const entry = next[username];
            if (entry?.objectUrl && entry.objectUrl !== objectUrl) {
              revokeObjectUrl(entry.objectUrl);
            }
            next[username] = {
              url: objectUrl,
              objectUrl,
              status: 'loaded',
            };
            return next;
          });
        })
        .catch((error) => {
          if (error?.name === 'AbortError') {
            return;
          }
          updateAvatars((previous) => {
            const next = { ...previous };
            const entry = next[username];
            if (entry?.status === 'loaded') {
              return next;
            }
            next[username] = {
              url: entry?.url ?? null,
              objectUrl: entry?.objectUrl ?? null,
              status: 'error',
            };
            return next;
          });
        })
        .finally(() => {
          avatarAbortControllersRef.current.delete(username);
        });
    });
  }, [backendBaseUrl, chats, jwt, updateAvatars]);

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
    return chats.map((chat) => {
      const contactUsername = chat.contactUsername || null;
      const presence = contactUsername ? getStatusForUsername(contactUsername) : null;
      const presenceLabel = contactUsername ? formatPresenceLabel(presence) : 'Chat grupal';
      const unreadCount = unreadByChatId[String(chat.id)] || 0;

      return (
        <ChatButton
          key={chat.id}
          username={chat.name}
          avatarUrl={contactUsername ? avatars[contactUsername]?.url ?? null : null}
          fallbackAvatarUrl={default_user}
          isLoadingAvatar={
            contactUsername ? avatars[contactUsername]?.status === 'loading' : false
          }
          presenceStatus={presence}
          presenceLabel={presenceLabel}
          unreadCount={unreadCount}
          onClick={() => onSelectChat(chat)}
        />
      );
    });
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
