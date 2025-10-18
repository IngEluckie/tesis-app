import React from 'react';
import { useSession } from '../../context/sessionContext';
import './setting-styles.css';

export const Settings = ({ isOpen = false, onClose = () => {} }) => {
  const { userData } = useSession();
  const username = userData?.username || 'Invitado';
  const status = userData?.status || 'Normal';
  const avatarUrl = userData?.avatarUrl || '/img/avatar-placeholder.png';

  const overlayClassName = `settings-overlay${isOpen ? ' is-open' : ''}`;

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
            <button type="button" className="settings-edit-avatar-btn">
              Editar imagen
            </button>
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
