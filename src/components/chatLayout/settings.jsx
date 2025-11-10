import React, { useCallback, useMemo, useRef, useState } from 'react';
import { useSession } from '../../context/sessionContext';
import './setting-styles.css';
import defaultUser from '../icons/default_user.png';

const DEFAULT_BACKEND_BASE = 'http://127.0.0.1:8000';
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

export const Settings = ({ isOpen = false, onClose = () => {} }) => {
  const { userData, setUserData, jwt, browserUrl } = useSession();
  const username = userData?.username || 'Invitado';
  const status = userData?.status || 'Normal';
  const avatarUrl = userData?.avatarUrl || defaultUser;

  const [uploadError, setUploadError] = useState('');
  const [isUploading, setIsUploading] = useState(false);

  const fileInputRef = useRef(null);
  const uploadAbortRef = useRef(null);

  const overlayClassName = `settings-overlay${isOpen ? ' is-open' : ''}`;

  const backendBaseUrl = useMemo(() => {
    const raw = (browserUrl || '').trim();
    const withProtocol = raw
      ? /^https?:\/\//i.test(raw)
        ? raw
        : `http://${raw}`
      : DEFAULT_BACKEND_BASE;
    return withProtocol.replace(/\/+$/, '');
  }, [browserUrl]);

  const resetInput = useCallback(() => {
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }, []);

  const clearPreviousUpload = useCallback(() => {
    if (uploadAbortRef.current) {
      uploadAbortRef.current.abort();
      uploadAbortRef.current = null;
    }
  }, []);

  const updateAvatarFromServer = useCallback(async () => {
    if (!jwt) {
      return;
    }

    const controller = new AbortController();
    uploadAbortRef.current = controller;

    try {
      const response = await fetch(`${backendBaseUrl}/users/me/avatar`, {
        method: 'GET',
        headers: {
          Accept: 'image/*',
          Authorization: `Bearer ${jwt}`,
        },
        credentials: 'include',
        signal: controller.signal,
      });

      if (response.status === 404) {
        setUserData((prev) => {
          if (!prev) {
            return prev;
          }
          const next = { ...prev };
          delete next.avatarUrl;
          delete next.avatarMimeType;
          next.profile_image = null;
          return next;
        });
        return;
      }

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const blob = await response.blob();
      if (!blob || blob.size === 0) {
        setUserData((prev) => {
          if (!prev) {
            return prev;
          }
          const next = { ...prev };
          delete next.avatarUrl;
          delete next.avatarMimeType;
          return next;
        });
        return;
      }

      let objectUrl = null;
      if (typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function') {
        objectUrl = URL.createObjectURL(blob);
      }
      if (!objectUrl) {
        objectUrl = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(typeof reader.result === 'string' ? reader.result : null);
          reader.onerror = () => reject(reader.error || new Error('No fue posible leer la imagen.'));
          reader.readAsDataURL(blob);
        });
      }

      if (!objectUrl) {
        throw new Error('No fue posible preparar la imagen recibida.');
      }

      const avatarMimeType = blob.type || undefined;
      const finalUrl = objectUrl;

      setUserData((prev) => {
        const base = prev ? { ...prev } : {};
        base.avatarUrl = finalUrl;
        if (avatarMimeType) {
          base.avatarMimeType = avatarMimeType;
        } else {
          delete base.avatarMimeType;
        }
        return base;
      });
    } catch (error) {
      if (error?.name === 'AbortError') {
        return;
      }
      console.warn('No fue posible recuperar el avatar actualizado:', error);
      setUploadError('No fue posible cargar la imagen actualizada. Intenta recargar la página.');
    } finally {
      if (uploadAbortRef.current === controller) {
        uploadAbortRef.current = null;
      }
    }
  }, [backendBaseUrl, jwt, setUserData]);

  const handleEditAvatar = useCallback(() => {
    if (!jwt) {
      setUploadError('Debes iniciar sesión para actualizar tu imagen.');
      return;
    }
    setUploadError('');
    if (fileInputRef.current) {
      fileInputRef.current.click();
    }
  }, [jwt]);

  const handleFileChange = useCallback(
    async (event) => {
      const file = event.target.files && event.target.files[0];
      if (!file) {
        return;
      }

      setUploadError('');

      if (!file.type || !file.type.startsWith('image/')) {
        setUploadError('Selecciona un archivo de imagen válido.');
        resetInput();
        return;
      }

      if (file.size > MAX_IMAGE_BYTES) {
        setUploadError('La imagen supera el tamaño máximo permitido (5 MB).');
        resetInput();
        return;
      }

      if (!jwt) {
        setUploadError('Sesión inválida. Vuelve a iniciar sesión.');
        resetInput();
        return;
      }

      clearPreviousUpload();
      const controller = new AbortController();
      uploadAbortRef.current = controller;

      const formData = new FormData();
      formData.append('file', file);

      setIsUploading(true);

      try {
        const response = await fetch(`${backendBaseUrl}/users/me/avatar`, {
          method: 'PUT',
          headers: {
            Authorization: `Bearer ${jwt}`,
          },
          body: formData,
          credentials: 'include',
          signal: controller.signal,
        });

        if (!response.ok) {
          let detail = `No se pudo actualizar la imagen (HTTP ${response.status}).`;
          try {
            const payload = await response.json();
            detail = payload?.detail || detail;
          } catch (readError) {
            console.warn('No se pudo leer el error de actualización de avatar:', readError);
          }
          throw new Error(detail);
        }

        let payload = null;
        try {
          payload = await response.json();
        } catch (_) {
          payload = null;
        }

        if (payload?.profile_image) {
          setUserData((prev) => {
            const base = prev ? { ...prev } : {};
            base.profile_image = payload.profile_image;
            return base;
          });
        }

        await updateAvatarFromServer();
      } catch (error) {
        if (error?.name === 'AbortError') {
          return;
        }
        console.warn('Fallo al subir la nueva imagen de perfil:', error);
        setUploadError(error?.message || 'No fue posible subir tu imagen.');
      } finally {
        setIsUploading(false);
        resetInput();
        if (uploadAbortRef.current === controller) {
          uploadAbortRef.current = null;
        }
      }
    },
    [backendBaseUrl, clearPreviousUpload, jwt, resetInput, setUserData, updateAvatarFromServer]
  );

  return (
    <div
      className={overlayClassName}
      role={isOpen ? 'dialog' : undefined}
      aria-modal={isOpen ? 'true' : undefined}
      aria-label={isOpen ? 'Configuración del perfil' : undefined}
      aria-hidden={isOpen ? undefined : 'true'}
    >
      <div className="settings-modal" hidden={!isOpen}>
        <button
          type="button"
          className="settings-close-btn"
          aria-label="Cerrar configuración"
          onClick={onClose}
        >
          ×
        </button>

        <header className="settings-header">
          <div className="settings-avatar-block">
            <div className="settings-avatar">
              <img src={avatarUrl} alt={`Foto de perfil de ${username}`} />
              <span className="settings-avatar-status" aria-hidden="true" />
            </div>
            <button
              type="button"
              className="settings-edit-avatar-btn"
              onClick={handleEditAvatar}
              disabled={isUploading}
            >
              {isUploading ? 'Subiendo…' : 'Editar imagen'}
            </button>
            <input
              ref={fileInputRef}
              className="settings-avatar-input"
              type="file"
              accept="image/*"
              onChange={handleFileChange}
              style={{ display: 'none' }}
            />
            {uploadError && <p className="settings-avatar-error">{uploadError}</p>}
          </div>

          <div className="settings-primary-controls">
            <label className="settings-username-label" htmlFor="settings-username-input">
              Usuario actual
            </label>
            <div className="settings-username-row">
              <input
                id="settings-username-input"
                className="settings-username-input"
                type="text"
                value={username}
                readOnly
              />
              <button type="button" className="settings-username-action">
                Cambiar username
              </button>
            </div>

            <div className="settings-theme-row">
              <span className="settings-theme-label">Tema:</span>
              <button type="button" className="settings-theme-toggle" aria-pressed="false">
                <span className="settings-theme-toggle__track">
                  <span className="settings-theme-toggle__thumb" />
                </span>
                <span className="settings-theme-toggle__state">OFF</span>
              </button>
              <span className="settings-theme-mode">Claro</span>
            </div>
          </div>
        </header>

        <section className="settings-body" aria-labelledby="settings-status-label">
          <span id="settings-status-label" className="settings-status-label">
            Estado actual
          </span>
          <div className="settings-status-wrapper">
            <textarea
              className="settings-status-input"
              defaultValue={status}
              placeholder="Escribe tu estado..."
              aria-label="Estado del usuario"
            />
          </div>
        </section>

        <footer className="settings-footer">
          <button type="button" className="settings-save-status-btn">
            Salvar nuevo estado
          </button>
        </footer>
      </div>
    </div>
  );
};
