import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

const defaultRealtimeContext = {
  status: 'idle',
  isOnline: false,
  lastError: null,
  lastEvent: null,
  queueLength: 0,
  latency: null,
  lastHeartbeatAt: null,
  ensureConnection: async () => null,
  disconnect: () => {},
  send: () => ({ ok: false, queued: false, error: 'not-initialized' }),
  subscribe: () => () => {},
};

export const RealtimeContext = createContext(defaultRealtimeContext);

const defaultSession = {
  browserUrl: '',
  setBrowserUrl: () => {},
  jwt: '',
  setJwt: () => {},
  userData: null,
  setUserData: () => {},
  isSessionReady: false,
  websocket: null,
  websocketStatus: 'idle',
  websocketError: null,
  websocketLastMessage: null,
  websocketRegistration: null,
  connectWebsocket: async () => null,
  disconnectWebsocket: () => {},
  sendWebsocketMessage: () => false,
  realtime: defaultRealtimeContext,
};

export const SessionContext = createContext(defaultSession);

const storage = typeof window !== 'undefined' ? window.localStorage : undefined;

const DEFAULT_BACKEND_BASE = 'http://127.0.0.1:8000';

const normalizeBackendBase = (value) => {
  const base = (value || '').trim();
  const withProtocol = base
    ? /^https?:\/\//i.test(base)
      ? base
      : `http://${base}`
    : DEFAULT_BACKEND_BASE;
  return withProtocol.replace(/\/+$/, '');
};

const toWebSocketBase = (httpBase) => {
  if (httpBase.startsWith('https://')) {
    return `wss://${httpBase.slice('https://'.length)}`;
  }
  if (httpBase.startsWith('http://')) {
    return `ws://${httpBase.slice('http://'.length)}`;
  }
  return httpBase;
};

const buildWebSocketUrl = (httpBase, token) =>
  `${toWebSocketBase(httpBase)}/websockets/connection?token=${encodeURIComponent(token)}`;

const WEBSOCKET_READY_STATE = {
  CONNECTING: 0,
  OPEN: 1,
  CLOSING: 2,
  CLOSED: 3,
};

const HEARTBEAT_INTERVAL_MS = 20000;
const HEARTBEAT_TIMEOUT_MS = 10000;
const RECONNECT_INITIAL_DELAY_MS = 1000;
const RECONNECT_MAX_DELAY_MS = 30000;
const MAX_OFFLINE_QUEUE = 100;

const toSocketMessage = (payload) => {
  if (typeof payload === 'string') {
    return payload;
  }
  try {
    return JSON.stringify(payload);
  } catch (error) {
    console.warn('No se pudo serializar el payload de WebSocket:', error);
    return null;
  }
};

const readUserData = () => {
  if (!storage) {
    return null;
  }
  const stored = storage.getItem('userdata');
  if (!stored) {
    return null;
  }
  try {
    return JSON.parse(stored);
  } catch (error) {
    console.warn('Failed to parse userdata from localStorage:', error);
    return null;
  }
};

export const SessionProvider = ({ children }) => {
  const [browserUrl, setBrowserUrlState] = useState(() => (storage?.getItem('browser_url') || ''));
  const [jwt, setJwtState] = useState(() => (storage?.getItem('jwt') || ''));
  const [userData, setUserDataState] = useState(() => readUserData());
  const [isSessionReady, setSessionReady] = useState(false);

  const [websocket, setWebsocket] = useState(null);
  const [websocketStatus, setWebsocketStatus] = useState('idle');
  const [websocketError, setWebsocketError] = useState(null);
  const [websocketLastMessage, setWebsocketLastMessage] = useState(null);
  const [websocketRegistration, setWebsocketRegistration] = useState(null);
  const [realtimeInfo, setRealtimeInfo] = useState({
    status: 'idle',
    isOnline: false,
    lastError: null,
    lastEvent: null,
    queueLength: 0,
    latency: null,
    lastHeartbeatAt: null,
  });

  const websocketRef = useRef(null);
  const websocketConnectingRef = useRef(false);
  const websocketAttemptRef = useRef(0);
  const reconnectAttemptsRef = useRef(0);
  const isMountedRef = useRef(true);
  const jwtRef = useRef(jwt);
  const avatarObjectUrlRef = useRef(null);
  const eventListenersRef = useRef(new Map());
  const offlineQueueRef = useRef([]);
  const reconnectTimeoutRef = useRef(null);
  const heartbeatIntervalRef = useRef(null);
  const heartbeatTimeoutRef = useRef(null);
  const lastPingTimestampRef = useRef(null);
  const manualDisconnectRef = useRef(false);
  const browserUrlRef = useRef(browserUrl);

  useEffect(() => {
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    return () => {
      const currentUrl = avatarObjectUrlRef.current;
      if (!currentUrl || typeof URL === 'undefined' || typeof URL.revokeObjectURL !== 'function') {
        return;
      }
      try {
        URL.revokeObjectURL(currentUrl);
      } catch (error) {
        console.warn('Failed to revoke avatar URL during cleanup:', error);
      }
      avatarObjectUrlRef.current = null;
    };
  }, []);

  const setBrowserUrl = useCallback((value) => {
    if (!storage) {
      setBrowserUrlState(value || '');
      return;
    }
    if (value) {
      storage.setItem('browser_url', value);
    } else {
      storage.removeItem('browser_url');
    }
    setBrowserUrlState(value || '');
  }, []);

  const setJwt = useCallback((value) => {
    const nextValue = value || '';
    if (!storage) {
      setJwtState(nextValue);
    } else {
      if (nextValue) {
        storage.setItem('jwt', nextValue);
      } else {
        storage.removeItem('jwt');
      }
      setJwtState(nextValue);
    }
    jwtRef.current = nextValue;
  }, []);

  const setUserData = useCallback((valueOrUpdater) => {
    setUserDataState((previous) => {
      const nextValueRaw =
        typeof valueOrUpdater === 'function' ? valueOrUpdater(previous) : valueOrUpdater;

      if (!nextValueRaw) {
        if (storage) {
          storage.removeItem('userdata');
        }
        const currentObjectUrl = avatarObjectUrlRef.current;
        if (currentObjectUrl && typeof URL !== 'undefined' && typeof URL.revokeObjectURL === 'function') {
          try {
            URL.revokeObjectURL(currentObjectUrl);
          } catch (error) {
            console.warn('Failed to revoke previous avatar URL:', error);
          }
        }
        avatarObjectUrlRef.current = null;
        return null;
      }

      const normalized = { ...nextValueRaw };
      const avatarUrl = typeof normalized.avatarUrl === 'string' ? normalized.avatarUrl : null;

      const persistable = { ...normalized };
      if (avatarUrl) {
        const lower = avatarUrl.toLowerCase();
        const isObjectUrl = lower.startsWith('blob:');
        const isDataUrl = lower.startsWith('data:');
        if (isObjectUrl || isDataUrl) {
          delete persistable.avatarUrl;
        }
      } else {
        delete persistable.avatarUrl;
      }

      if (storage) {
        try {
          storage.setItem('userdata', JSON.stringify(persistable));
        } catch (error) {
          console.warn('Failed to persist userdata:', error);
        }
      }

      const currentObjectUrl = avatarObjectUrlRef.current;
      if (
        currentObjectUrl &&
        currentObjectUrl !== avatarUrl &&
        typeof URL !== 'undefined' &&
        typeof URL.revokeObjectURL === 'function'
      ) {
        try {
          URL.revokeObjectURL(currentObjectUrl);
        } catch (error) {
          console.warn('Failed to revoke previous avatar URL:', error);
        }
      }

      if (avatarUrl && avatarUrl.toLowerCase().startsWith('blob:')) {
        avatarObjectUrlRef.current = avatarUrl;
      } else {
        avatarObjectUrlRef.current = null;
      }

      return normalized;
    });
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') {
      setSessionReady(true);
      return;
    }

    const params = new URLSearchParams(window.location.search);
    let modified = false;

    const nextBrowserUrl = params.get('browser_url');
    if (nextBrowserUrl) {
      setBrowserUrl(nextBrowserUrl);
      params.delete('browser_url');
      modified = true;
    }

    const nextJwt = params.get('jwt');
    if (nextJwt) {
      setJwt(nextJwt);
      params.delete('jwt');
      modified = true;
    }

    const nextUserDataRaw = params.get('userdata');
    if (nextUserDataRaw) {
      try {
        const parsed = JSON.parse(nextUserDataRaw);
        setUserData(parsed);
        params.delete('userdata');
        modified = true;
      } catch (error) {
        console.warn('Failed to parse userdata from URL params:', error);
      }
    }

    if (modified) {
      const newSearch = params.toString();
      const newUrl = `${window.location.pathname}${newSearch ? `?${newSearch}` : ''}${window.location.hash}`;
      window.history.replaceState(null, '', newUrl);
    }

    setSessionReady(true);
  }, [setBrowserUrl, setJwt, setUserData]);

  useEffect(() => {
    jwtRef.current = jwt;
  }, [jwt]);

  useEffect(() => {
    browserUrlRef.current = browserUrl;
  }, [browserUrl]);

  const updateRealtimeInfo = useCallback((updater) => {
    if (!isMountedRef.current) {
      return;
    }
    setRealtimeInfo((previous) => {
      const patch =
        typeof updater === 'function'
          ? updater(previous)
          : updater && typeof updater === 'object'
          ? updater
          : null;
      if (!patch) {
        return previous;
      }
      return { ...previous, ...patch };
    });
  }, []);

  const clearReconnectTimeout = useCallback(() => {
    if (typeof window === 'undefined') {
      reconnectTimeoutRef.current = null;
      return;
    }
    if (reconnectTimeoutRef.current !== null) {
      window.clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
  }, []);

  const clearHeartbeatTimers = useCallback(() => {
    if (typeof window === 'undefined') {
      heartbeatIntervalRef.current = null;
      heartbeatTimeoutRef.current = null;
      lastPingTimestampRef.current = null;
      return;
    }
    if (heartbeatIntervalRef.current !== null) {
      window.clearInterval(heartbeatIntervalRef.current);
      heartbeatIntervalRef.current = null;
    }
    if (heartbeatTimeoutRef.current !== null) {
      window.clearTimeout(heartbeatTimeoutRef.current);
      heartbeatTimeoutRef.current = null;
    }
    lastPingTimestampRef.current = null;
  }, []);

  const flushOfflineQueue = useCallback(() => {
    const socket = websocketRef.current;
    if (!socket || socket.readyState !== WEBSOCKET_READY_STATE.OPEN) {
      return;
    }
    const queue = offlineQueueRef.current;
    if (!Array.isArray(queue) || queue.length === 0) {
      updateRealtimeInfo((previous) => ({
        ...previous,
        queueLength: 0,
      }));
      return;
    }

    while (queue.length > 0) {
      const item = queue.shift();
      if (!item) {
        continue;
      }
      const message = toSocketMessage(item.payload);
      if (message === null) {
        continue;
      }
      try {
        socket.send(message);
      } catch (error) {
        console.warn('Fallo al enviar mensaje en cola:', error);
        queue.unshift(item);
        break;
      }
    }

    updateRealtimeInfo((previous) => ({
      ...previous,
      queueLength: queue.length,
    }));
  }, [updateRealtimeInfo]);

  const sendRealtimeMessage = useCallback(
    (payload, options = {}) => {
      const { enqueue = true } = options || {};
      const socket = websocketRef.current;
      const message = toSocketMessage(payload);
      if (message === null) {
        return { ok: false, queued: false, error: 'serialization-error' };
      }

      if (socket && socket.readyState === WEBSOCKET_READY_STATE.OPEN) {
        try {
          socket.send(message);
          return { ok: true, queued: false };
        } catch (error) {
          console.warn('No se pudo enviar el mensaje por WebSocket:', error);
        }
      }

      if (!enqueue) {
        return { ok: false, queued: false, error: 'socket-not-open' };
      }

      const queue = offlineQueueRef.current;
      if (queue.length >= MAX_OFFLINE_QUEUE) {
        queue.shift();
      }
      queue.push({
        payload,
        enqueuedAt: Date.now(),
      });

      updateRealtimeInfo((previous) => ({
        ...previous,
        queueLength: queue.length,
      }));

      return { ok: false, queued: true };
    },
    [updateRealtimeInfo]
  );

  const handlePong = useCallback(() => {
    if (typeof window !== 'undefined' && heartbeatTimeoutRef.current !== null) {
      window.clearTimeout(heartbeatTimeoutRef.current);
    }
    heartbeatTimeoutRef.current = null;
    const now = Date.now();
    const lastPing = lastPingTimestampRef.current;
    lastPingTimestampRef.current = null;
    const latency = typeof lastPing === 'number' ? Math.max(0, now - lastPing) : null;
    updateRealtimeInfo((previous) => ({
      ...previous,
      isOnline: true,
      lastError: null,
      lastHeartbeatAt: now,
      latency: latency ?? previous.latency,
    }));
  }, [updateRealtimeInfo]);

  const dispatchRealtimeEvent = useCallback(
    (event) => {
      const normalizedType =
        event && typeof event.type === 'string' && event.type.trim()
          ? event.type.trim()
          : 'message';

      const finalEvent = {
        type: normalizedType,
        payload: event?.payload ?? null,
        raw: event?.raw ?? null,
        receivedAt: event?.receivedAt ?? Date.now(),
      };

      updateRealtimeInfo((previous) => ({
        ...previous,
        lastEvent: finalEvent,
      }));

      const listenersByType = eventListenersRef.current.get(normalizedType);
      if (listenersByType && listenersByType.size > 0) {
        listenersByType.forEach((listener) => {
          try {
            listener(finalEvent);
          } catch (error) {
            console.error('Error en listener de eventos en tiempo real:', error);
          }
        });
      }

      const wildcardListeners = eventListenersRef.current.get('*');
      if (wildcardListeners && wildcardListeners.size > 0) {
        wildcardListeners.forEach((listener) => {
          try {
            listener(finalEvent);
          } catch (error) {
            console.error('Error en listener wildcard de tiempo real:', error);
          }
        });
      }
    },
    [updateRealtimeInfo]
  );

  const subscribeToRealtime = useCallback((eventType, handler) => {
    if (typeof handler !== 'function') {
      return () => {};
    }
    const normalizedType =
      typeof eventType === 'string' && eventType.trim() ? eventType.trim() : '*';
    let listeners = eventListenersRef.current.get(normalizedType);
    if (!listeners) {
      listeners = new Set();
      eventListenersRef.current.set(normalizedType, listeners);
    }
    listeners.add(handler);
    return () => {
      const currentListeners = eventListenersRef.current.get(normalizedType);
      if (!currentListeners) {
        return;
      }
      currentListeners.delete(handler);
      if (currentListeners.size === 0) {
        eventListenersRef.current.delete(normalizedType);
      }
    };
  }, []);

  const handleIncomingMessage = useCallback(
    (raw) => {
      if (!isMountedRef.current) {
        return;
      }

      setWebsocketLastMessage(raw);

      let parsedPayload = raw;
      if (typeof raw === 'string') {
        try {
          parsedPayload = JSON.parse(raw);
        } catch (error) {
          parsedPayload = raw;
        }
      }

      let eventType = 'message';
      if (parsedPayload && typeof parsedPayload === 'object') {
        const candidate =
          parsedPayload.type ||
          parsedPayload.event ||
          parsedPayload.action ||
          parsedPayload.kind;
        if (typeof candidate === 'string' && candidate.trim()) {
          eventType = candidate.trim();
        }
      } else if (typeof raw === 'string' && raw.trim()) {
        eventType = raw.trim();
      }

      const eventTypeLower = typeof eventType === 'string' ? eventType.toLowerCase() : '';

      if (eventTypeLower === 'pong' || eventTypeLower === 'system.pong') {
        handlePong();
      } else if (eventTypeLower === 'ping' || eventTypeLower === 'system.ping') {
        const pingId =
          parsedPayload?.ping_id ??
          parsedPayload?.pingId ??
          parsedPayload?.payload?.ping_id ??
          parsedPayload?.payload?.pingId ??
          null;
        const pongPayload = {
          type: 'system.pong',
          ping_id: pingId || undefined,
          client_timestamp: Date.now(),
        };
        sendRealtimeMessage(pongPayload, { enqueue: false });
      }

      dispatchRealtimeEvent({
        type: eventType,
        payload: parsedPayload,
        raw,
        receivedAt: Date.now(),
      });
    },
    [dispatchRealtimeEvent, handlePong, sendRealtimeMessage, isMountedRef]
  );

  const startHeartbeat = useCallback(
    (socket) => {
      clearHeartbeatTimers();
      if (typeof window === 'undefined') {
        return;
      }
      if (!socket || socket.readyState !== WEBSOCKET_READY_STATE.OPEN) {
        return;
      }

      const sendPing = () => {
        const currentSocket = websocketRef.current;
        if (
          !currentSocket ||
          currentSocket !== socket ||
          currentSocket.readyState !== WEBSOCKET_READY_STATE.OPEN
        ) {
          return;
        }

        const now = Date.now();
        lastPingTimestampRef.current = now;

        try {
          currentSocket.send(
            JSON.stringify({
              type: 'ping',
              ts: now,
            })
          );
        } catch (error) {
          console.warn('No se pudo enviar el ping de heartbeat:', error);
          return;
        }

        if (heartbeatTimeoutRef.current !== null) {
          window.clearTimeout(heartbeatTimeoutRef.current);
        }
        heartbeatTimeoutRef.current = window.setTimeout(() => {
          heartbeatTimeoutRef.current = null;
          updateRealtimeInfo((previous) => ({
            ...previous,
            isOnline: false,
            lastError: 'Heartbeat timeout',
          }));
          try {
            currentSocket.close(4000, 'Heartbeat timeout');
          } catch (closeError) {
            console.warn('Error al cerrar el WebSocket tras heartbeat timeout:', closeError);
          }
        }, HEARTBEAT_TIMEOUT_MS);
      };

      sendPing();
      heartbeatIntervalRef.current = window.setInterval(sendPing, HEARTBEAT_INTERVAL_MS);
    },
    [clearHeartbeatTimers, updateRealtimeInfo]
  );

  const scheduleReconnect = useCallback(
    (reason, retryFn) => {
      if (typeof window === 'undefined') {
        return;
      }
      if (manualDisconnectRef.current || !jwtRef.current) {
        return;
      }
      if (reconnectTimeoutRef.current !== null) {
        return;
      }

      reconnectAttemptsRef.current += 1;
      const attemptNumber = reconnectAttemptsRef.current;
      const delay = Math.min(
        RECONNECT_MAX_DELAY_MS,
        RECONNECT_INITIAL_DELAY_MS * Math.pow(2, Math.max(0, attemptNumber - 1))
      );

      updateRealtimeInfo((previous) => ({
        ...previous,
        status: 'reconnecting',
        isOnline: false,
        lastError: reason || previous.lastError,
      }));

      reconnectTimeoutRef.current = window.setTimeout(() => {
        reconnectTimeoutRef.current = null;
        if (manualDisconnectRef.current || !jwtRef.current) {
          return;
        }
        if (typeof retryFn === 'function') {
          retryFn();
        }
      }, delay);
    },
    [updateRealtimeInfo]
  );

  const openSocket = useCallback(
    async ({ manual = false } = {}) => {
      if (typeof window === 'undefined' || typeof window.WebSocket === 'undefined') {
        if (isMountedRef.current) {
          const message = 'La API de WebSocket no está disponible en este entorno';
          setWebsocketError(message);
          setWebsocketStatus('error');
          updateRealtimeInfo((previous) => ({
            ...previous,
            status: 'error',
            isOnline: false,
            lastError: message,
          }));
        }
        return null;
      }

      const token = (jwtRef.current || '').trim();
      if (!token) {
        if (isMountedRef.current) {
          const message = 'No hay token disponible para abrir el WebSocket';
          setWebsocketError(message);
          setWebsocketStatus('idle');
          updateRealtimeInfo((previous) => ({
            ...previous,
            status: 'idle',
            isOnline: false,
            lastError: message,
          }));
        }
        return null;
      }

      const existingSocket = websocketRef.current;
      if (
        existingSocket &&
        (existingSocket.readyState === WEBSOCKET_READY_STATE.OPEN ||
          existingSocket.readyState === WEBSOCKET_READY_STATE.CONNECTING)
      ) {
        return existingSocket;
      }

      if (websocketConnectingRef.current) {
        return websocketRef.current;
      }

      websocketConnectingRef.current = true;
      const attemptId = websocketAttemptRef.current + 1;
      websocketAttemptRef.current = attemptId;

      if (manual) {
        reconnectAttemptsRef.current = 0;
        manualDisconnectRef.current = false;
      }

      clearReconnectTimeout();

      if (isMountedRef.current && websocketAttemptRef.current === attemptId) {
        setWebsocketError(null);
        setWebsocketStatus('registering');
        setWebsocketLastMessage(null);
        updateRealtimeInfo((previous) => ({
          ...previous,
          status: 'registering',
          lastError: null,
        }));
      }

      const httpBase = normalizeBackendBase(browserUrlRef.current);
      let registrationPayload = null;

      try {
        const response = await fetch(`${httpBase}/websockets/connection`, {
          method: 'POST',
          headers: {
            Accept: 'application/json',
            Authorization: `Bearer ${token}`,
          },
          credentials: 'include',
        });

        try {
          registrationPayload = await response.json();
        } catch (_) {
          registrationPayload = null;
        }

        if (!response.ok) {
          const detail =
            (registrationPayload && (registrationPayload.detail || registrationPayload.message)) ||
            `Error al registrar la conexión (HTTP ${response.status})`;
          throw new Error(detail);
        }

        if (isMountedRef.current && websocketAttemptRef.current === attemptId) {
          setWebsocketRegistration(registrationPayload);
          setWebsocketStatus('connecting');
          updateRealtimeInfo((previous) => ({
            ...previous,
            status: 'connecting',
          }));
          dispatchRealtimeEvent({
            type: 'connection.registered',
            payload: registrationPayload,
            raw: null,
            receivedAt: Date.now(),
          });
        }

        const wsUrl = buildWebSocketUrl(httpBase, token);
        const socket = new window.WebSocket(wsUrl);
        websocketRef.current = socket;

        if (isMountedRef.current && websocketAttemptRef.current === attemptId) {
          setWebsocket(socket);
        }

        socket.onopen = () => {
          if (!isMountedRef.current || websocketAttemptRef.current !== attemptId) {
            try {
              socket.close(1000, 'Intento de conexión WebSocket obsoleto');
            } catch (_) {
              /* ignore */
            }
            return;
          }
          websocketConnectingRef.current = false;
          reconnectAttemptsRef.current = 0;
          manualDisconnectRef.current = false;

          setWebsocketStatus('open');
          updateRealtimeInfo((previous) => ({
            ...previous,
            status: 'open',
            isOnline: true,
            lastError: null,
          }));

          startHeartbeat(socket);
          flushOfflineQueue();
          dispatchRealtimeEvent({
            type: 'connection.open',
            payload: {
              registration: registrationPayload,
            },
            raw: null,
            receivedAt: Date.now(),
          });
        };

        socket.onmessage = (event) => {
          if (!isMountedRef.current || websocketAttemptRef.current !== attemptId) {
            return;
          }
          handleIncomingMessage(event.data);
        };

        socket.onerror = (event) => {
          if (!isMountedRef.current || websocketAttemptRef.current !== attemptId) {
            return;
          }
          if (typeof console !== 'undefined') {
            console.warn('WebSocket error:', event);
          }
          const message = 'Ocurrió un error en la conexión WebSocket';
          setWebsocketError(message);
          setWebsocketStatus('error');
          updateRealtimeInfo((previous) => ({
            ...previous,
            status: 'error',
            isOnline: false,
            lastError: message,
          }));
          dispatchRealtimeEvent({
            type: 'connection.error',
            payload: {
              message,
            },
            raw: null,
            receivedAt: Date.now(),
          });
        };

        socket.onclose = (event) => {
          if (!isMountedRef.current || websocketAttemptRef.current !== attemptId) {
            return;
          }

          clearHeartbeatTimers();

          const reason =
            event.reason ||
            (event.code === 1000 ? 'Conexión WebSocket cerrada' : `Conexión WebSocket cerrada (código ${event.code})`);

          if (typeof console !== 'undefined') {
            console.warn(
              'WebSocket closed',
              {
                code: event.code,
                reason: event.reason,
                wasClean: event.wasClean,
              },
              reason
            );
          }

          if (event.code !== 1000 || !event.wasClean) {
            setWebsocketError(reason);
          }

          setWebsocket(null);
          websocketRef.current = null;
          setWebsocketRegistration(null);

          dispatchRealtimeEvent({
            type: 'connection.closed',
            payload: {
              code: event.code,
              reason,
              wasClean: event.wasClean,
            },
            raw: null,
            receivedAt: Date.now(),
          });

          const wasManual = manualDisconnectRef.current;
          if (wasManual) {
            manualDisconnectRef.current = false;
            setWebsocketStatus('idle');
            updateRealtimeInfo((previous) => ({
              ...previous,
              status: 'idle',
              isOnline: false,
              lastError: null,
            }));
            return;
          }

          setWebsocketStatus('closed');
          updateRealtimeInfo((previous) => ({
            ...previous,
            status: 'closed',
            isOnline: false,
            lastError: reason,
          }));

          scheduleReconnect(reason, () => {
            openSocket({ manual: false }).catch((error) => {
              console.warn('Error durante la reconexión WebSocket:', error);
            });
          });
        };

        return socket;
      } catch (error) {
        if (isMountedRef.current && websocketAttemptRef.current === attemptId) {
          const message = error?.message || 'No fue posible establecer la conexión WebSocket';
          setWebsocketError(message);
          setWebsocketStatus('error');
          setWebsocket(null);
          websocketRef.current = null;
          setWebsocketRegistration(null);
          updateRealtimeInfo((previous) => ({
            ...previous,
            status: 'error',
            isOnline: false,
            lastError: message,
          }));
          dispatchRealtimeEvent({
            type: 'connection.error',
            payload: {
              message,
            },
            raw: null,
            receivedAt: Date.now(),
          });
        }

        scheduleReconnect(error?.message, () => {
          openSocket({ manual: false }).catch((innerError) => {
            console.warn('Error durante la reconexión WebSocket:', innerError);
          });
        });

        throw error;
      } finally {
        if (websocketAttemptRef.current === attemptId) {
          websocketConnectingRef.current = false;
        }
      }
    },
    [
      clearHeartbeatTimers,
      clearReconnectTimeout,
      dispatchRealtimeEvent,
      flushOfflineQueue,
      handleIncomingMessage,
      scheduleReconnect,
      startHeartbeat,
      updateRealtimeInfo,
    ]
  );

  const disconnectWebsocket = useCallback(() => {
    manualDisconnectRef.current = true;
    websocketAttemptRef.current += 1;
    websocketConnectingRef.current = false;
    reconnectAttemptsRef.current = 0;
    clearReconnectTimeout();
    clearHeartbeatTimers();

    const socket = websocketRef.current;
    websocketRef.current = null;

    if (socket) {
      try {
        socket.onopen = null;
        socket.onmessage = null;
        socket.onerror = null;
        socket.onclose = null;
        if (
          socket.readyState === WEBSOCKET_READY_STATE.CONNECTING ||
          socket.readyState === WEBSOCKET_READY_STATE.OPEN
        ) {
          socket.close(1000, 'Client closing connection');
        }
      } catch (error) {
        console.warn('Error while closing WebSocket:', error);
      }
    } else {
      manualDisconnectRef.current = false;
    }

    offlineQueueRef.current = [];

    if (isMountedRef.current) {
      setWebsocket(null);
      setWebsocketStatus('idle');
      setWebsocketError(null);
      setWebsocketLastMessage(null);
      setWebsocketRegistration(null);
      updateRealtimeInfo((previous) => ({
        ...previous,
        status: 'idle',
        isOnline: false,
        lastError: null,
        queueLength: 0,
        lastHeartbeatAt: null,
        latency: null,
      }));
    }
  }, [clearHeartbeatTimers, clearReconnectTimeout, updateRealtimeInfo]);

  const connectWebsocket = useCallback(() => openSocket({ manual: true }), [openSocket]);

  const sendWebsocketMessage = useCallback(
    (payload) => {
      const result = sendRealtimeMessage(payload, { enqueue: false });
      return result.ok;
    },
    [sendRealtimeMessage]
  );

  const ensureRealtimeConnection = useCallback(() => openSocket({ manual: false }), [openSocket]);

  const realtimeValue = useMemo(
    () => ({
      status: realtimeInfo.status,
      isOnline: realtimeInfo.isOnline,
      lastError: realtimeInfo.lastError,
      lastEvent: realtimeInfo.lastEvent,
      queueLength: realtimeInfo.queueLength,
      latency: realtimeInfo.latency,
      lastHeartbeatAt: realtimeInfo.lastHeartbeatAt,
      send: sendRealtimeMessage,
      ensureConnection: ensureRealtimeConnection,
      disconnect: disconnectWebsocket,
      subscribe: subscribeToRealtime,
    }),
    [
      disconnectWebsocket,
      ensureRealtimeConnection,
      realtimeInfo,
      sendRealtimeMessage,
      subscribeToRealtime,
    ]
  );

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const handleOnline = () => {
      updateRealtimeInfo((previous) => ({
        ...previous,
        lastError: null,
      }));

      const socket = websocketRef.current;
      if (
        !socket ||
        socket.readyState === WEBSOCKET_READY_STATE.CLOSED ||
        socket.readyState === WEBSOCKET_READY_STATE.CLOSING
      ) {
        ensureRealtimeConnection().catch((error) => {
          console.warn('Error al reconectar tras recuperar la red:', error);
        });
      }
    };

    const handleOffline = () => {
      clearHeartbeatTimers();
      updateRealtimeInfo((previous) => ({
        ...previous,
        isOnline: false,
        status: 'offline',
        lastError: 'Sin conexión a internet',
      }));
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [clearHeartbeatTimers, ensureRealtimeConnection, updateRealtimeInfo]);

  useEffect(() => {
    if (!jwt) {
      return;
    }
    ensureRealtimeConnection().catch((error) => {
      console.warn('No fue posible iniciar el WebSocket automáticamente:', error);
    });
  }, [ensureRealtimeConnection, jwt]);

  useEffect(() => {
    if (!jwt) {
      disconnectWebsocket();
    }
  }, [jwt, disconnectWebsocket]);

  const skipFirstCleanupRef = useRef(
    typeof process !== 'undefined' && process.env.NODE_ENV !== 'production'
  );

  useEffect(() => {
    return () => {
      if (skipFirstCleanupRef.current) {
        skipFirstCleanupRef.current = false;
        return;
      }
      disconnectWebsocket();
    };
  }, [disconnectWebsocket]);

  const value = useMemo(
    () => ({
      browserUrl,
      setBrowserUrl,
      jwt,
      setJwt,
      userData,
      setUserData,
      isSessionReady,
      websocket,
      websocketStatus,
      websocketError,
      websocketLastMessage,
      websocketRegistration,
      connectWebsocket,
      disconnectWebsocket,
      sendWebsocketMessage,
      realtime: realtimeValue,
    }),
    [
      browserUrl,
      connectWebsocket,
      disconnectWebsocket,
      isSessionReady,
      jwt,
      realtimeValue,
      sendWebsocketMessage,
      setBrowserUrl,
      setJwt,
      setUserData,
      userData,
      websocket,
      websocketError,
      websocketLastMessage,
      websocketRegistration,
      websocketStatus,
    ]
  );

  return (
    <SessionContext.Provider value={value}>
      <RealtimeContext.Provider value={realtimeValue}>{children}</RealtimeContext.Provider>
    </SessionContext.Provider>
  );
};

export const useSession = () => useContext(SessionContext);

export const useRealtime = () => useContext(RealtimeContext);
