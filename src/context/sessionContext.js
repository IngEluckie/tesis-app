import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

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

  const websocketRef = useRef(null);
  const websocketConnectingRef = useRef(false);
  const websocketAttemptRef = useRef(0);
  const isMountedRef = useRef(true);
  const jwtRef = useRef(jwt);
  const avatarObjectUrlRef = useRef(null);

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

  const disconnectWebsocket = useCallback(() => {
    websocketAttemptRef.current += 1;
    websocketConnectingRef.current = false;

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
    }

    if (isMountedRef.current) {
      setWebsocket(null);
      setWebsocketStatus('idle');
      setWebsocketError(null);
      setWebsocketLastMessage(null);
      setWebsocketRegistration(null);
    }
  }, []);

  const connectWebsocket = useCallback(async () => {
    if (typeof window === 'undefined' || typeof window.WebSocket === 'undefined') {
      if (isMountedRef.current) {
        setWebsocketError('La API de WebSocket no está disponible en este entorno');
        setWebsocketStatus('error');
      }
      return null;
    }

    const token = (jwtRef.current || '').trim();
    if (!token) {
      if (isMountedRef.current) {
        setWebsocketError('No hay token disponible para abrir el WebSocket');
        setWebsocketStatus('idle');
      }
      return null;
    }

    const currentSocket = websocketRef.current;
    if (
      currentSocket &&
      (currentSocket.readyState === WEBSOCKET_READY_STATE.OPEN ||
        currentSocket.readyState === WEBSOCKET_READY_STATE.CONNECTING)
    ) {
      return currentSocket;
    }

    if (websocketConnectingRef.current) {
      return websocketRef.current;
    }

    websocketConnectingRef.current = true;
    const attemptId = websocketAttemptRef.current + 1;
    websocketAttemptRef.current = attemptId;

    const httpBase = normalizeBackendBase(browserUrl);

    if (isMountedRef.current) {
      setWebsocketError(null);
      setWebsocketStatus('registering');
      setWebsocketLastMessage(null);
    }

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
        setWebsocketStatus('open');
      };

      socket.onmessage = (event) => {
        if (!isMountedRef.current || websocketAttemptRef.current !== attemptId) {
          return;
        }
        setWebsocketLastMessage(event.data);
      };

      socket.onerror = (event) => {
        if (!isMountedRef.current || websocketAttemptRef.current !== attemptId) {
          return;
        }
        console.warn('WebSocket error:', event);
        setWebsocketError('Ocurrió un error en la conexión WebSocket');
        setWebsocketStatus('error');
      };

      socket.onclose = (event) => {
        if (!isMountedRef.current || websocketAttemptRef.current !== attemptId) {
          return;
        }
        if (event.code !== 1000 || !event.wasClean) {
          setWebsocketError(event.reason || `Conexión WebSocket cerrada (código ${event.code})`);
        }
        setWebsocketStatus('closed');
        setWebsocket(null);
        websocketRef.current = null;
      };

      return socket;
    } catch (error) {
      if (isMountedRef.current && websocketAttemptRef.current === attemptId) {
        setWebsocketError(error?.message || 'No fue posible establecer la conexión WebSocket');
        setWebsocketStatus('error');
        setWebsocket(null);
        websocketRef.current = null;
        setWebsocketRegistration(null);
      }
      throw error;
    } finally {
      if (websocketAttemptRef.current === attemptId) {
        websocketConnectingRef.current = false;
      }
    }
  }, [browserUrl]);

  const sendWebsocketMessage = useCallback((payload) => {
    const socket = websocketRef.current;
    if (!socket || socket.readyState !== WEBSOCKET_READY_STATE.OPEN) {
      return false;
    }

    try {
      const message = typeof payload === 'string' ? payload : JSON.stringify(payload);
      socket.send(message);
      return true;
    } catch (error) {
      console.warn('No se pudo enviar el mensaje por WebSocket:', error);
      return false;
    }
  }, []);

  useEffect(() => {
    if (!jwt) {
      disconnectWebsocket();
    }
  }, [jwt, disconnectWebsocket]);

  useEffect(
    () => () => {
      disconnectWebsocket();
    },
    [disconnectWebsocket]
  );

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
    }),
    [
      browserUrl,
      connectWebsocket,
      disconnectWebsocket,
      isSessionReady,
      jwt,
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

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
};

export const useSession = () => useContext(SessionContext);
