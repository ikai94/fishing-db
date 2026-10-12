import { Inject, Injectable, InternalServerErrorException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { catalogErrors, isPrismaError } from './catalog-errors.js';
import type { SaveBaseFishNotebookDto } from './dto/save-base-fish-notebook.dto.js';
import type { SetBaseFishNotebookVisibilityDto } from './dto/set-base-fish-notebook-visibility.dto.js';
import { FishImageDelivery } from './fish-image-delivery.js';

/** Внутренний результат SQL: COUNT остаётся bigint до проверки безопасного диапазона. */
type RankedLocation = {
  fishId: string;
  id: string;
  name: string;
  number: number;
  reportsCount: bigint;
  totalCatchReports: bigint;
};

/** Собирает приватный блокнот базы без загрузки отдельных уловов и запросов на каждую рыбу. */
@Injectable()
export class BaseFishNotebookService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(FishImageDelivery) private readonly images: FishImageDelivery,
  ) {}

  /** Возвращает все текущие связи базы с рыбами и три исторически наиболее частые локации. */
  async getNotebook(baseId: string, userId: string) {
    const base = await this.prisma.fishingBase.findUnique({
      where: { id: baseId },
      select: {
        id: true,
        name: true,
        fishLinks: {
          orderBy: [{ fish: { nameNormalized: 'asc' } }, { fishId: 'asc' }],
          select: {
            minWeightGrams: true,
            maxWeightGrams: true,
            fish: {
              select: {
                id: true,
                name: true,
                officialFishImageKey: true,
                isRarest: true,
                isNightBiting: true,
              },
            },
          },
        },
      },
    });
    if (base === null) throw catalogErrors.fishingBaseNotFound();

    // Один запрос заметок с обязательной границей владельца; чужие записи не загружаются.
    const entries = await this.prisma.baseFishNotebookEntry.findMany({
      where: { userId, fishingBaseId: baseId },
      select: { fishId: true, noteText: true, isHidden: true },
    });
    const notesByFish = new Map(entries.map((entry) => [entry.fishId, entry]));

    // Один агрегат для всей базы; активность каталога и блокировка автора не меняют историю.
    const locations =
      base.fishLinks.length === 0
        ? []
        : await this.prisma.$queryRaw<RankedLocation[]>`
      WITH counts AS (
        SELECT report."fishId", location."id", location."name", location."number",
               COUNT(*) AS "reportsCount"
        FROM "CatchReport" report
        JOIN "Location" location ON location."id" = report."locationId"
        JOIN "FishingBaseFish" membership
          ON membership."fishId" = report."fishId"
         AND membership."fishingBaseId" = location."fishingBaseId"
        WHERE location."fishingBaseId" = ${baseId}::uuid
        GROUP BY report."fishId", location."id", location."name", location."number"
      ), ranked AS (
        SELECT counts.*,
          (SUM("reportsCount") OVER (PARTITION BY "fishId"))::bigint AS "totalCatchReports",
          ROW_NUMBER() OVER (
          PARTITION BY "fishId" ORDER BY "reportsCount" DESC, "number" ASC, "id" ASC
        ) AS rank
        FROM counts
      )
      SELECT "fishId", "id", "name", "number", "reportsCount", "totalCatchReports"
      FROM ranked WHERE rank <= 3 ORDER BY "fishId", rank
    `;
    const byFish = new Map<
      string,
      { id: string; name: string; number: number; reportsCount: number }[]
    >();
    const totalsByFish = new Map<string, number>();
    for (const location of locations) {
      if (
        location.reportsCount < 1n ||
        location.reportsCount > BigInt(Number.MAX_SAFE_INTEGER) ||
        location.totalCatchReports < location.reportsCount ||
        location.totalCatchReports > BigInt(Number.MAX_SAFE_INTEGER)
      ) {
        throw new InternalServerErrorException('Число уловов вне безопасного диапазона');
      }
      const items = byFish.get(location.fishId) ?? [];
      items.push({
        id: location.id,
        name: location.name,
        number: location.number,
        reportsCount: Number(location.reportsCount),
      });
      byFish.set(location.fishId, items);
      // Окно считает все локации до ограничения rank <= 3; сортировка не теряет остальные уловы.
      totalsByFish.set(location.fishId, Number(location.totalCatchReports));
    }

    // Явная проекция не выпускает внутренний ключ изображения или поля исходных уловов.
    return {
      base: { id: base.id, name: base.name },
      rows: base.fishLinks.map((link) => ({
        fish: {
          id: link.fish.id,
          name: link.fish.name,
          // Метки берём из каталога в том же запросе, не выводим их из веса или числа уловов.
          isRarest: link.fish.isRarest,
          isNightBiting: link.fish.isNightBiting,
          image: this.images.resolvePublicImage({
            fishId: link.fish.id,
            officialFishImageKey: link.fish.officialFishImageKey,
          }),
        },
        minWeightGrams: link.minWeightGrams,
        maxWeightGrams: link.maxWeightGrams,
        topLocations: byFish.get(link.fish.id) ?? [],
        totalCatchReports: totalsByFish.get(link.fish.id) ?? 0,
        noteText: notesByFish.get(link.fish.id)?.noteText ?? null,
        isHidden: notesByFish.get(link.fish.id)?.isHidden ?? false,
      })),
    };
  }

  /** Сохраняет только запись пользователя из сессии, никогда не меняя каталог или веса. */
  async saveEntry(userId: string, baseId: string, fishId: string, dto: SaveBaseFishNotebookDto) {
    await this.requireMembership(baseId, fishId);
    // Сохраняем форматирование непустого ввода; пробельный текст означает очистку.
    const noteText = dto.noteText?.trim() ? dto.noteText : null;
    try {
      const entry = await this.prisma.baseFishNotebookEntry.upsert({
        where: { userId_fishingBaseId_fishId: { userId, fishingBaseId: baseId, fishId } },
        create: { userId, fishingBaseId: baseId, fishId, noteText },
        update: { noteText },
        select: { noteText: true },
      });
      return { entry };
    } catch (error: unknown) {
      // FK закрывает гонку с удалением связи после проверки её существования.
      if (isPrismaError(error, 'P2003')) throw catalogErrors.fishingBaseFishNotFound();
      throw error;
    }
  }

  /** Upsert создаёт отсутствующую личную запись; update затрагивает исключительно isHidden. */
  async setVisibility(
    userId: string,
    baseId: string,
    fishId: string,
    dto: SetBaseFishNotebookVisibilityDto,
  ) {
    await this.requireMembership(baseId, fishId);
    try {
      const visibility = await this.prisma.baseFishNotebookEntry.upsert({
        where: { userId_fishingBaseId_fishId: { userId, fishingBaseId: baseId, fishId } },
        create: { userId, fishingBaseId: baseId, fishId, isHidden: dto.isHidden },
        update: { isHidden: dto.isHidden },
        select: { isHidden: true },
      });
      return { visibility };
    } catch (error: unknown) {
      if (isPrismaError(error, 'P2003')) throw catalogErrors.fishingBaseFishNotFound();
      throw error;
    }
  }

  /** Обе личные операции требуют существующую пару базы и рыбы, включая неактивный каталог. */
  private async requireMembership(baseId: string, fishId: string) {
    const membership = await this.prisma.fishingBaseFish.findUnique({
      where: { fishingBaseId_fishId: { fishingBaseId: baseId, fishId } },
      select: { fishId: true },
    });
    if (membership === null) throw catalogErrors.fishingBaseFishNotFound();
  }
}
