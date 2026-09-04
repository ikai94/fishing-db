import styles from '../page.module.css';
import { formatCompactWeight } from '@/lib/base-fish-weight';
import type { ActivityCatalogItem, ActivityEvent } from '@/lib/activity-api';

function catalogKind(item: ActivityCatalogItem): string {
  if (item.kind === 'FISHING_BASE') return 'база';
  if (item.kind === 'LOCATION') return 'локация';
  if (item.kind === 'FISH') return 'рыба';
  return 'type' in item && item.type === 'BAIT' ? 'наживка' : 'приманка';
}

export function activityText(event: ActivityEvent): string {
  if (event.type === 'CATCH_REPORT_CREATED') {
    const { report } = event.data;
    return `${event.actor.nickname}: добавлен улов — ${report.fish.name}, ${formatCompactWeight(report.weightGrams)}, ${report.fishingBase.name}, ${report.location.number}. ${report.location.name}.`;
  }
  if (event.type === 'CATCH_REPORT_UPDATED') {
    return `${event.actor.nickname}: изменена запись об улове «${event.data.report.fish.name}».`;
  }
  if (event.type === 'CATCH_REPORT_DELETED') {
    return `${event.actor.nickname}: удалена запись об улове «${event.data.report.fish.name}».`;
  }
  if (event.type === 'CATCH_REPORT_BATCH_CREATED') {
    return `${event.actor.nickname}: добавлено уловов — ${event.data.createdCount}.`;
  }
  if (event.type === 'CATALOG_ITEM_CREATED') {
    return `Администрация: в каталог добавлена ${catalogKind(event.data.item)} «${event.data.item.name}».`;
  }
  if (event.type === 'CATALOG_ITEM_UPDATED') {
    return `Администрация: обновлена ${catalogKind(event.data.item)} «${event.data.item.name}».`;
  }
  if (event.type === 'FISHING_BASE_FISH_ADDED') {
    return `Администрация: на базе «${event.data.membership.fishingBase.name}» добавлена рыба «${event.data.membership.fish.name}».`;
  }
  if (event.type === 'FISHING_BASE_FISH_UPDATED') {
    return `Администрация: обновлены весовые границы рыбы «${event.data.membership.fish.name}» на базе «${event.data.membership.fishingBase.name}».`;
  }
  if (event.type === 'FISHING_BASE_FISH_REMOVED') {
    return `Администрация: с базы «${event.data.membership.fishingBase.name}» убрана рыба «${event.data.membership.fish.name}».`;
  }
  throw new Error('Неизвестный тип события активности');
}

export function formatActivityDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Moscow',
  }).format(date);
}

export function RecentActivityList({ events }: { events: readonly ActivityEvent[] }) {
  return (
    <ol className={styles.activityList} aria-label="Десять последних действий на сайте">
      {events.map((event) => (
        <li className={styles.activityItem} key={event.id}>
          <span>{activityText(event)}</span>
          <time className={styles.activityDate} dateTime={event.occurredAt}>
            {formatActivityDate(event.occurredAt)}
          </time>
        </li>
      ))}
    </ol>
  );
}
