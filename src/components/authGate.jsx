import React, { useEffect, useMemo, useState } from 'react';
import { useSession } from '../context/sessionContext';

const decodeJwt = (token) => {
  try {
    const parts = token.split('.');
    if (parts.length < 2) {
      return null;
    }
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const payload = window.atob(base64);
    return JSON.parse(payload);
  } catch (error) {
    console.warn('Failed to decode JWT payload:', error);
    return null;
  }
};

export const AuthGate = ({ children }) => {
  const {
    browserUrl,
    jwt,
    setUserData,
    isSessionReady,
    connectWebsocket,
    disconnectWebsocket,
  } = useSession();
  const [checking, setChecking] = useState(true);

  const loginUrl = useMemo(() => {
    const defaultBase = 'http://127.0.0.1:8000';
    const base = (browserUrl || defaultBase).replace(/\/$/, '');
    return `${base}/login`;
  }, [browserUrl]);

  useEffect(() => {
    if (!isSessionReady) {
      return;
    }

    const redirectToLogin = () => {
      disconnectWebsocket();
      const back = window.location.href;
      const url = `${loginUrl}?redirect=${encodeURIComponent(back)}`;
      window.location.replace(url);
    };

    const payload = jwt ? decodeJwt(jwt) : null;
    const exp = payload?.exp ? payload.exp * 1000 : null;
    const isExpired = exp && Date.now() >= exp;

    if (!jwt || isExpired) {
      redirectToLogin();
      return;
    }

    const defaultBase = loginUrl.replace(/\/login$/, '');

    const verify = async () => {
      try {
        const res = await fetch(`${defaultBase}/auth/me`, {
          method: 'GET',
          headers: {
            Accept: 'application/json',
            Authorization: `Bearer ${jwt}`,
          },
          credentials: 'include',
        });

        if (res.ok) {
          try {
            const data = await res.json();
            setUserData(data);
          } catch (_) {
            // ignore json parse issues
          }
          try {
            await connectWebsocket();
          } catch (socketError) {
            console.warn('WebSocket connect failed:', socketError);
          }
        } else if (res.status === 401 || res.status === 403) {
          disconnectWebsocket();
          redirectToLogin();
          return;
        } else {
          console.warn('Unexpected auth/me response status:', res.status);
        }
      } catch (err) {
        console.warn('Auth verify failed:', err);
      } finally {
        setChecking(false);
      }
    };

    verify();
  }, [connectWebsocket, disconnectWebsocket, isSessionReady, jwt, loginUrl, setUserData]);

  if (!isSessionReady || checking) {
    return <div style={{ padding: 16 }}>Verificando sesión…</div>;
  }

  return <>{children}</>;
};
