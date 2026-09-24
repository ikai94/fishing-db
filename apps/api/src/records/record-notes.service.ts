import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import type { UpdateRecordNoteDto } from './dto/update-record-note.dto.js';

function fishNotFoundException(): NotFoundException {
  return new NotFoundException({
    statusCode: 404,
    code: 'FISH_NOT_FOUND',
    message: 'Рыба не найдена',
  });
}

/** Управляет приватными ADMIN-заметками, не смешивая их с неизменяемыми снимками рекордов. */
@Injectable()
export class RecordNotesService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /** Читает все сохранённые заметки одним запросом для последующего объединения на клиенте. */
  async listAdminNotes() {
    const items = await this.prisma.fishRecordNote.findMany({
      orderBy: { fishId: 'asc' },
      select: { fishId: true, note: true },
    });

    return { items };
  }

  /** Создаёт или заменяет заметку к Fish, а пустой ввод удаляет отдельную строку заметки. */
  async updateAdminNote(fishId: string, dto: UpdateRecordNoteDto) {
    const fish = await this.prisma.fish.findUnique({
      where: { id: fishId },
      select: { id: true },
    });
    if (fish === null) throw fishNotFoundException();

    const note = dto.note.trim();
    if (note === '') {
      await this.prisma.fishRecordNote.deleteMany({ where: { fishId } });
      return { note: { fishId, note: null } };
    }

    const saved = await this.prisma.fishRecordNote.upsert({
      where: { fishId },
      create: { fishId, note },
      update: { note },
      select: { fishId: true, note: true },
    });
    return { note: saved };
  }
}
