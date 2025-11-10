import { useEffect, useMemo, useRef, useState } from 'react';
import { useSession } from '../context/sessionContext';
import { fetchAvatarBlob, normalizeBackendBase } from '../services/avatarService';

const objectUrlCache = new Map();

const buildCacheKey = ({ self, userId }) => {
  if (self) {
    return 'self';
  }
  if (userId === null || userId === undefined) {
    return null;
  }
  return `user:${userId}`;
};

const revokeObjectUrl = (url) => {
  if (!url) {
    return;
  }
  URL.revokeObjectURL(url);
};

const isAbsoluteUrl = (value) => /^https?:\/\//i.test(value);

export const useAvatarImage = ({
  userId = null,
  fetchSelf = false,
  initialUrl = null,
  skip = false,
} = {}) => {
  const { jwt, browserUrl } = useSession();
  const [objectUrl, setObjectUrl] = useState(null);
  const [status, setStatus] = useState(() => (skip ? 'idle' : 'pending'));
  const [error, setError] = useState(null);

  const abortRef = useRef(null);
  const localUrlRef = useRef(null);
  const lastInitialUrlRef = useRef(initialUrl);

  const baseUrl = useMemo(() => normalizeBackendBase(browserUrl), [browserUrl]);
  const cacheKey = useMemo(() => buildCacheKey({ self: fetchSelf, userId }), [fetchSelf, userId]);

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

      if (localUrlRef.current) {
        revokeObjectUrl(localUrlRef.current);
        localUrlRef.current = null;
      }

      if (cacheKey) {
        const cached = objectUrlCache.get(cacheKey);
        if (cached) {
          revokeObjectUrl(cached);
          objectUrlCache.delete(cacheKey);
        }
      }

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

    if (!fetchSelf && (userId === null || userId === undefined)) {
      return;
    }

    if (status !== 'pending' && status !== 'reload') {
      return;
    }

    if (status !== 'reload' && cacheKey) {
      const cachedUrl = objectUrlCache.get(cacheKey);
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
        });

        if (!isActive) {
          return;
        }

        if (!result.ok) {
          if (result.status === 404) {
            setObjectUrl(null);
            setStatus('not-found');
            if (cacheKey) {
              objectUrlCache.delete(cacheKey);
            }
          }
          return;
        }

        const newObjectUrl = URL.createObjectURL(result.blob);
        if (cacheKey) {
          const existingUrl = objectUrlCache.get(cacheKey);
          if (existingUrl && existingUrl !== newObjectUrl) {
            revokeObjectUrl(existingUrl);
          }
          objectUrlCache.set(cacheKey, newObjectUrl);
        }

        if (localUrlRef.current && localUrlRef.current !== newObjectUrl) {
          revokeObjectUrl(localUrlRef.current);
        }
        localUrlRef.current = newObjectUrl;
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
  }, [baseUrl, cacheKey, fetchSelf, jwt, skip, status, userId]);

  useEffect(() => {
    return () => {
      if (abortRef.current) {
        abortRef.current.abort();
        abortRef.current = null;
      }
      if (localUrlRef.current) {
        revokeObjectUrl(localUrlRef.current);
        localUrlRef.current = null;
      }
    };
  }, []);

  const refetch = useMemo(
    () => () => {
      if (localUrlRef.current) {
        revokeObjectUrl(localUrlRef.current);
        localUrlRef.current = null;
      }
      if (cacheKey) {
        const cached = objectUrlCache.get(cacheKey);
        if (cached) {
          revokeObjectUrl(cached);
          objectUrlCache.delete(cacheKey);
        }
      }
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
