import { Body, Controller, Get, Inject, Param, Patch, UseGuards } from '@nestjs/common';
import { AdminGuard } from '../auth/admin.guard.js';
import { AuthGuard } from '../auth/auth.guard.js';
import { createApplicationValidationPipe } from '../common/validation/validation-exception.factory.js';
import { RecordNoteParamsDto } from './dto/record-note-params.dto.js';
import { UpdateRecordNoteDto } from './dto/update-record-note.dto.js';
import { RecordNotesService } from './record-notes.service.js';

/** Защищённая серверная граница чтения и редактирования заметок на странице рекордов. */
@Controller('admin/records')
@UseGuards(AuthGuard, AdminGuard)
export class AdminRecordsController {
  constructor(@Inject(RecordNotesService) private readonly notes: RecordNotesService) {}

  /** Возвращает заметки только после успешной проверки ADMIN-роли. */
  @Get('notes')
  listNotes() {
    return this.notes.listAdminNotes();
  }

  /** Сохраняет заметку к одной Fish или удаляет её при пустом значении. */
  @Patch('notes/:fishId')
  updateNote(
    @Param(createApplicationValidationPipe(RecordNoteParamsDto)) params: RecordNoteParamsDto,
    @Body(createApplicationValidationPipe(UpdateRecordNoteDto)) dto: UpdateRecordNoteDto,
  ) {
    return this.notes.updateAdminNote(params.fishId, dto);
  }
}
