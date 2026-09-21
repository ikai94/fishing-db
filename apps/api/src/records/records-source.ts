import { createHash } from 'node:crypto';
import * as cheerio from 'cheerio';
import {
  RECORDS_SOURCE_MAX_BYTES,
  RECORDS_SOURCE_TIMEOUT_MS,
  RECORDS_SOURCE_URL,
} from './records.constants.js';

export type OfficialRecordSourceRow = {
  fishName: string;
  fishPath: string;
  imageKey: number;
  weightGrams: number;
  waterbody: string;
  playerName: string;
  caughtAt: Date;
  caughtAtRaw: string;
};

export type ParsedOfficialRecords = { rows: OfficialRecordSourceRow[]; sourceHash: string };

/** Приводит текст HTML к устойчивому виду, не меняя значимые буквы и пунктуацию. */
function compactText(value: string): string {
  return value.normalize('NFKC').trim().replace(/\s+/gu, ' ');
}

/**
 * Разбирает официальный вес в целое число граммов без операций с плавающей точкой.
 * Дробная часть килограммов трактуется как десятичные доли до тысячных, а дробные граммы
 * отклоняются, поскольку модель хранит только точные положительные граммы.
 */
export function parseOfficialRecordWeight(value: string): number {
  const normalized = compactText(value).toLocaleLowerCase('ru-RU');
  const match = /^(\d+(?:[,.]\d{1,3})?)\s*(гр|г|кг)$/u.exec(normalized);
  if (match === null) throw new Error(`Invalid record weight: ${value}`);
  const amount = match[1];
  const unit = match[2];
  if (amount === undefined || unit === undefined) throw new Error('Invalid record weight');
  let grams: number;
  if (unit === 'кг') {
    const [whole = '', fraction = ''] = amount.replace(',', '.').split('.');

    // Дополнение справа сохраняет десятичный смысл: 1,5 кг становится 1500 г, а не 1005 г.
    grams = Number(whole) * 1_000 + Number(fraction.padEnd(3, '0'));
  } else {
    if (/[,.]/u.test(amount)) throw new Error(`Fractional grams are not supported: ${value}`);
    grams = Number(amount);
  }
  if (!Number.isSafeInteger(grams) || grams <= 0 || grams > 2_147_483_647) {
    throw new Error(`Record weight is out of range: ${value}`);
  }
  return grams;
}

/**
 * Разбирает московское время источника и возвращает абсолютный момент в UTC.
 * Обратная проверка календарных компонентов отсекает автоматическую нормализацию JavaScript
 * вроде несуществующего 31 февраля.
 */
export function parseOfficialRecordDate(value: string): Date {
  const raw = compactText(value);
  const match = /^(\d{2})\.(\d{2})\.(\d{4}) (\d{2}):(\d{2})$/u.exec(raw);
  if (match === null) throw new Error(`Invalid record date: ${value}`);
  const [, dayRaw, monthRaw, yearRaw, hourRaw, minuteRaw] = match;
  const day = Number(dayRaw);
  const month = Number(monthRaw);
  const year = Number(yearRaw);
  const hour = Number(hourRaw);
  const minute = Number(minuteRaw);

  // Официальная таблица публикует время по Москве (UTC+3 без сезонного перевода часов).
  const caughtAt = new Date(Date.UTC(year, month - 1, day, hour - 3, minute));
  const local = new Date(caughtAt.getTime() + 3 * 60 * 60_000);
  if (
    local.getUTCFullYear() !== year ||
    local.getUTCMonth() !== month - 1 ||
    local.getUTCDate() !== day ||
    local.getUTCHours() !== hour ||
    local.getUTCMinutes() !== minute
  )
    throw new Error(`Invalid record date: ${value}`);
  return caughtAt;
}

/**
 * Находит официальную таблицу по составу заголовков и преобразует её строки в строгую модель.
 * Хеш вычисляется от исходного HTML для аудита полученного ответа; сохранение в БД здесь
 * не выполняется.
 */
export function parseOfficialRecordsHtml(html: string): ParsedOfficialRecords {
  const $ = cheerio.load(html);

  // Поиск по заголовкам защищает от случайного разбора соседних таблиц той же страницы.
  const table = $('table')
    .filter((_, element) => {
      const text = compactText($(element).find('tr').first().text());
      return ['Рыба', 'Вес', 'Водоем', 'Игрок', 'Дата'].every((label) => text.includes(label));
    })
    .first();
  if (table.length === 0 || table.find('tbody').length === 0) {
    throw new Error('Official records table was not found');
  }

  const rows: OfficialRecordSourceRow[] = [];
  table.find('tbody tr').each((_, element) => {
    const cells = $(element).find('td');
    if (cells.length === 0) return;
    if (cells.length < 7) throw new Error('Official records row is incomplete');
    const fishCell = cells.eq(1);
    const fishPath = fishCell.find('a').attr('href')?.trim() ?? '';
    const imagePath = cells.eq(0).find('img').attr('src') ?? '';
    const imageMatch = /\/small\/(\d+)\.png(?:\?.*)?$/u.exec(imagePath);
    const fishName = compactText(fishCell.text());
    const waterbody = compactText(cells.eq(3).text());
    const playerName = compactText(cells.eq(5).text());
    const caughtAtRaw = compactText(cells.eq(6).text());

    // Эти поля образуют идентичность записи источника и нужны последующему сопоставлению каталога.
    if (!fishName || !fishPath || imageMatch === null || !waterbody || !playerName) {
      throw new Error('Official records row has missing identity fields');
    }
    rows.push({
      fishName,
      fishPath: fishPath.startsWith('/') ? fishPath : `/${fishPath}`,
      imageKey: Number(imageMatch[1]),
      weightGrams: parseOfficialRecordWeight(cells.eq(2).text()),
      waterbody,
      playerName,
      caughtAt: parseOfficialRecordDate(caughtAtRaw),
      caughtAtRaw,
    });
  });
  return { rows, sourceHash: createHash('sha256').update(html).digest('hex') };
}

/**
 * Загружает и разбирает официальную таблицу с ограничениями по времени и размеру ответа.
 * Внешний AbortSignal объединяется с внутренним таймаутом, а все обработчики освобождаются
 * независимо от результата запроса.
 */
export async function fetchOfficialRecords(signal?: AbortSignal): Promise<ParsedOfficialRecords> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), RECORDS_SOURCE_TIMEOUT_MS);
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  try {
    const response = await fetch(RECORDS_SOURCE_URL, {
      headers: { Accept: 'text/html;charset=UTF-8', 'User-Agent': 'fishing-db-records-sync/1.0' },
      redirect: 'error',
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`Official records responded with HTTP ${response.status}`);

    // Размер проверяется до декодирования, чтобы не создавать крупную строку из недоверенного ответа.
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > RECORDS_SOURCE_MAX_BYTES)
      throw new Error('Official records response is too large');
    return parseOfficialRecordsHtml(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', abort);
  }
}
