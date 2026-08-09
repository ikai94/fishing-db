'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { getApiErrorMessage, isApiError } from './api-client';
import { type AuthUser, getCurrentUser } from './auth-api';

export type RequiredUserState =
  { kind: 'loading' } | { kind: 'ready'; user: AuthUser } | { kind: 'error'; message: string };

export function useRequiredUser(): {
  state: RequiredUserState;
  reload: () => void;
} {
  const router = useRouter();
  const [state, setState] = useState<RequiredUserState>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();

    async function loadUser() {
      try {
        const user = await getCurrentUser(controller.signal);
        setState({ kind: 'ready', user });
      } catch (error) {
        if (controller.signal.aborted) {
          return;
        }

        if (isApiError(error) && error.status === 401) {
          router.replace('/login');
          return;
        }

        setState({
          kind: 'error',
          message: getApiErrorMessage(
            error,
            'Не удалось проверить аккаунт. Проверьте соединение и попробуйте снова.',
          ),
        });
      }
    }

    void loadUser();
    return () => controller.abort();
  }, [attempt, router]);

  const reload = useCallback(() => {
    setState({ kind: 'loading' });
    setAttempt((current) => current + 1);
  }, []);

  return { state, reload };
}
