'use client';

import Link from 'next/link';
import { useCallback, useEffect, useId, useState } from 'react';
import accordion from '@/components/spot-analytics/spot-analytics.module.css';
import { getCurrentUser } from '@/lib/auth-api';
import { getApiErrorMessage, isApiError } from '@/lib/api-client';
import {
  getFishPersonalNotes,
  type FishPersonalNotes as Notes,
} from '@/lib/base-fish-notebook-api';
import { useApiResource } from '@/lib/use-api-resource';
import styles from './fish-personal-notes.module.css';

/** Дополняет публичную страницу приватным аккордеоном только для действующего ADMIN. */
export function FishPersonalNotes({ fishId }: { fishId: string }) {
  const loadUser = useCallback((signal: AbortSignal) => getCurrentUser(signal), []);
  const { state: user } = useApiResource(loadUser, 'Не удалось проверить доступ к блокноту.');
  const [expanded, setExpanded] = useState(false);
  const [denied, setDenied] = useState(false);
  const headingId = useId();
  const denyAccess = useCallback(() => setDenied(true), []);

  if (user.kind !== 'ready' || user.data.role !== 'ADMIN' || user.data.isBanned || denied)
    return null;

  return (
    <section className={accordion.section} aria-labelledby={headingId}>
      <details onToggle={(event) => setExpanded(event.currentTarget.open)}>
        <summary className={accordion.summary}>
          <span className={accordion.title} id={headingId} role="heading" aria-level={2}>
            Личные заметки
          </span>
        </summary>
        {expanded ? (
          <NotesTable key={`${user.data.id}:${fishId}`} fishId={fishId} onDenied={denyAccess} />
        ) : null}
      </details>
    </section>
  );
}

/** Загружает данные при раскрытии; закрытие отменяет запрос и удаляет личные данные из UI. */
function NotesTable({ fishId, onDenied }: { fishId: string; onDenied: () => void }) {
  const [notes, setNotes] = useState<Notes | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    void getFishPersonalNotes(fishId, controller.signal)
      .then((data) => {
        // Ответ закрытого раздела или предыдущей рыбы не переносится в новый запрос.
        if (!controller.signal.aborted) setNotes(data);
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        if (isApiError(err) && (err.status === 401 || err.status === 403)) onDenied();
        else setError(getApiErrorMessage(err, 'Не удалось загрузить личные заметки.'));
      });
    return () => controller.abort();
  }, [fishId, attempt, onDenied]);

  return (
    <div className={accordion.content}>
      {error ? (
        <div className={`${accordion.status} ${accordion.error}`} role="alert">
          <p>{error}</p>
          <button
            type="button"
            className={accordion.button}
            onClick={() => {
              setError(null);
              setAttempt((value) => value + 1);
            }}
          >
            Повторить
          </button>
        </div>
      ) : notes === null ? (
        <p className={accordion.status} role="status">
          Загружаем личные заметки…
        </p>
      ) : notes.rows.length === 0 ? (
        <p className={accordion.status}>Нет связанных баз.</p>
      ) : (
        <div className={styles.tableRegion}>
          <table className={styles.table} aria-label="Личные заметки по базам">
            <thead>
              <tr>
                <th scope="col">База</th>
                <th scope="col">Заметка</th>
              </tr>
            </thead>
            <tbody>
              {notes.rows.map(({ base, noteText }) => (
                <tr key={base.id}>
                  <th scope="row">
                    <Link
                      className={accordion.tableLink}
                      href={`/bases/${encodeURIComponent(base.id)}`}
                    >
                      {base.name}
                    </Link>
                  </th>
                  <td className={styles.note}>
                    {noteText?.trim() ? (
                      noteText
                    ) : (
                      <span className={accordion.muted}>Нет заметки</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
