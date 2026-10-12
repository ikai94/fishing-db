import Link from 'next/link';
import { cookies } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { ApplicationShell } from '@/components/application-shell/application-shell';
import { isApiError } from '@/lib/api-client';
import { getBaseFishNotebook } from '@/lib/base-fish-notebook-api';
import { NotebookTable } from './notebook-table';
import styles from './notebook.module.css';

// Cookie и no-store исключают статическую генерацию и общий кеш приватного блокнота.
export const dynamic = 'force-dynamic';

/** Сервер допускает к странице только после успешного запроса API с AuthGuard и AdminGuard. */
export default async function BaseFishNotebookPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = (await cookies()).get('fishing_session');
  if (!session) redirect('/login');
  const { id } = await params;
  const notebook = await getBaseFishNotebook(id, {
    headers: { Cookie: `fishing_session=${session.value}` },
  }).catch((error: unknown) => {
    if (isApiError(error) && error.status === 401) redirect('/login');
    if (isApiError(error) && (error.status === 403 || error.status === 404)) notFound();
    throw error;
  });

  return (
    <ApplicationShell>
      <div className={styles.page}>
        <nav aria-label="Навигация по разделу">
          <Link href={`/bases/${notebook.base.id}`}>{notebook.base.name}</Link>
        </nav>
        <h1>Блокнот рыб — {notebook.base.name}</h1>
        <p>
          Личные заметки видны только вам. Сохранение и отмена работают для каждой рыбы отдельно.
        </p>
        {notebook.rows.length === 0 ? (
          <p>Для этой базы пока не указаны рыбы.</p>
        ) : (
          <NotebookTable notebook={notebook} />
        )}
      </div>
    </ApplicationShell>
  );
}
