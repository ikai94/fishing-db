import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import type { UpdateWrongMaxIssueDto } from './dto/update-wrong-max-issue.dto.js';

function fishNotFoundException(): NotFoundException {
  return new NotFoundException({
    statusCode: 404,
    code: 'FISH_NOT_FOUND',
    message: 'Рыба не найдена',
  });
}

/** Управляет общей ночной меткой и приватными ADMIN-проблемами рекордного максимума. */
@Injectable()
export class RecordMarksService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /** Сохраняет ночную метку на Fish и возвращает только её публично допустимое состояние. */
  async updateNightMark(fishId: string, isNightBiting: boolean) {
    const fish = await this.prisma.fish.findUnique({
      where: { id: fishId },
      select: { id: true },
    });
    if (fish === null) throw fishNotFoundException();

    const saved = await this.prisma.fish.update({
      where: { id: fishId },
      data: { isNightBiting },
      select: { id: true, isNightBiting: true },
    });
    return { fish: { fishId: saved.id, isNightBiting: saved.isNightBiting } };
  }

  /** Читает приватные проблемы одним запросом без данных ADMIN-пользователей. */
  async listWrongMaxIssues() {
    const items = await this.prisma.fishWrongMaxIssue.findMany({
      orderBy: { fishId: 'asc' },
      select: {
        fishId: true,
        expectedWeightGrams: true,
        note: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    return { items };
  }

  /** Создаёт или обновляет проблему, не меняя Fish, CatchReport или вычисленный максимум. */
  async updateWrongMaxIssue(fishId: string, dto: UpdateWrongMaxIssueDto) {
    const fish = await this.prisma.fish.findUnique({
      where: { id: fishId },
      select: { id: true },
    });
    if (fish === null) throw fishNotFoundException();

    const note = dto.note?.trim() || null;
    const issue = await this.prisma.fishWrongMaxIssue.upsert({
      where: { fishId },
      create: { fishId, expectedWeightGrams: dto.expectedWeightGrams, note },
      update: { expectedWeightGrams: dto.expectedWeightGrams, note },
      select: {
        fishId: true,
        expectedWeightGrams: true,
        note: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    return { issue };
  }

  /** Идемпотентно удаляет проблему существующей Fish. */
  async clearWrongMaxIssue(fishId: string): Promise<void> {
    const fish = await this.prisma.fish.findUnique({
      where: { id: fishId },
      select: { id: true },
    });
    if (fish === null) throw fishNotFoundException();
    await this.prisma.fishWrongMaxIssue.deleteMany({ where: { fishId } });
  }
}
