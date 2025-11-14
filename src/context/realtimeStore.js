import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useRealtime, useSession } from './sessionContext';
import { mergeMessageRecords, normalizeMessageRecord } from '../utils/messages';

const DEFAULT_BACKEND_BASE = 'http://127.0.0.1:8000';
const PRESENCE_POLL_INTERVAL_MS = 30000;

const normalizeBackendBase = (value) => {
  const base = (value || '').trim();
  if (!base) {
    return DEFAULT_BACKEND_BASE;
  }
  const withProtocol = /^https?:\/\//i.test(base) ? base : `http://${base}`;
  return withProtocol.replace(/\/+$/, '');
};

const defaultStore = {
  userStatusById: {},
  userStatusByUsername: {},
  userIdByUsername: {},
  usernameByUserId: {},
  trackUsernames: async () => undefined,
  resolveUserIdByUsername: async () => null,
  getStatusForUsername: () => null,
  getStatusForUserId: () => null,
};

const RealtimeStoreContext = createContext(defaultStore);

const toUserId = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

const toMessageKey = (message) => {
  if (!message || typeof message !== 'object') {
    return null;
  }
  const candidates = [
    message.message_id,
    message.id,
    message.uuid,
    message.client_uuid,
    message.clientId,
    message.local_id,
  ];
  const found = candidates.find((value) => value !== undefined && value !== null);
  if (found !== undefined && found !== null) {
    return `id:${String(found)}`;
  }
  const timestamp = message.created_at || message.createdAt || message.timestamp || message.sent_at;
  if (timestamp) {
    return `ts:${String(timestamp)}:${message.sender_id ?? message.senderId ?? ''}`;
  }
  if (message.content) {
    return `content:${String(message.content).slice(0, 32)}`;
  }
  return null;
};

const toMessageTimestamp = (message) => {
  if (!message || typeof message !== 'object') {
    return 0;
  }
  const raw =
    message.created_at ||
    message.createdAt ||
    message.sent_at ||
    message.timestamp ||
    message.createdAtMs;
  if (raw === undefined || raw === null) {
    return 0;
  }
  const numeric = Number(raw);
  if (Number.isFinite(numeric)) {
    return numeric;
  }
  const date = new Date(raw);
  const time = date.getTime();
  return Number.isNaN(time) ? 0 : time;
};

const mergeMessageArrays = (currentList = [], incomingList = []) => {
  const map = new Map();
  const append = (message) => {
    const normalized = normalizeMessageRecord(message);
    if (!normalized) {
      return;
    }
    const key = toMessageKey(normalized) || `tmp:${map.size + 1}`;
    const existing = map.get(key);
    if (existing) {
      map.set(key, mergeMessageRecords(existing, normalized));
    } else {
      map.set(key, normalized);
    }
  };
  (Array.isArray(currentList) ? currentList : []).forEach(append);
  (Array.isArray(incomingList) ? incomingList : []).forEach(append);
  const merged = Array.from(map.values());
  merged.sort((a, b) => toMessageTimestamp(a) - toMessageTimestamp(b));
  return merged;
};

export const RealtimeStoreProvider = ({ children }) => {
  const { jwt, browserUrl, userData } = useSession();
  const realtime = useRealtime();

  const [userIdByUsername, setUserIdByUsername] = useState({});
  const [usernameByUserId, setUsernameByUserId] = useState({});
  const [statusByUserId, setStatusByUserId] = useState({});
  const [messagesByChatId, setMessagesByChatId] = useState({});
  const [messagesMetaByChatId, setMessagesMetaByChatId] = useState({});
  const [unreadByChatId, setUnreadByChatId] = useState({});
  const [activeChatId, setActiveChatId] = useState(null);

  const userIdByUsernameRef = useRef(userIdByUsername);
  const usernameByUserIdRef = useRef(usernameByUserId);
  const statusByUserIdRef = useRef(statusByUserId);
  const messagesByChatIdRef = useRef(messagesByChatId);
  const unreadByChatIdRef = useRef(unreadByChatId);
  const activeChatIdRef = useRef(activeChatId);
  const trackedUserIdsRef = useRef(new Set());
  const pendingUsernameRequestsRef = useRef(new Map());
  const lastPollAtRef = useRef(0);

  const backendBaseUrl = useMemo(() => normalizeBackendBase(browserUrl), [browserUrl]);

  const currentUserId = useMemo(
    () => toUserId(userData?.user_id ?? userData?.id ?? userData?.iD),
    [userData]
  );

  useEffect(() => {
    userIdByUsernameRef.current = userIdByUsername;
  }, [userIdByUsername]);

  useEffect(() => {
    usernameByUserIdRef.current = usernameByUserId;
  }, [usernameByUserId]);

  useEffect(() => {
    statusByUserIdRef.current = statusByUserId;
  }, [statusByUserId]);

  useEffect(() => {
    messagesByChatIdRef.current = messagesByChatId;
  }, [messagesByChatId]);

  useEffect(() => {
    unreadByChatIdRef.current = unreadByChatId;
  }, [unreadByChatId]);

  useEffect(() => {
    activeChatIdRef.current = activeChatId;
  }, [activeChatId]);

  useEffect(() => {
    if (jwt) {
      return;
    }

    trackedUserIdsRef.current = new Set();
    setStatusByUserId({});
    setUserIdByUsername({});
    setUsernameByUserId({});
    setMessagesByChatId({});
    setMessagesMetaByChatId({});
    setUnreadByChatId({});
    setActiveChatId(null);
    messagesByChatIdRef.current = {};
    unreadByChatIdRef.current = {};
    activeChatIdRef.current = null;
    lastPollAtRef.current = 0;

    pendingUsernameRequestsRef.current.forEach((entry) => {
      try {
        entry?.controller?.abort();
      } catch (_) {
        /* ignore abort failures */
      }
    });
    pendingUsernameRequestsRef.current.clear();
  }, [jwt]);

  const addTrackedUserId = useCallback((userId) => {
    const numericId = toUserId(userId);
    if (!numericId) {
      return false;
    }
    const target = trackedUserIdsRef.current;
    if (target.has(numericId)) {
      return false;
    }
    target.add(numericId);
    return true;
  }, []);

  const updateStatusEntry = useCallback((userId, payload) => {
    const numericId = toUserId(userId);
    if (!numericId) {
      return;
    }
    const timestamp = Date.now();
    setStatusByUserId((previous) => ({
      ...previous,
      [numericId]: {
        ...previous[numericId],
        ...payload,
        user_id: numericId,
        receivedAt: timestamp,
      },
    }));
  }, []);

  const registerChatHistory = useCallback(
    (chatId, records, options = {}) => {
      if (chatId === null || chatId === undefined) {
        return;
      }
      const chatKey = String(chatId);
      const mode = options.mode || 'replace';
      const incomingList = Array.isArray(records) ? records : [];

      setMessagesByChatId((previous) => {
        const currentList = previous[chatKey] || [];
        let nextMessages;
        if (mode === 'prepend') {
          nextMessages = mergeMessageArrays(incomingList, currentList);
        } else if (mode === 'append') {
          nextMessages = mergeMessageArrays(currentList, incomingList);
        } else {
          nextMessages = mergeMessageArrays([], incomingList);
        }
        return {
          ...previous,
          [chatKey]: nextMessages,
        };
      });

      setMessagesMetaByChatId((previous) => {
        const existingMeta = previous[chatKey] || {};
        return {
          ...previous,
          [chatKey]: {
            ...existingMeta,
            hasMore: options.hasMore ?? existingMeta.hasMore ?? false,
            nextCursor: options.nextCursor ?? existingMeta.nextCursor ?? null,
            lastSyncedAt: Date.now(),
            isHydrated: true,
          },
        };
      });

      if (options.resetUnread) {
        setUnreadByChatId((previous) => {
          if (!previous[chatKey]) {
            return previous;
          }
          return {
            ...previous,
            [chatKey]: 0,
          };
        });
      }
    },
    []
  );

  // Multi-tab note:
  // Each browser tab maintains its own unread counters. When a live message arrives we
  // increment unread only if the chat is not active in the current tab. Other tabs
  // receive the same event and apply their own logic, so there is no cross-tab mutation.
  const pushLiveMessage = useCallback(
    (chatId, message, options = {}) => {
      if (chatId === null || chatId === undefined || !message) {
        return;
      }
      const chatKey = String(chatId);
      const senderId = toUserId(message.sender_id ?? message.senderId);
      const shouldIncrement =
        options.incrementUnread ??
        (activeChatIdRef.current !== chatKey && senderId !== currentUserId);

      setMessagesByChatId((previous) => {
        const currentList = previous[chatKey] || [];
        const nextMessages = mergeMessageArrays(currentList, [message]);
        return {
          ...previous,
          [chatKey]: nextMessages,
        };
      });

      setMessagesMetaByChatId((previous) => {
        const existing = previous[chatKey] || {};
        return {
          ...previous,
          [chatKey]: {
            ...existing,
            lastSyncedAt: Date.now(),
          },
        };
      });

      if (shouldIncrement) {
        setUnreadByChatId((previous) => ({
          ...previous,
          [chatKey]: (previous[chatKey] || 0) + 1,
        }));
      } else if (activeChatIdRef.current === chatKey) {
        setUnreadByChatId((previous) => {
          if (!previous[chatKey]) {
            return previous;
          }
          return {
            ...previous,
            [chatKey]: 0,
          };
        });
      }
    },
    [currentUserId]
  );

  const setActiveChat = useCallback((chatId) => {
    const chatKey =
      chatId === null || chatId === undefined ? null : String(chatId);

    setActiveChatId(chatKey);

    if (chatKey !== null) {
      setUnreadByChatId((previous) => {
        if (!previous[chatKey]) {
          return previous;
        }
        return {
          ...previous,
          [chatKey]: 0,
        };
      });
    }
  }, []);

  const markChatAsRead = useCallback((chatId) => {
    if (chatId === null || chatId === undefined) {
      return;
    }
    const chatKey = String(chatId);
    setUnreadByChatId((previous) => {
      if (!previous[chatKey]) {
        return previous;
      }
      return {
        ...previous,
        [chatKey]: 0,
      };
    });
  }, []);

  const getMessagesForChat = useCallback((chatId) => {
    if (chatId === null || chatId === undefined) {
      return [];
    }
    const chatKey = String(chatId);
    return messagesByChatIdRef.current[chatKey] || [];
  }, []);

  const getChatMeta = useCallback((chatId) => {
    if (chatId === null || chatId === undefined) {
      return null;
    }
    const chatKey = String(chatId);
    return (
      messagesMetaByChatId[chatKey] || {
        hasMore: false,
        nextCursor: null,
        isHydrated: false,
      }
    );
  }, [messagesMetaByChatId]);

  const fetchStatuses = useCallback(
    async (userIds) => {
      if (!jwt) {
        return;
      }

      const normalizedIds = Array.from(
        new Set(
          (Array.isArray(userIds) ? userIds : [userIds])
            .map((value) => toUserId(value))
            .filter(Boolean)
        )
      );

      if (normalizedIds.length === 0) {
        return;
      }

      try {
        const response = await fetch(
          `${backendBaseUrl}/users/status?ids=${encodeURIComponent(normalizedIds.join(','))}`,
          {
            method: 'GET',
            headers: {
              Accept: 'application/json',
              Authorization: `Bearer ${jwt}`,
            },
            credentials: 'include',
          }
        );

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        const payload = await response.json();
        const usersMap = payload?.users || {};
        const now = Date.now();

        setStatusByUserId((previous) => {
          const next = { ...previous };
          normalizedIds.forEach((id) => {
            const record =
              usersMap[id] ||
              usersMap[String(id)] ||
              usersMap?.[Number(id)];
            if (record) {
              next[id] = {
                ...next[id],
                ...record,
                user_id: id,
                receivedAt: now,
              };
            }
          });
          return next;
        });

        lastPollAtRef.current = now;
      } catch (error) {
        console.warn('No fue posible obtener el estado de usuarios:', error);
      }
    },
    [backendBaseUrl, jwt]
  );

  const resolveUserIdByUsername = useCallback(
    async (username) => {
      const normalized = (username || '').trim();
      if (!normalized || !jwt) {
        return null;
      }
      const key = normalized.toLowerCase();

      const cached = userIdByUsernameRef.current[key];
      if (cached) {
        return cached;
      }

      const pendingEntry = pendingUsernameRequestsRef.current.get(key);
      if (pendingEntry) {
        return pendingEntry.promise;
      }

      const controller = new AbortController();
      const promise = (async () => {
        try {
          const response = await fetch(
            `${backendBaseUrl}/auth/getUserInfo/${encodeURIComponent(normalized)}`,
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
            return null;
          }

          const data = await response.json();
          const userId =
            toUserId(data?.user_id) ||
            toUserId(data?.userId) ||
            toUserId(data?.iD);

          if (!userId) {
            return null;
          }

          setUserIdByUsername((previous) => {
            if (previous[key] === userId) {
              return previous;
            }
            return {
              ...previous,
              [key]: userId,
            };
          });

          setUsernameByUserId((previous) => {
            if (previous[userId] === (data?.username || normalized)) {
              return previous;
            }
            return {
              ...previous,
              [userId]: data?.username || normalized,
            };
          });

          return userId;
        } catch (error) {
          if (error?.name !== 'AbortError') {
            console.warn(`No fue posible resolver el usuario '${normalized}':`, error);
          }
          return null;
        } finally {
          pendingUsernameRequestsRef.current.delete(key);
        }
      })();

      pendingUsernameRequestsRef.current.set(key, { promise, controller });
      return promise;
    },
    [backendBaseUrl, jwt]
  );

  const trackUsernames = useCallback(
    async (usernames) => {
      if (!jwt || !Array.isArray(usernames) || usernames.length === 0) {
        return [];
      }

      const unique = Array.from(
        new Set(
          usernames
            .map((name) => (typeof name === 'string' ? name.trim() : ''))
            .filter(Boolean)
        )
      );

      const resolvedPromises = unique.map((name) => resolveUserIdByUsername(name));
      const resolved = await Promise.all(resolvedPromises);
      const newlyTracked = [];

      resolved.forEach((userId) => {
        if (!userId) {
          return;
        }
        if (addTrackedUserId(userId)) {
          newlyTracked.push(userId);
        }
      });

      if (newlyTracked.length > 0) {
        fetchStatuses(newlyTracked);
      }

      return resolved;
    },
    [addTrackedUserId, fetchStatuses, jwt, resolveUserIdByUsername]
  );

  useEffect(() => {
    if (!jwt) {
      return undefined;
    }
    if (typeof window === 'undefined' || typeof document === 'undefined') {
      return undefined;
    }

    const poll = () => {
      if (document.hidden) {
        return;
      }
      if (trackedUserIdsRef.current.size === 0) {
        return;
      }
      const ids = Array.from(trackedUserIdsRef.current);
      if (ids.length === 0) {
        return;
      }
      const now = Date.now();
      if (now - lastPollAtRef.current < PRESENCE_POLL_INTERVAL_MS / 2) {
        return;
      }
      fetchStatuses(ids);
    };

    poll();
    const intervalId = window.setInterval(poll, PRESENCE_POLL_INTERVAL_MS);
    const handleVisibility = () => {
      if (!document.hidden) {
        poll();
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [fetchStatuses, jwt]);

  useEffect(() => {
    if (!realtime?.subscribe) {
      return undefined;
    }
    const unsubPresence = realtime.subscribe('user.status', (event) => {
      const payload = event?.payload || {};
      const userId =
        toUserId(payload.user_id) ||
        toUserId(payload.userId);
      if (!userId) {
        return;
      }

      addTrackedUserId(userId);
      updateStatusEntry(userId, {
        status: payload.status || payload.state || 'unknown',
        last_seen: payload.last_seen || payload.lastSeen || null,
        connection_count: payload.connection_count ?? payload.connectionCount ?? null,
      });
    });

    const unsubConnection = realtime.subscribe('connection.open', () => {
      if (trackedUserIdsRef.current.size > 0) {
        fetchStatuses(Array.from(trackedUserIdsRef.current));
      }
    });

    const unsubChatMessage = realtime.subscribe('chat.message', (event) => {
      const payload = event?.payload || {};
      const rawMessage = payload.message || payload.data || payload;
      const chatId =
        payload.chat_id ??
        payload.chatId ??
        rawMessage?.chat_id ??
        rawMessage?.chatId;
      if (!chatId || !rawMessage) {
        return;
      }
      pushLiveMessage(chatId, rawMessage);
    });

    return () => {
      unsubPresence?.();
      unsubConnection?.();
      unsubChatMessage?.();
    };
  }, [addTrackedUserId, fetchStatuses, pushLiveMessage, realtime, updateStatusEntry]);

  const statusByUsername = useMemo(() => {
    const map = {};
    Object.entries(usernameByUserId).forEach(([userId, username]) => {
      if (!username) {
        return;
      }
      map[username] = statusByUserId[userId] || null;
    });
    return map;
  }, [statusByUserId, usernameByUserId]);

  const getStatusForUserId = useCallback(
    (userId) => {
      const numericId = toUserId(userId);
      if (!numericId) {
        return null;
      }
      return statusByUserIdRef.current[numericId] || null;
    },
    []
  );

  const getStatusForUsername = useCallback((username) => {
    const normalized = (username || '').trim().toLowerCase();
    if (!normalized) {
      return null;
    }
    const userId = userIdByUsernameRef.current[normalized];
    if (!userId) {
      return null;
    }
    return statusByUserIdRef.current[userId] || null;
  }, []);

  const value = useMemo(
    () => ({
      userStatusById: statusByUserId,
      userStatusByUsername: statusByUsername,
      userIdByUsername,
      usernameByUserId,
      trackUsernames,
      resolveUserIdByUsername,
      getStatusForUsername,
      getStatusForUserId,
      messagesByChatId,
      messagesMetaByChatId,
      unreadByChatId,
      activeChatId,
      registerChatHistory,
      setActiveChat,
      markChatAsRead,
      getMessagesForChat,
      getChatMeta,
    }),
    [
      activeChatId,
      getChatMeta,
      getMessagesForChat,
      getStatusForUserId,
      getStatusForUsername,
      markChatAsRead,
      messagesByChatId,
      messagesMetaByChatId,
      registerChatHistory,
      resolveUserIdByUsername,
      setActiveChat,
      statusByUserId,
      statusByUsername,
      trackUsernames,
      unreadByChatId,
      userIdByUsername,
      usernameByUserId,
    ]
  );

  return <RealtimeStoreContext.Provider value={value}>{children}</RealtimeStoreContext.Provider>;
};

export const useRealtimeStore = () => useContext(RealtimeStoreContext);
