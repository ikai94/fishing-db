import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  Patch,
  UseGuards,
} from '@nestjs/common';
import { AdminGuard } from '../auth/admin.guard.js';
import { AuthGuard } from '../auth/auth.guard.js';
import { createApplicationValidationPipe } from '../common/validation/validation-exception.factory.js';
import { RecordNoteParamsDto } from './dto/record-note-params.dto.js';
import { UpdateNightMarkDto } from './dto/update-night-mark.dto.js';
import { UpdateRecordNoteDto } from './dto/update-record-note.dto.js';
import { UpdateWrongMaxIssueDto } from './dto/update-wrong-max-issue.dto.js';
import { RecordMarksService } from './record-marks.service.js';
import { RecordNotesService } from './record-notes.service.js';

/** Защищённая серверная граница чтения и редактирования заметок на странице рекордов. */
@Controller('admin/records')
@UseGuards(AuthGuard, AdminGuard)
export class AdminRecordsController {
  constructor(
    @Inject(RecordNotesService) private readonly notes: RecordNotesService,
    @Inject(RecordMarksService) private readonly marks: RecordMarksService,
  ) {}

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

  /** Меняет публичную ночную метку Fish, не затрагивая рекордные веса. */
  @Patch('night-marks/:fishId')
  updateNightMark(
    @Param(createApplicationValidationPipe(RecordNoteParamsDto)) params: RecordNoteParamsDto,
    @Body(createApplicationValidationPipe(UpdateNightMarkDto)) dto: UpdateNightMarkDto,
  ) {
    return this.marks.updateNightMark(params.fishId, dto.isNightBiting);
  }

  /** Возвращает все приватные отметки неверного «Наш max» одним ADMIN-запросом. */
  @Get('wrong-max-issues')
  listWrongMaxIssues() {
    return this.marks.listWrongMaxIssues();
  }

  /** Создаёт или заменяет приватные сведения о неверном «Наш max» одной Fish. */
  @Patch('wrong-max-issues/:fishId')
  updateWrongMaxIssue(
    @Param(createApplicationValidationPipe(RecordNoteParamsDto)) params: RecordNoteParamsDto,
    @Body(createApplicationValidationPipe(UpdateWrongMaxIssueDto)) dto: UpdateWrongMaxIssueDto,
  ) {
    return this.marks.updateWrongMaxIssue(params.fishId, dto);
  }

  /** Полностью снимает приватную отметку неверного «Наш max». */
  @Delete('wrong-max-issues/:fishId')
  @HttpCode(204)
  async clearWrongMaxIssue(
    @Param(createApplicationValidationPipe(RecordNoteParamsDto)) params: RecordNoteParamsDto,
  ): Promise<void> {
    await this.marks.clearWrongMaxIssue(params.fishId);
  }
}
