import Link from 'next/link';
import styles from '../../catalog.module.css';

const sections = [
  {
    href: '/admin/catalog/bases',
    title: 'Рыболовные базы и локации',
    description: 'Создание, редактирование и активация баз и их локаций.',
  },
  {
    href: '/admin/catalog/fish',
    title: 'Рыбы',
    description: 'Глобальный каталог рыб и управление их активностью.',
  },
  {
    href: '/admin/catalog/baits',
    title: 'Наживки и приманки',
    description: 'Каталог наживок и искусственных приманок.',
  },
  {
    href: '/admin/catalog/screen-anchors',
    title: 'Ориентиры экрана',
    description: 'Подсказки для точного ввода позиции при ловле.',
  },
];

export default function AdminCatalogPage() {
  return (
    <>
      <header className={styles.header}>
        <p className={styles.eyebrow}>Администрирование</p>
        <h1 className={styles.title}>Игровой каталог</h1>
        <p className={styles.subtitle}>
          Управляйте только фактами игрового каталога. Пользовательские отчёты сюда не входят.
        </p>
      </header>

      <section className={styles.grid}>
        {sections.map((section) => (
          <Link className={styles.card} href={section.href} key={section.href}>
            <h2 className={styles.cardTitle}>{section.title}</h2>
            <p className={styles.muted}>{section.description}</p>
          </Link>
        ))}
      </section>
    </>
  );
}
