const DEFAULT_BACKEND_BASE = 'http://127.0.0.1:8000';
const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB
const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

export const normalizeBackendBase = (value) => {
  const trimmed = (value || '').trim();
  const withProtocol = trimmed
    ? /^https?:\/\//i.test(trimmed)
      ? trimmed
      : `http://${trimmed}`
    : DEFAULT_BACKEND_BASE;
  return withProtocol.replace(/\/+$/, '');
};

export const validateAvatarFile = (file) => {
  if (!file) {
    return { ok: false, error: 'Selecciona un archivo' };
  }
  if (file.size > MAX_FILE_SIZE_BYTES) {
    return { ok: false, error: 'El archivo excede los 5 MB permitidos' };
  }
  if (!ALLOWED_MIME_TYPES.includes(file.type)) {
    return { ok: false, error: 'Formato no permitido. Usa JPG, PNG o WEBP' };
  }
  return { ok: true };
};

const buildAvatarEndpoint = ({ baseUrl, self = false, userId = null }) => {
  const normalizedBase = normalizeBackendBase(baseUrl);
  if (self) {
    return `${normalizedBase}/users/me/avatar`;
  }
  if (userId === null || userId === undefined) {
    throw new Error('Se requiere userId para consultar avatar de otro usuario');
  }
  return `${normalizedBase}/users/${encodeURIComponent(userId)}/avatar`;
};

export const fetchAvatarBlob = async ({ baseUrl, jwt, signal, self = false, userId = null }) => {
  if (!jwt) {
    throw new Error('Falta token de autenticación');
  }

  const endpoint = buildAvatarEndpoint({ baseUrl, self, userId });
  const response = await fetch(endpoint, {
    method: 'GET',
    headers: {
      Accept: 'image/*',
      Authorization: `Bearer ${jwt}`,
    },
    credentials: 'include',
    signal,
  });

  if (response.status === 404) {
    return { ok: false, status: 404 };
  }

  if (!response.ok) {
    const error = new Error(`Fallo al recuperar avatar (HTTP ${response.status})`);
    error.status = response.status;
    throw error;
  }

  const blob = await response.blob();
  return { ok: true, blob, contentType: blob.type || null };
};

export const uploadAvatar = ({ baseUrl, jwt, file, onProgress, signal }) =>
  new Promise((resolve, reject) => {
    if (!jwt) {
      reject(new Error('Falta token de autenticación'));
      return;
    }
    const validation = validateAvatarFile(file);
    if (!validation.ok) {
      reject(new Error(validation.error));
      return;
    }

    const endpoint = buildAvatarEndpoint({ baseUrl, self: true });
    const formData = new FormData();
    formData.append('file', file);

    const xhr = new XMLHttpRequest();
    xhr.open('PUT', endpoint, true);
    xhr.responseType = 'json';
    xhr.setRequestHeader('Authorization', `Bearer ${jwt}`);

    const cleanup = () => {
      if (signal) {
        signal.removeEventListener('abort', abortHandler);
      }
    };

    const abortHandler = () => {
      xhr.abort();
      cleanup();
      reject(new DOMException('Operación cancelada', 'AbortError'));
    };

    if (signal) {
      if (signal.aborted) {
        abortHandler();
        return;
      }
      signal.addEventListener('abort', abortHandler);
    }

    xhr.upload.onprogress = (event) => {
      if (!onProgress || !event.lengthComputable) {
        return;
      }
      const percent = Math.round((event.loaded / event.total) * 100);
      onProgress(percent);
    };

    xhr.onload = () => {
      cleanup();
      if (xhr.status >= 200 && xhr.status < 300) {
        const response = xhr.response ?? safeJsonParse(xhr.responseText);
        resolve(response || {});
      } else {
        const detail =
          xhr.response?.detail ||
          xhr.response?.error ||
          xhr.statusText ||
          'No se pudo actualizar el avatar';
        const error = new Error(detail);
        error.status = xhr.status;
        reject(error);
      }
    };

    xhr.onerror = () => {
      cleanup();
      reject(new Error('Ocurrió un error de red al subir el avatar'));
    };

    xhr.ontimeout = () => {
      cleanup();
      reject(new Error('La subida de avatar tardó demasiado'));
    };

    xhr.send(formData);
  });

export const deleteAvatar = async ({ baseUrl, jwt }) => {
  if (!jwt) {
    throw new Error('Falta token de autenticación');
  }
  const endpoint = buildAvatarEndpoint({ baseUrl, self: true });
  const response = await fetch(endpoint, {
    method: 'DELETE',
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${jwt}`,
    },
    credentials: 'include',
  });

  if (response.status === 404) {
    return { ok: true, status: 404 };
  }

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    const detail =
      payload?.detail ||
      payload?.error ||
      `No se pudo eliminar el avatar (HTTP ${response.status})`;
    const error = new Error(detail);
    error.status = response.status;
    throw error;
  }

  return { ok: true, status: response.status };
};

const safeJsonParse = (value) => {
  if (!value) {
    return null;
  }
  try {
    return JSON.parse(value);
  } catch (_) {
    return null;
  }
};

export const AVATAR_CONSTANTS = {
  MAX_FILE_SIZE_BYTES,
  ALLOWED_MIME_TYPES,
};

