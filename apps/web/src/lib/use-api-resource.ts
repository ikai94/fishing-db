'use client';

import { useCallback, useEffect, useState } from 'react';
import { getApiErrorMessage, isApiError } from './api-client';

export type ApiResourceState<T> =
  | { kind: 'loading' }
  | { kind: 'ready'; data: T }
  | { kind: 'not-found' }
  | { kind: 'error'; message: string };

export function useApiResource<T>(
  loader: (signal: AbortSignal) => Promise<T>,
  fallbackMessage: string,
): { state: ApiResourceState<T>; reload: () => void } {
  const [state, setState] = useState<ApiResourceState<T>>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();

    async function load() {
      try {
        const data = await loader(controller.signal);
        setState({ kind: 'ready', data });
      } catch (error) {
        if (controller.signal.aborted) {
          return;
        }

        if (isApiError(error) && error.status === 404) {
          setState({ kind: 'not-found' });
          return;
        }

        setState({ kind: 'error', message: getApiErrorMessage(error, fallbackMessage) });
      }
    }

    void load();
    return () => controller.abort();
  }, [attempt, fallbackMessage, loader]);

  const reload = useCallback(() => {
    setState({ kind: 'loading' });
    setAttempt((current) => current + 1);
  }, []);

  return { state, reload };
}
