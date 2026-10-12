'use client';

import Link from 'next/link';
import styles from './base-notebook-link.module.css';

/** Страница проверяет ADMIN один раз; ссылка не создаёт отдельный запрос авторизации для каждой базы. */
export function BaseNotebookLink({ baseId, allowed }: { baseId: string; allowed: boolean }) {
  if (!allowed) return null;
  return (
    <Link
      className={styles.link}
      href={`/bases/${baseId}/notebook`}
      prefetch={false}
      aria-label="Блокнот рыб базы"
      title="Блокнот рыб базы"
    >
      <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        aria-hidden="true"
      >
        <rect x="5" y="3" width="15" height="18" rx="2" />
        <path d="M9 3v18M3 7h4M3 12h4M3 17h4M12 8h5M12 12h5" />
      </svg>
    </Link>
  );
}
