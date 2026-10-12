import { apiRequest } from './api-client';
import {
  decodePublicFishImage,
  type PublicCatalogItem,
  type PublicFishSummary,
} from './catalog-api';

/** Личные текстовые поля текущего ADMIN; идентификатор владельца не передаётся клиентом. */
export type PersonalNotebookFields = { noteText: string | null };

/** Контракт приватного блокнота с отдельными личными полями каждой пары базы и рыбы. */
export type BaseFishNotebook = {
  base: PublicCatalogItem;
  rows: (PersonalNotebookFields & {
    fish: PublicFishSummary & { isRarest: boolean; isNightBiting: boolean };
    minWeightGrams: number | null;
    maxWeightGrams: number | null;
    topLocations: (PublicCatalogItem & { number: number; reportsCount: number })[];
    totalCatchReports: number;
    isHidden: boolean;
  })[];
};

/** Проверяет точный набор полей, чтобы непредусмотренная приватная информация не попала в UI. */
function record(value: unknown, keys: string[]): Record<string, unknown> {
  if (
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value) ||
    Object.keys(value).sort().join(',') !== [...keys].sort().join(',')
  ) {
    throw new Error('Некорректный ответ блокнота');
  }
  return value as Record<string, unknown>;
}

/** Читает идентификатор и отображаемое имя без переноса лишних полей. */
function namedItem(value: Record<string, unknown>): PublicCatalogItem {
  if (typeof value.id !== 'string' || typeof value.name !== 'string')
    throw new Error('Некорректный ответ блокнота');
  return { id: value.id, name: value.name };
}

/** Требует точное положительное целое для веса, номера локации и числа уловов. */
function positiveInteger(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0)
    throw new Error('Некорректный ответ блокнота');
  return value;
}

/** Проверяет nullable текст и предел длины без изменения сохранённого форматирования. */
function nullableText(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== 'string' || [...value].length > 5000)
    throw new Error('Некорректный ответ блокнота');
  return value;
}

/** Явная проекция личных полей не переносит userId или другие данные хранения в интерфейс. */
function personalFields(value: Record<string, unknown>): PersonalNotebookFields {
  return { noteText: nullableText(value.noteText) };
}

/** Строго декодирует блокнот и использует общую проверку путей изображений рыб. */
export function decodeBaseFishNotebook(payload: unknown): BaseFishNotebook {
  const data = record(payload, ['base', 'rows']);
  if (!Array.isArray(data.rows)) throw new Error('Некорректный ответ блокнота');
  return {
    base: namedItem(record(data.base, ['id', 'name'])),
    rows: data.rows.map((value: unknown) => {
      const row = record(value, [
        'fish',
        'minWeightGrams',
        'maxWeightGrams',
        'topLocations',
        'noteText',
        'totalCatchReports',
        'isHidden',
      ]);
      const fish = record(row.fish, ['id', 'name', 'image', 'isRarest', 'isNightBiting']);
      if (typeof fish.isRarest !== 'boolean' || typeof fish.isNightBiting !== 'boolean')
        throw new Error('Некорректный ответ блокнота');
      if (
        typeof row.isHidden !== 'boolean' ||
        typeof row.totalCatchReports !== 'number' ||
        !Number.isSafeInteger(row.totalCatchReports) ||
        row.totalCatchReports < 0
      )
        throw new Error('Некорректный ответ блокнота');
      if (!Array.isArray(row.topLocations) || row.topLocations.length > 3)
        throw new Error('Некорректный ответ блокнота');
      return {
        ...personalFields(row),
        isHidden: row.isHidden,
        totalCatchReports: row.totalCatchReports,
        fish: {
          ...namedItem(fish),
          image: decodePublicFishImage(fish.image),
          isRarest: fish.isRarest,
          isNightBiting: fish.isNightBiting,
        },
        minWeightGrams: row.minWeightGrams === null ? null : positiveInteger(row.minWeightGrams),
        maxWeightGrams: row.maxWeightGrams === null ? null : positiveInteger(row.maxWeightGrams),
        topLocations: row.topLocations.map((value: unknown) => {
          const location = record(value, ['id', 'name', 'number', 'reportsCount']);
          return {
            ...namedItem(location),
            number: positiveInteger(location.number),
            reportsCount: positiveInteger(location.reportsCount),
          };
        }),
      };
    }),
  };
}

/** Сохраняет заметку одной пары; владелец определяется сервером по credentialed cookie. */
export async function saveBaseFishNotebookEntry(
  baseId: string,
  fishId: string,
  fields: PersonalNotebookFields,
  signal?: AbortSignal,
): Promise<PersonalNotebookFields> {
  const payload = await apiRequest<unknown>(
    `/admin/catalog/bases/${encodeURIComponent(baseId)}/notebook/fish/${encodeURIComponent(fishId)}`,
    {
      method: 'PUT',
      body: JSON.stringify({ noteText: fields.noteText }),
      signal,
    },
  );
  const envelope = record(payload, ['entry']);
  return personalFields(record(envelope.entry, ['noteText']));
}

/** Запрашивает только защищённый endpoint; сервер страницы явно передаёт cookie текущего запроса. */
export async function getBaseFishNotebook(
  baseId: string,
  init: RequestInit = {},
): Promise<BaseFishNotebook> {
  return decodeBaseFishNotebook(
    await apiRequest<unknown>(`/admin/catalog/bases/${encodeURIComponent(baseId)}/notebook`, init),
  );
}

/** Обновляет только видимость; endpoint и decoder не принимают и не возвращают текст заметки. */
export async function setBaseFishNotebookVisibility(
  baseId: string,
  fishId: string,
  isHidden: boolean,
  signal?: AbortSignal,
): Promise<boolean> {
  const payload = await apiRequest<unknown>(
    `/admin/catalog/bases/${encodeURIComponent(baseId)}/notebook/fish/${encodeURIComponent(fishId)}/visibility`,
    { method: 'PUT', body: JSON.stringify({ isHidden }), signal },
  );
  const visibility = record(record(payload, ['visibility']).visibility, ['isHidden']);
  if (typeof visibility.isHidden !== 'boolean') throw new Error('Некорректный ответ блокнота');
  return visibility.isHidden;
}
