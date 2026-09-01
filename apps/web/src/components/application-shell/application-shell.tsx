import type { ReactNode } from 'react';
import styles from './application-shell.module.css';
import { ShellIcon } from './shell-icon';
import { SidebarNavigation } from './sidebar-navigation';
import { SidebarStatistics } from './sidebar-statistics';
import { UserHeader } from './user-header';

type ApplicationShellProps = { children: ReactNode };

export function ApplicationShell({ children }: ApplicationShellProps) {
  return (
    <div className={styles.shell}>
      <a className={styles.skipLink} href="#main-content">
        К содержанию
      </a>
      <aside className={styles.sidebar} aria-label="Боковая панель">
        <div className={styles.brand}>
          <span className={styles.brandMark}>
            <ShellIcon name="fish" />
          </span>
          <span>РЫБНАЯ БАЗА</span>
        </div>
        <SidebarNavigation />
        <SidebarStatistics />
      </aside>

      <div className={styles.workspace}>
        <header className={styles.topbar}>
          <div className={styles.userDock}>
            <UserHeader />
          </div>
        </header>
        <main className={styles.main} id="main-content" tabIndex={-1}>
          {children}
        </main>
      </div>
    </div>
  );
}
