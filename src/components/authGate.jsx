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
      return undefined;
    }

    let isCancelled = false;
    const avatarController = new AbortController();

    const clearAvatarInState = () => {
      if (isCancelled) {
        return;
      }
      setUserData((prev) => {
        if (!prev) {
          return prev;
        }
        const next = { ...prev };
        let changed = false;
        if ('avatarUrl' in next) {
          delete next.avatarUrl;
          changed = true;
        }
        if ('avatarMimeType' in next) {
          delete next.avatarMimeType;
          changed = true;
        }
        if (Object.prototype.hasOwnProperty.call(next, 'profile_image')) {
          next.profile_image = null;
          changed = true;
        }
        return changed ? next : prev;
      });
    };

    const createObjectUrl = (blob) => {
      if (typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function') {
        return URL.createObjectURL(blob);
      }
      if (
        typeof window !== 'undefined' &&
        window.URL &&
        typeof window.URL.createObjectURL === 'function'
      ) {
        return window.URL.createObjectURL(blob);
      }
      return null;
    };

    const blobToDataUrl = (blob) =>
      new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => {
          resolve(typeof reader.result === 'string' ? reader.result : null);
        };
        reader.onerror = () => {
          reject(reader.error || new Error('No fue posible leer la imagen de perfil.'));
        };
        reader.readAsDataURL(blob);
      });

    const loadAvatar = async (baseUrl, token) => {
      if (!token || isCancelled) {
        return;
      }

      try {
        const response = await fetch(`${baseUrl}/users/me/avatar`, {
          method: 'GET',
          headers: {
            Accept: 'image/*',
            Authorization: `Bearer ${token}`,
          },
          credentials: 'include',
          signal: avatarController.signal,
        });

        if (response.status === 404) {
          clearAvatarInState();
          return;
        }

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        const blob = await response.blob();
        if (isCancelled) {
          return;
        }

        if (!blob || blob.size === 0) {
          clearAvatarInState();
          return;
        }

        let avatarUrl = createObjectUrl(blob);
        if (!avatarUrl) {
          try {
            avatarUrl = await blobToDataUrl(blob);
          } catch (conversionError) {
            console.warn('Failed to convert avatar blob to data URL:', conversionError);
            avatarUrl = null;
          }
        }

        if (!avatarUrl || isCancelled) {
          clearAvatarInState();
          return;
        }

        const avatarMimeType = blob.type || undefined;

        setUserData((prev) => {
          const base = prev ? { ...prev } : {};
          base.avatarUrl = avatarUrl;
          if (avatarMimeType) {
            base.avatarMimeType = avatarMimeType;
          } else {
            delete base.avatarMimeType;
          }
          return base;
        });
      } catch (error) {
        if (error?.name === 'AbortError' || isCancelled) {
          return;
        }
        console.warn('Failed to load avatar:', error);
      }
    };

    const redirectToLogin = () => {
      if (isCancelled) {
        return;
      }
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
      return () => {
        isCancelled = true;
        avatarController.abort();
      };
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
          let data = null;
          try {
            data = await res.json();
            if (!isCancelled && data) {
              setUserData((prev) => ({
                ...(prev || {}),
                ...data,
              }));
            }
          } catch (parseError) {
            console.warn('Failed to parse auth/me payload:', parseError);
          }

          if (!isCancelled) {
            const hasProfileImageField =
              data && Object.prototype.hasOwnProperty.call(data, 'profile_image');
            if (hasProfileImageField && !data.profile_image) {
              clearAvatarInState();
            } else {
              loadAvatar(defaultBase, jwt);
            }
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
        if (!isCancelled) {
          setChecking(false);
        }
      }
    };

    verify();

    return () => {
      isCancelled = true;
      avatarController.abort();
    };
  }, [connectWebsocket, disconnectWebsocket, isSessionReady, jwt, loginUrl, setUserData]);

  if (!isSessionReady || checking) {
    return <div style={{ padding: 16 }}>Verificando sesión…</div>;
  }

  return <>{children}</>;
};
