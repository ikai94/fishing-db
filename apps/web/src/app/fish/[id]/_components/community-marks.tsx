'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import styles from './community-marks.module.css';
import common from '../../../public-catalog.module.css';
import { getCurrentUser, type AuthUser } from '@/lib/auth-api';
import { getApiErrorMessage, isApiError } from '@/lib/api-client';
import {
  getCommunityCounts,
  getMyCommunityMarks,
  setCommunityMark,
  getCommunityVoters,
  type CommunityCount,
  type CommunityMark,
  type VotersPage,
} from '@/lib/fish-community-api';

const GROUPS: { label: string; options: { mark: CommunityMark; label: string }[] }[] = [
  {
    label: 'Способ ловли',
    options: [
      { mark: 'BOTTOM', label: 'Дно' },
      { mark: 'MIDWATER', label: 'Середина' },
      { mark: 'FLY', label: 'Нахлыст' },
    ],
  },
  {
    label: 'Время активности',
    options: [
      { mark: 'NIGHT', label: 'Ночь' },
      { mark: 'TWILIGHT', label: 'Утро/вечер' },
      { mark: 'DAY', label: 'День' },
      { mark: 'ALL_DAY', label: 'Круглосуточно' },
    ],
  },
];

/** Показывает независимые отметки всей рыбы, без привязки к фильтру баз. */
export function CommunityMarks({ fishId }: { fishId: string }) {
  const [counts, setCounts] = useState<CommunityCount[] | null>(null);
  const [mine, setMine] = useState<CommunityMark[]>([]);
  const [user, setUser] = useState<AuthUser | null | undefined>(undefined);
  const [pending, setPending] = useState<CommunityMark | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [opened, setOpened] = useState<{ mark: CommunityMark; label: string } | null>(null);
  const controllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    controllerRef.current = controller;
    // Публичные счётчики не зависят от доступности проверки сессии.
    void getCommunityCounts(fishId, controller.signal)
      .then((items) => {
        if (!controller.signal.aborted) setCounts(items);
      })
      .catch((err: unknown) => {
        if (!controller.signal.aborted)
          setError(getApiErrorMessage(err, 'Не удалось загрузить отметки.'));
      });
    void (async () => {
      try {
        const actor = await getCurrentUser(controller.signal);
        const own = await getMyCommunityMarks(fishId, controller.signal);
        if (!controller.signal.aborted) {
          setUser(actor);
          setMine(own);
        }
      } catch (err) {
        if (controller.signal.aborted) return;
        if (isApiError(err) && err.status === 401) setUser(null);
        else setError(getApiErrorMessage(err, 'Не удалось проверить ваши отметки.'));
      }
    })();
    return () => controller.abort();
  }, [fishId, attempt]);

  /** Меняет локальную подсветку только после успешной серверной записи. */
  async function toggle(mark: CommunityMark) {
    const controller = controllerRef.current;
    if (!user || pending || !controller || controller.signal.aborted) return;
    const enabled = !mine.includes(mark);
    setPending(mark);
    setError(null);
    try {
      await setCommunityMark(fishId, mark, enabled, controller.signal);
      if (controller.signal.aborted) return;
      setMine((current) =>
        enabled ? [...current, mark] : current.filter((value) => value !== mark),
      );
      setOpened(null);
      const nextCounts = await getCommunityCounts(fishId, controller.signal);
      if (!controller.signal.aborted) setCounts(nextCounts);
    } catch (err) {
      if (!controller.signal.aborted)
        setError(getApiErrorMessage(err, 'Не удалось изменить отметку.'));
    } finally {
      if (!controller.signal.aborted) setPending(null);
    }
  }

  return (
    <section className={common.resultsRegion} aria-label="Знания сообщества">
      <h2 className={common.sectionTitle}>Знания сообщества</h2>
      {counts === null ? (
        <p role="status">Загружаем отметки…</p>
      ) : (
        <div className={styles.groups}>
          {GROUPS.map((group) => (
            <div className={styles.group} role="group" aria-label={group.label} key={group.label}>
              <span className={styles.label}>{group.label}</span>
              {group.options.map((option) => (
                <span className={styles.chip} key={option.mark}>
                  <button
                    type="button"
                    aria-pressed={mine.includes(option.mark)}
                    disabled={!user || user.isBanned || pending !== null}
                    onClick={() => void toggle(option.mark)}
                  >
                    {option.label}
                  </button>
                  <button
                    type="button"
                    aria-label={`Кто отметил «${option.label}»`}
                    aria-expanded={opened?.mark === option.mark}
                    onClick={() => setOpened(opened?.mark === option.mark ? null : option)}
                  >
                    {counts.find((item) => item.mark === option.mark)?.count ?? 0}
                  </button>
                </span>
              ))}
            </div>
          ))}
        </div>
      )}
      {user === null ? (
        <p className={common.metadata}>
          <Link href="/login">Войдите</Link>, чтобы добавить отметки.
        </p>
      ) : null}
      {user?.isBanned ? (
        <p className={common.metadata}>
          Заблокированный аккаунт может только просматривать отметки.
        </p>
      ) : null}
      {error ? (
        <p role="alert">
          {error}{' '}
          <button
            type="button"
            onClick={() => {
              setError(null);
              setAttempt((value) => value + 1);
            }}
          >
            Повторить
          </button>
        </p>
      ) : null}
      {opened ? (
        <CommunityVoters
          key={opened.mark}
          fishId={fishId}
          mark={opened.mark}
          label={opened.label}
          onClose={() => setOpened(null)}
        />
      ) : null}
    </section>
  );
}

/** Лениво загружает никнеймы и отменяет ответ закрытого списка. */
function CommunityVoters({
  fishId,
  mark,
  label,
  onClose,
}: {
  fishId: string;
  mark: CommunityMark;
  label: string;
  onClose: () => void;
}) {
  const [page, setPage] = useState<VotersPage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [cursor, setCursor] = useState<string | undefined>();
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    void getCommunityVoters(fishId, mark, cursor, controller.signal)
      .then((next) => {
        if (!controller.signal.aborted) {
          setPage((current) => ({
            items: [...(cursor ? (current?.items ?? []) : []), ...next.items],
            nextCursor: next.nextCursor,
          }));
          setLoading(false);
        }
      })
      .catch((err: unknown) => {
        if (!controller.signal.aborted) {
          setError(getApiErrorMessage(err, 'Не удалось загрузить участников.'));
          setLoading(false);
        }
      });
    return () => controller.abort();
  }, [fishId, mark, cursor, attempt]);
  return (
    <div className={styles.voters} role="region" aria-label={`Участники: ${label}`}>
      <strong>{label}</strong>{' '}
      <button type="button" onClick={onClose}>
        Закрыть
      </button>
      {page ? (
        <>
          {page.items.length ? (
            <ul>
              {page.items.map((item, index) => (
                <li key={index}>{item.nickname}</li>
              ))}
            </ul>
          ) : (
            <p>Пока никто не отметил.</p>
          )}
          {page.nextCursor && !error ? (
            <button
              type="button"
              disabled={loading}
              onClick={() => {
                setLoading(true);
                setError(null);
                setCursor(page.nextCursor ?? undefined);
              }}
            >
              Ещё участники
            </button>
          ) : null}
        </>
      ) : null}
      {(!page && !error) || loading ? <p role="status">Загружаем участников…</p> : null}
      {error ? (
        <p role="alert">
          {error}{' '}
          <button
            type="button"
            onClick={() => {
              setError(null);
              setAttempt((value) => value + 1);
            }}
          >
            Повторить
          </button>
        </p>
      ) : null}
    </div>
  );
}
