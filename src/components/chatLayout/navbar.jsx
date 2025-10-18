import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSession } from '../../context/sessionContext';

import default_user from '../icons/default_user.png'

const DEFAULT_BACKEND_BASE = 'http://127.0.0.1:8000';

export const Navbar = ({
  user: userProp,
  onToggleMute = () => {},
  onSearch = () => {},
  onCreateGroup = () => {},
  onOpenSettings = () => {},
}) => {
  const { userData, websocketStatus, browserUrl, jwt } = useSession();
  const [searchTerm, setSearchTerm] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState(null);
  const [isDropdownVisible, setDropdownVisible] = useState(false);

  const searchContainerRef = useRef(null);
  const requestAbortRef = useRef(null);

  const normalizeSearchPayload = useCallback((payload) => {
    if (!Array.isArray(payload)) {
      return [];
    }

    const usernames = payload.reduce((acc, entry) => {
      if (typeof entry === 'string') {
        const trimmed = entry.trim();
        if (trimmed) {
          acc.push(trimmed);
        }
        return acc;
      }

      if (entry && typeof entry === 'object') {
        const candidate = typeof entry.username === 'string' ? entry.username.trim() : '';
        if (candidate) {
          acc.push(candidate);
        }
      }
      return acc;
    }, []);

    return Array.from(new Set(usernames));
  }, []);

  const user = useMemo(() => {
    if (userProp) {
      return userProp;
    }
    return {
      username: userData?.username || 'Invitado',
      avatarUrl: userData?.avatarUrl || '',
      muted: userData?.muted ?? false,
    };
  }, [userProp, userData]);

  const backendBaseUrl = useMemo(() => {
    const raw = (browserUrl || '').trim();
    const withProtocol = raw
      ? /^https?:\/\//i.test(raw)
        ? raw
        : `http://${raw}`
      : DEFAULT_BACKEND_BASE;
    return withProtocol.replace(/\/+$/, '');
  }, [browserUrl]);

  const avatarConnectionClass = useMemo(() => {
    if (websocketStatus === 'open') {
      return 'navbar__avatar--ws-open';
    }
    if (websocketStatus === 'error') {
      return 'navbar__avatar--ws-error';
    }
    return '';
  }, [websocketStatus]);

  const resetSearchFeedback = useCallback(() => {
    setSearchResults([]);
    setSearchError(null);
    setDropdownVisible(false);
    setIsSearching(false);
  }, []);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (searchContainerRef.current && !searchContainerRef.current.contains(event.target)) {
        setDropdownVisible(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  useEffect(() => {
    const trimmedTerm = searchTerm.trim();

    if (!trimmedTerm || !jwt) {
      if (requestAbortRef.current) {
        requestAbortRef.current.abort();
        requestAbortRef.current = null;
      }
      resetSearchFeedback();
      return;
    }

    const controller = new AbortController();
    requestAbortRef.current = controller;
    let isActive = true;

    const debounceId = window.setTimeout(async () => {
      setIsSearching(true);
      setSearchError(null);

      try {
        const response = await fetch(
          `${backendBaseUrl}/chats/search_user_navbar/${encodeURIComponent(trimmedTerm)}`,
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
          let message = `Error al buscar usuarios (HTTP ${response.status})`;
          try {
            const errorPayload = await response.json();
            message = errorPayload?.detail || errorPayload?.error || message;
          } catch (error) {
            console.warn('No se pudo leer el cuerpo de error de búsqueda:', error);
          }
          throw new Error(message);
        }

        const payload = await response.json();
        if (!isActive) {
          return;
        }

        const normalizedResults = normalizeSearchPayload(payload);
        setSearchResults(normalizedResults);
        setDropdownVisible(true);

        if (!Array.isArray(payload)) {
          setSearchError('Respuesta inesperada del servidor');
        } else {
          setSearchError(null);
        }
      } catch (error) {
        if (!isActive || error.name === 'AbortError') {
          return;
        }
        setSearchResults([]);
        setDropdownVisible(true);
        setSearchError(error?.message || 'No fue posible completar la búsqueda');
      } finally {
        if (isActive) {
          setIsSearching(false);
        }
      }
    }, 350);

    return () => {
      isActive = false;
      window.clearTimeout(debounceId);
      controller.abort();
      if (requestAbortRef.current === controller) {
        requestAbortRef.current = null;
      }
    };
  }, [backendBaseUrl, jwt, normalizeSearchPayload, resetSearchFeedback, searchTerm]);

  const handleSubmitSearch = useCallback(
    (event) => {
      event.preventDefault();
      const term = searchTerm.trim();
      if (!term) {
        resetSearchFeedback();
        return;
      }
      onSearch(term);
      setDropdownVisible(false);
    },
    [onSearch, resetSearchFeedback, searchTerm]
  );

  const handleSelectUsername = useCallback(
    (username) => {
      setSearchTerm(username);
      setDropdownVisible(false);
      onSearch(username);
    },
    [onSearch]
  );

  return (
    <header className="navbar" role="banner" aria-label="Barra de navegación del chat">
      {/* IZQUIERDA: Perfil + silencio */}
      <div className="navbar__left">
        <div className="navbar__profile">
          <img
            className={`navbar__avatar ${avatarConnectionClass}`}
            src={user.avatarUrl || default_user}
            alt={`Foto de perfil de ${user.username}`}
          />
          <div className="navbar__identity">
            <span className="navbar__username">{user.username}</span>
            <label className="navbar__mute" aria-label="Silencio">
              <span className="navbar__mute-label">Silencio</span>
              <button
                type="button"
                className={`mute-switch ${user.muted ? 'is-on' : 'is-off'}`}
                aria-pressed={user.muted}
                onClick={onToggleMute}
                title={user.muted ? 'Quitar silencio' : 'Activar silencio'}
              >
                <span className="mute-switch__thumb" />
                <span className="mute-switch__text">{user.muted ? 'ON' : 'OFF'}</span>
              </button>
            </label>
          </div>
        </div>
      </div>

      {/* CENTRO: Buscador de conversación/grupo */}
      <div className="navbar__center">
        <div className="navbar__search-container" ref={searchContainerRef}>
          <form
            className="navbar__search"
            role="search"
            aria-label="Buscar conversación o grupo"
            onSubmit={handleSubmitSearch}
          >
            <input
              className="navbar__search-input"
              type="search"
              name="q"
              value={searchTerm}
              onChange={(event) => {
                setSearchTerm(event.target.value);
              }}
              placeholder="Buscar conversación"
              aria-label="Buscar conversación"
              autoComplete="off"
            />
            <button className="navbar__search-btn" type="submit" title="Buscar">
              {/* Icono placeholder */}
              <span aria-hidden="true">🔎</span>
            </button>
          </form>

          {isDropdownVisible && (
            <div className="navbar__search-results" role="listbox" aria-live="polite">
              {isSearching && (
                <div className="navbar__search-status" role="status">
                  Buscando…
                </div>
              )}

              {!isSearching && searchError && (
                <div className="navbar__search-status navbar__search-status--error" role="alert">
                  {searchError}
                </div>
              )}

              {!isSearching && !searchError && searchResults.length === 0 && (
                <div className="navbar__search-status">Sin coincidencias</div>
              )}

              {!isSearching &&
                !searchError &&
                searchResults.map((username) => (
                  <button
                    type="button"
                    key={username}
                    className="navbar__search-result"
                    role="option"
                    onClick={() => handleSelectUsername(username)}
                  >
                    {username}
                  </button>
                ))}
            </div>
          )}
        </div>
      </div>

      {/* DERECHA: Crear grupo + Configuración */}
      <div className="navbar__right">
        <button
          type="button"
          className="btn btn--primary navbar__create-group"
          onClick={onCreateGroup}
          title="Crear grupo"
        >
          Crear grupo
        </button>

        <button
          type="button"
          className="icon-btn navbar__settings"
          onClick={onOpenSettings}
          aria-label="Abrir configuración"
          title="Configuración"
        >
          {/* Icono engrane placeholder */}
          <span aria-hidden="true">⚙️</span>
        </button>
      </div>
    </header>
  );
};
