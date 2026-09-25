import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

interface PrismaErrorLike {
  code?: unknown;
}

function fishNotFoundException(): NotFoundException {
  return new NotFoundException({
    statusCode: 404,
    code: 'FISH_NOT_FOUND',
    message: 'Рыба не найдена',
  });
}

function isForeignKeyError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as PrismaErrorLike).code === 'P2003';
}

/** Управляет общей персональной связью User–Fish независимо от экранов-потребителей. */
@Injectable()
export class FishFavoritesService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /** Возвращает все Fish ID пользователя одним запросом в стабильном порядке. */
  async list(userId: string) {
    const items = await this.prisma.userFavoriteFish.findMany({
      where: { userId },
      orderBy: { fishId: 'asc' },
      select: { fishId: true },
    });
    return { items };
  }

  /** Идемпотентно добавляет Fish в персональное избранное. */
  async add(userId: string, fishId: string) {
    const fish = await this.prisma.fish.findUnique({
      where: { id: fishId },
      select: { id: true },
    });
    if (fish === null) throw fishNotFoundException();

    try {
      const favorite = await this.prisma.userFavoriteFish.upsert({
        where: { userId_fishId: { userId, fishId } },
        create: { userId, fishId },
        update: {},
        select: { fishId: true },
      });
      return { favorite };
    } catch (error: unknown) {
      // Fish мог быть удалён между проверкой и записью; наружу это остаётся обычным 404.
      if (isForeignKeyError(error)) throw fishNotFoundException();
      throw error;
    }
  }

  /** Идемпотентно удаляет связь, не раскрывая наличие чужих пользовательских данных. */
  async remove(userId: string, fishId: string): Promise<void> {
    await this.prisma.userFavoriteFish.deleteMany({ where: { userId, fishId } });
  }
}
