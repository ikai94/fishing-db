'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import styles from './application-shell.module.css';
import { ShellIcon } from './shell-icon';

const navigationItems = [
  { href: '/', icon: 'home', label: 'Главная', isActive: (pathname: string) => pathname === '/' },
  {
    href: '/bases',
    icon: 'bases',
    label: 'Базы и локации',
    isActive: (pathname: string) =>
      pathname === '/bases' || pathname.startsWith('/bases/') || pathname.startsWith('/locations/'),
  },
  {
    href: '/fish',
    icon: 'fish',
    label: 'Рыбы',
    isActive: (pathname: string) => pathname === '/fish' || pathname.startsWith('/fish/'),
  },
  {
    href: '/catches/new',
    icon: 'addCatch',
    label: 'Добавить рыбу',
    isActive: (pathname: string) => pathname === '/catches/new',
  },
  {
    href: '/baits',
    icon: 'bait',
    label: 'Наживки',
    isActive: (pathname: string) => pathname === '/baits' || pathname.startsWith('/baits/'),
  },
] as const;

export function SidebarNavigation() {
  const pathname = usePathname();

  return (
    <nav className={styles.navigation} aria-label="Основная навигация">
      <ul className={styles.navigationList}>
        {navigationItems.map((item) => {
          const active = item.isActive(pathname);

          return (
            <li key={item.href}>
              <Link
                aria-current={active ? 'page' : undefined}
                className={`${styles.navigationLink} ${active ? styles.navigationLinkActive : ''}`}
                href={item.href}
              >
                <span className={styles.navigationIcon}>
                  <ShellIcon name={item.icon} />
                </span>
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
