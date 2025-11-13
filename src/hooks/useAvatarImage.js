import { useEffect, useMemo, useRef, useState } from 'react';
import { useSession } from '../context/sessionContext';
import { fetchAvatarBlob, normalizeBackendBase } from '../services/avatarService';

const objectUrlCache = new Map();

const getCachedUrl = (cacheKey) => {
  if (!cacheKey) {
    return null;
  }
  const entry = objectUrlCache.get(cacheKey);
  return entry ? entry.url : null;
};

const setCachedUrl = (cacheKey, url, { fromObjectUrl = false } = {}) => {
  if (!cacheKey || !url) {
    return;
  }
  const previous = objectUrlCache.get(cacheKey);
  if (previous && previous.url === url) {
    if (fromObjectUrl && !previous.fromObjectUrl) {
      objectUrlCache.set(cacheKey, { url, fromObjectUrl });
    }
    return;
  }
  if (previous && previous.fromObjectUrl && previous.url && previous.url !== url) {
    revokeObjectUrl(previous.url);
  }
  objectUrlCache.set(cacheKey, { url, fromObjectUrl });
};

const clearCachedUrl = (cacheKey) => {
  if (!cacheKey) {
    return;
  }
  const entry = objectUrlCache.get(cacheKey);
  if (entry && entry.fromObjectUrl && entry.url) {
    revokeObjectUrl(entry.url);
  }
  objectUrlCache.delete(cacheKey);
};

const normalizeUsername = (value) => {
  if (typeof value !== 'string') {
    return '';
  }
  return value.trim();
};

const buildCacheKey = ({ self, userId, username }) => {
  if (self) {
    return 'self';
  }
  if (userId === null || userId === undefined) {
    const normalizedUsername = normalizeUsername(username);
    if (!normalizedUsername) {
      return null;
    }
    return `username:${normalizedUsername.toLowerCase()}`;
  }
  return `user:${userId}`;
};

function revokeObjectUrl(url) {
  if (!url) {
    return;
  }
  URL.revokeObjectURL(url);
}

const isAbsoluteUrl = (value) => /^https?:\/\//i.test(value);

export const useAvatarImage = ({
  userId = null,
  username = null,
  fetchSelf = false,
  initialUrl = null,
  skip = false,
} = {}) => {
  const { jwt, browserUrl } = useSession();
  const [objectUrl, setObjectUrl] = useState(null);
  const [status, setStatus] = useState(() => (skip ? 'idle' : 'pending'));
  const [error, setError] = useState(null);

  const abortRef = useRef(null);
  const lastInitialUrlRef = useRef(initialUrl);

  const baseUrl = useMemo(() => normalizeBackendBase(browserUrl), [browserUrl]);
  const cacheKey = useMemo(
    () => buildCacheKey({ self: fetchSelf, userId, username }),
    [fetchSelf, userId, username]
  );

  const directAbsoluteUrl = useMemo(() => {
    const raw = typeof initialUrl === 'string' ? initialUrl.trim() : '';
    if (!raw) {
      return null;
    }
    if (isAbsoluteUrl(raw)) {
      return raw;
    }
    return null;
  }, [initialUrl]);

  useEffect(() => {
    if (skip) {
      return;
    }
    if (!jwt) {
      return;
    }
    setStatus((prev) => {
      if (prev === 'idle') {
        return 'pending';
      }
      return prev;
    });
  }, [jwt, skip]);

  useEffect(() => {
    if (initialUrl !== lastInitialUrlRef.current) {
      lastInitialUrlRef.current = initialUrl;

      clearCachedUrl(cacheKey);

      setObjectUrl(null);
      if (!skip) {
        setStatus('pending');
      }
      setError(null);
    }
  }, [cacheKey, initialUrl, skip]);

  useEffect(() => {
    if (skip || !jwt) {
      setStatus((prev) => {
        if (prev === 'loaded' || prev === 'not-found') {
          return prev;
        }
        return 'idle';
      });
      return;
    }

    const normalizedUsername = normalizeUsername(username);
    if (
      !fetchSelf &&
      (userId === null || userId === undefined) &&
      !normalizedUsername
    ) {
      return;
    }

    if (status !== 'pending' && status !== 'reload') {
      return;
    }

    if (status !== 'reload' && cacheKey) {
      const cachedUrl = getCachedUrl(cacheKey);
      if (cachedUrl) {
        setObjectUrl(cachedUrl);
        setStatus('loaded');
        setError(null);
        return;
      }
    }

    let isActive = true;
    const controller = new AbortController();
    abortRef.current = controller;
    setStatus('loading');
    setError(null);

    const run = async () => {
      try {
        const result = await fetchAvatarBlob({
          baseUrl,
          jwt,
          signal: controller.signal,
          self: fetchSelf,
          userId,
          username: normalizeUsername(username),
        });

        if (!isActive) {
          return;
        }

        if (!result.ok) {
          if (result.status === 404) {
            setObjectUrl(null);
            setStatus('not-found');
            clearCachedUrl(cacheKey);
          }
          return;
        }

        const newObjectUrl = URL.createObjectURL(result.blob);
        setCachedUrl(cacheKey, newObjectUrl, { fromObjectUrl: true });
        setObjectUrl(newObjectUrl);
        setStatus('loaded');
        setError(null);
      } catch (requestError) {
        if (!isActive && requestError.name !== 'AbortError') {
          return;
        }
        if (requestError.name === 'AbortError') {
          return;
        }
        setError(requestError);
        setStatus('error');
      }
    };

    run();

    return () => {
      isActive = false;
      controller.abort();
      if (abortRef.current === controller) {
        abortRef.current = null;
      }
    };
  }, [baseUrl, cacheKey, fetchSelf, jwt, skip, status, userId, username]);

  useEffect(() => {
    return () => {
      if (abortRef.current) {
        abortRef.current.abort();
        abortRef.current = null;
      }
    };
  }, []);

  const refetch = useMemo(
    () => () => {
      clearCachedUrl(cacheKey);
      setObjectUrl(null);
      setStatus('reload');
      setError(null);
    },
    [cacheKey]
  );

  const avatarSrc = useMemo(() => {
    if (objectUrl) {
      return objectUrl;
    }
    return directAbsoluteUrl;
  }, [directAbsoluteUrl, objectUrl]);

  return {
    avatarSrc,
    status,
    isLoading: status === 'loading' || status === 'pending' || status === 'reload',
    error,
    refetch,
  };
};
