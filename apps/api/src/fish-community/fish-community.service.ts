import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { FishCommunityMark } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';

/** Хранит независимые знания сообщества отдельно от каталожных и исторических условий. */
@Injectable()
export class FishCommunityService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /** Совпадает с политикой доступа публичной карточки активной рыбы. */
  private async requireFish(fishId: string): Promise<void> {
    const fish = await this.prisma.fish.findFirst({
      where: { id: fishId, isActive: true },
      select: { id: true },
    });
    if (!fish) throw new NotFoundException({ code: 'FISH_NOT_FOUND', message: 'Рыба не найдена' });
  }

  /** Считает только таблицу голосов, не сканируя историю уловов. */
  async counts(fishId: string) {
    await this.requireFish(fishId);
    const rows = await this.prisma.fishCommunityVote.groupBy({
      by: ['mark'],
      where: { fishId },
      _count: { _all: true },
    });
    return {
      items: Object.values(FishCommunityMark).map((mark) => ({
        mark,
        count: rows.find((row) => row.mark === mark)?._count._all ?? 0,
      })),
    };
  }

  /** Возвращает собственные отметки без персональных данных других участников. */
  async mine(fishId: string, userId: string) {
    await this.requireFish(fishId);
    return {
      items: await this.prisma.fishCommunityVote.findMany({
        where: { fishId, userId },
        select: { mark: true },
        orderBy: { mark: 'asc' },
      }),
    };
  }

  /** Лениво отдаёт никнеймы; email, роли и внутренние ключи не входят в проекцию. */
  async voters(fishId: string, mark: FishCommunityMark, after?: string) {
    await this.requireFish(fishId);
    const rows = await this.prisma.fishCommunityVote.findMany({
      where: { fishId, mark, ...(after ? { userId: { gt: after } } : {}) },
      select: { userId: true, user: { select: { nickname: true } } },
      orderBy: { userId: 'asc' },
      take: 51,
    });
    return {
      items: rows.slice(0, 50).map((row) => ({ nickname: row.user.nickname })),
      nextCursor: rows.length > 50 ? rows[49].userId : null,
    };
  }

  /** Повторное добавление идемпотентно, включая одновременные запросы одной сессии. */
  async add(fishId: string, mark: FishCommunityMark, userId: string): Promise<void> {
    await this.requireFish(fishId);
    await this.prisma.fishCommunityVote.createMany({
      data: [{ fishId, mark, userId }],
      skipDuplicates: true,
    });
  }

  /** Удаляет только голос текущего участника; повторное удаление безопасно. */
  async remove(fishId: string, mark: FishCommunityMark, userId: string): Promise<void> {
    await this.requireFish(fishId);
    await this.prisma.fishCommunityVote.deleteMany({ where: { fishId, mark, userId } });
  }
}
