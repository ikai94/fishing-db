// Канонический внешний источник, из которого сервис получает официальную недельную таблицу.
export const RECORDS_SOURCE_URL = 'https://rus-fishsoft.ru/table-records.html';
export const RECORDS_TIME_ZONE = 'Europe/Moscow';

// Версии входят в снимок и заставляют сохранить новый результат после изменения правил разбора
// или сопоставления, даже если сами строки официальной таблицы не изменились.
export const RECORDS_PARSER_VERSION = 1;
export const RECORDS_MAPPING_VERSION = 1;

// Интервал задаёт штатную частоту обновления, а более короткая аренда освобождает синхронизацию,
// если процесс завершился аварийно и не успел снять блокировку.
export const RECORDS_SYNC_INTERVAL_MS = 10 * 60_000;
export const RECORDS_SYNC_LEASE_MS = 2 * 60_000;

// Ограничения внешнего запроса не дают зависшему или неожиданно большому ответу занимать ресурсы API.
export const RECORDS_SOURCE_TIMEOUT_MS = 15_000;
export const RECORDS_SOURCE_MAX_BYTES = 2_000_000;
