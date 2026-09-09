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

function compactText(value: string): string {
  return value.normalize('NFKC').trim().replace(/\s+/gu, ' ');
}

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

export function parseOfficialRecordsHtml(html: string): ParsedOfficialRecords {
  const $ = cheerio.load(html);
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
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > RECORDS_SOURCE_MAX_BYTES)
      throw new Error('Official records response is too large');
    return parseOfficialRecordsHtml(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', abort);
  }
}
