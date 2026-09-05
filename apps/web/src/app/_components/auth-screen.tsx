import type { ReactNode } from 'react';
import { ApplicationShell } from '@/components/application-shell/application-shell';
import styles from '../auth.module.css';

type AuthScreenProps = {
  eyebrow: string;
  title: string;
  description: string;
  children: ReactNode;
};

export function AuthScreen({ eyebrow, title, description, children }: AuthScreenProps) {
  return (
    <ApplicationShell>
      <div className={styles.screen}>
        <section className={styles.panel} aria-labelledby="auth-screen-title">
          <header className={styles.header}>
            <p className={styles.eyebrow}>{eyebrow}</p>
            <h1 className={styles.title} id="auth-screen-title">
              {title}
            </h1>
            <p className={styles.description}>{description}</p>
          </header>
          {children}
        </section>
      </div>
    </ApplicationShell>
  );
}
