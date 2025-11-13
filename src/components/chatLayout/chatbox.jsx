import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSession } from '../../context/sessionContext';
import { useAvatarImage } from '../../hooks/useAvatarImage';

import defaultUser from '../icons/default_user.png';

const ATTACHMENT_ACCEPT = '.jpg,.jpeg,.png,.zip,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.md';
const ALLOWED_EXTENSIONS = ATTACHMENT_ACCEPT.split(',')
  .map((item) => item.trim().toLowerCase())
  .filter(Boolean);

const ATTACHMENT_ID_KEYS = [
  'attachment_id',
  'id',
  'uuid',
  'file_id',
  'attachmentId',
  'attachmentID',
];

const getFileExtension = (filename = '') => {
  if (!filename || typeof filename !== 'string') {
    return '';
  }
  const dotIndex = filename.lastIndexOf('.');
  if (dotIndex === -1) {
    return '';
  }
  return filename.slice(dotIndex).toLowerCase();
};

const isAllowedAttachment = (file) => {
  if (!file || typeof file !== 'object') {
    return false;
  }
  const extension = getFileExtension(file.name);
  if (extension) {
    return ALLOWED_EXTENSIONS.includes(extension);
  }
  return false;
};

const extractAttachmentId = (attachment) => {
  if (!attachment || typeof attachment !== 'object') {
    return null;
  }
  for (const key of ATTACHMENT_ID_KEYS) {
    if (attachment[key] !== undefined && attachment[key] !== null) {
      return attachment[key];
    }
  }
  return null;
};

const getAttachmentDisplayName = (attachment) => {
  if (!attachment || typeof attachment !== 'object') {
    return 'Archivo adjunto';
  }
  return (
    attachment.original_name ||
    attachment.file_name ||
    attachment.name ||
    'Archivo adjunto'
  );
};

const normalizeId = (value) => {
  if (value === undefined || value === null) {
    return null;
  }
  const numeric = Number(value);
  return Number.isNaN(numeric) ? String(value) : numeric;
};

const formatTime = (isoString) => {
  if (!isoString) {
    return '';
  }
  try {
    const date = new Date(isoString);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch (_) {
    return '';
  }
};

const scheduleMicrotask = (callback) => {
  if (typeof queueMicrotask === 'function') {
    queueMicrotask(callback);
    return;
  }
  Promise.resolve()
    .then(callback)
    .catch(() => {});
};

export const Chatbox = ({
  className = '',
  chat,
  messages = [],
  isLoading = false,
  isLoadingMore = false,
  hasMore = false,
  error = null,
  websocketStatus = 'idle',
  onLoadMore = () => {},
  onSendMessage = async () => ({ ok: false }),
  onUploadAttachment = async () => ({ ok: false }),
  onDownloadAttachment = async () => ({ ok: false }),
}) => {
  const { userData } = useSession();
  const [composerValue, setComposerValue] = useState('');
  const [sendError, setSendError] = useState(null);
  const [isSending, setIsSending] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState(null);
  const [downloadError, setDownloadError] = useState(null);
  const [downloadingAttachmentKey, setDownloadingAttachmentKey] = useState(null);

  const historyContainerRef = useRef(null);
  const lastMessageIdRef = useRef(null);
  const fileInputRef = useRef(null);
  const activeChatId = chat?.id ?? null;

  const currentUserId = useMemo(() => {
    if (!userData || typeof userData !== 'object') {
      return null;
    }
    return (
      normalizeId(userData.id) ??
      normalizeId(userData.user_id) ??
      normalizeId(userData.iD) ??
      null
    );
  }, [userData]);

  const contactUsername = useMemo(() => {
    if (!chat || chat.isGroup) {
      return null;
    }
    if (typeof chat.contactUsername === 'string' && chat.contactUsername.trim()) {
      return chat.contactUsername.trim();
    }
    if (typeof chat.name === 'string' && chat.name.trim()) {
      return chat.name.trim();
    }
    return null;
  }, [chat]);

  const { avatarSrc: counterpartAvatarSrc, status: counterpartAvatarStatus } = useAvatarImage({
    username: contactUsername,
    skip: !contactUsername,
  });

  const counterpartAvatar = useMemo(() => {
    if (chat && chat.avatarUrl) {
      return chat.avatarUrl;
    }
    return counterpartAvatarSrc || defaultUser;
  }, [chat, counterpartAvatarSrc]);

  const sortedMessages = useMemo(() => {
    if (!Array.isArray(messages)) {
      return [];
    }
    return [...messages].sort((a, b) => {
      const aTs = new Date(a.created_at || a.createdAt || 0).getTime();
      const bTs = new Date(b.created_at || b.createdAt || 0).getTime();
      return aTs - bTs;
    });
  }, [messages]);

  const scrollHistoryToBottom = useCallback(
    (behavior = 'smooth') => {
      scheduleMicrotask(() => {
        const container = historyContainerRef.current;
        if (!container) {
          return;
        }

        const scrollBehavior = behavior === 'smooth' ? 'smooth' : 'auto';
        if (typeof container.scrollTo === 'function') {
          try {
            container.scrollTo({
              top: container.scrollHeight,
              behavior: scrollBehavior,
            });
            return;
          } catch (_) {
            // Ignorar y usar fallback.
          }
        }
        container.scrollTop = container.scrollHeight;
      });
    },
    []
  );

  useEffect(() => {
    if (!sortedMessages.length) {
      lastMessageIdRef.current = null;
      scheduleMicrotask(() => {
        const container = historyContainerRef.current;
        if (container) {
          container.scrollTop = container.scrollHeight;
        }
      });
      return;
    }
    const newestMessage =
      sortedMessages[sortedMessages.length - 1] || undefined;
    const newestId = newestMessage?.message_id ?? newestMessage?.id;

    if (!newestId || lastMessageIdRef.current === newestId) {
      return;
    }

    lastMessageIdRef.current = newestId;
    scrollHistoryToBottom('smooth');
  }, [scrollHistoryToBottom, sortedMessages]);

  useEffect(() => {
    if (!activeChatId) {
      return;
    }
    scrollHistoryToBottom('auto');
  }, [activeChatId, scrollHistoryToBottom]);

  const handleComposerChange = useCallback(
    (event) => {
      if (sendError) {
        setSendError(null);
      }
      setComposerValue(event.target.value);
    },
    [sendError]
  );

  const handleSubmit = useCallback(
    async (event) => {
      event.preventDefault();
      const trimmed = composerValue.trim();
      if (!trimmed || isSending || isUploading) {
        return;
      }

      setIsSending(true);
      setSendError(null);

      try {
        const result = await onSendMessage(trimmed);
        if (!result?.ok) {
          setSendError(result?.error || 'No se pudo enviar el mensaje');
        } else {
          setComposerValue('');
        }
      } catch (error) {
        setSendError(error?.message || 'No se pudo enviar el mensaje');
      } finally {
        setIsSending(false);
      }
    },
    [composerValue, isSending, isUploading, onSendMessage]
  );

  const handleAttachmentButtonClick = useCallback(() => {
    if (isSending || isUploading) {
      return;
    }
    setUploadError(null);
    setDownloadError(null);
    const input = fileInputRef.current;
    if (input && typeof input.click === 'function') {
      input.click();
    }
  }, [isSending, isUploading]);

  const handleFileInputChange = useCallback(
    async (event) => {
      const { files } = event.target;
      const file = files && files[0] ? files[0] : null;
      event.target.value = '';

      if (!file) {
        return;
      }

      if (!isAllowedAttachment(file)) {
        setUploadError(
          'Formato de archivo no permitido. Usa: jpg, jpeg, png, zip, doc, docx, ppt, pptx, xls, xlsx o md.'
        );
        return;
      }

      setUploadError(null);
      setDownloadError(null);
      setIsUploading(true);
      try {
        const result = await onUploadAttachment(file);
        if (!result?.ok) {
          setUploadError(
            result?.error || 'No se pudo subir el archivo adjunto.'
          );
        }
      } catch (error) {
        setUploadError(error?.message || 'No se pudo subir el archivo adjunto.');
      } finally {
        setIsUploading(false);
      }
    },
    [onUploadAttachment]
  );

  const handleAttachmentDownloadClick = useCallback(
    async (attachment, attachmentKey) => {
      if (!attachment || typeof attachment !== 'object') {
        return;
      }
      setDownloadError(null);
      setDownloadingAttachmentKey(attachmentKey);
      try {
        const result = await onDownloadAttachment(attachment);
        if (!result?.ok) {
          setDownloadError(
            result?.error || 'No se pudo descargar el archivo adjunto.'
          );
        }
      } catch (error) {
        setDownloadError(
          error?.message || 'No se pudo descargar el archivo adjunto.'
        );
      } finally {
        setDownloadingAttachmentKey(null);
      }
    },
    [onDownloadAttachment]
  );

  const renderMessage = (message, index) => {
    const messageId = message.message_id ?? message.id;
    const senderId =
      normalizeId(message.user_id) ??
      normalizeId(message.sender_id) ??
      normalizeId(message.author_id);
    const isOwn = currentUserId !== null && senderId === currentUserId;
    const bubbleClass = isOwn ? 'chatbox__message--me' : 'chatbox__message--contact';
    const messageText =
      message.content ??
      message.body ??
      message.text ??
      message.message ??
      '';
    const hasText =
      typeof messageText === 'string'
        ? Boolean(messageText.trim())
        : Boolean(messageText);
    const attachments = Array.isArray(message.attachments)
      ? message.attachments.filter((item) => item && typeof item === 'object')
      : [];

    return (
      <li
        key={messageId ?? `message-${index}`}
        className={`chatbox__message ${bubbleClass}`}
      >
        <span className="chatbox__bubble">
          {hasText && (
            <span className="chatbox__text">
              {typeof messageText === 'string'
                ? messageText
                : String(messageText)}
            </span>
          )}
          {attachments.length > 0 && (
            <ul className="chatbox__attachments">
              {attachments.map((attachment, attachmentIndex) => {
                const attachmentId = extractAttachmentId(attachment);
                const attachmentKey =
                  attachmentId !== null && attachmentId !== undefined
                    ? `${messageId ?? index}-attachment-${attachmentId}`
                    : `${messageId ?? index}-attachment-${attachmentIndex}`;
                const isDownloading =
                  downloadingAttachmentKey === attachmentKey;
                return (
                  <li
                    key={attachmentKey}
                    className="chatbox__attachment"
                  >
                    <button
                      type="button"
                      className="chatbox__attachment-link"
                      onClick={() =>
                        handleAttachmentDownloadClick(
                          attachment,
                          attachmentKey
                        )
                      }
                      disabled={isDownloading}
                    >
                      <span
                        className="chatbox__attachment-icon"
                        aria-hidden="true"
                      >
                        📎
                      </span>
                      <span className="chatbox__attachment-text">
                        {getAttachmentDisplayName(attachment)}
                      </span>
                      {isDownloading && (
                        <span className="chatbox__attachment-status">
                          Descargando...
                        </span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          <span className="chatbox__timestamp">{formatTime(message.created_at || message.createdAt)}</span>
        </span>
      </li>
    );
  };

  const renderHistory = () => {
    if (isLoading && !sortedMessages.length) {
      return <div className="chatbox__placeholder">Cargando conversación...</div>;
    }
    if (error && !sortedMessages.length) {
      return <div className="chatbox__error">{error}</div>;
    }
    if (!sortedMessages.length) {
      return <div className="chatbox__placeholder">Aún no hay mensajes. ¡Saluda!</div>;
    }
    return (
      <ul className="chatbox__messages">
        {hasMore && (
          <li className="chatbox__history-loader">
            <button
              type="button"
              className="chatbox__load-more"
              onClick={onLoadMore}
              disabled={isLoadingMore}
            >
              {isLoadingMore ? 'Cargando...' : 'Ver mensajes anteriores'}
            </button>
          </li>
        )}
        {error && (
          <li className="chatbox__history-error" role="alert">
            {error}
          </li>
        )}
        {sortedMessages.map((message, index) => renderMessage(message, index))}
      </ul>
    );
  };

  return (
    <section
      className={`chatbox ${className}`}
      aria-label={`Ventana de conversación con ${chat?.name || 'contacto'}`}
    >
      <header className="chatbox__header">
        <div className="chatbox__counterpart">
          <img
            className="chatbox__avatar"
            src={counterpartAvatar}
            alt={`Avatar de ${chat?.name || 'contacto'}`}
            aria-busy={
              contactUsername && !chat?.avatarUrl && counterpartAvatarStatus === 'loading'
                ? 'true'
                : undefined
            }
          />
          <div className="chatbox__meta">
            <span className="chatbox__name">{chat?.name || 'Chat'}</span>
            <span className="chatbox__status">
              {websocketStatus === 'open'
                ? 'Conectado'
                : websocketStatus === 'connecting'
                ? 'Conectando...'
                : websocketStatus === 'registering'
                ? 'Registrando...'
                : websocketStatus === 'error'
                ? 'Desconectado'
                : ''}
            </span>
          </div>
        </div>
        <button
          type="button"
          className="chatbox__info-btn"
          title="Ver información del contacto"
        >
          Info.
        </button>
      </header>

      <div
        className="chatbox__history"
        role="log"
        ref={historyContainerRef}
      >
        {renderHistory()}
      </div>

      <form
        className="chatbox__composer"
        aria-label="Enviar mensaje"
        onSubmit={handleSubmit}
      >
        <button
          type="button"
          className="chatbox__action-btn chatbox__action-btn--clip"
          title="Adjuntar archivo"
          onClick={handleAttachmentButtonClick}
          disabled={isSending || isUploading}
          aria-busy={isUploading ? 'true' : 'false'}
        >
          <span aria-hidden="true">{isUploading ? '⏳' : '📎'}</span>
          <span className="sr-only">
            {isUploading ? 'Subiendo archivo...' : 'Adjuntar archivo'}
          </span>
        </button>
        <input
          ref={fileInputRef}
          type="file"
          className="chatbox__file-input"
          accept={ATTACHMENT_ACCEPT}
          onChange={handleFileInputChange}
        />
        <label className="sr-only" htmlFor="chatbox-message">
          Escribe tu mensaje
        </label>
        <input
          id="chatbox-message"
          name="message"
          type="text"
          className="chatbox__input"
          placeholder="Escribe un mensaje..."
          autoComplete="off"
          value={composerValue}
          onChange={handleComposerChange}
          disabled={isSending || isUploading}
        />
        <button
          type="submit"
          className="chatbox__action-btn chatbox__action-btn--send"
          title="Enviar mensaje"
          disabled={isSending || isUploading || !composerValue.trim()}
        >
          <span aria-hidden="true">➤</span>
          <span className="sr-only">Enviar mensaje</span>
        </button>
      </form>
      {(sendError || uploadError || downloadError) && (
        <div className="chatbox__composer-error" role="alert">
          {sendError && <div>{sendError}</div>}
          {uploadError && <div>{uploadError}</div>}
          {downloadError && <div>{downloadError}</div>}
        </div>
      )}
    </section>
  );
};
