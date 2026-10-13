import { Controller, Get, Header, Inject, Param, UseGuards } from '@nestjs/common';
import { AdminGuard } from '../auth/admin.guard.js';
import { AuthGuard } from '../auth/auth.guard.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import type { SafeUser } from '../auth/auth.types.js';
import { createApplicationValidationPipe } from '../common/validation/validation-exception.factory.js';
import { BaseFishNotebookService } from './base-fish-notebook.service.js';
import { FishIdParamsDto } from './dto/catalog-params.dto.js';

/** Приватное чтение блокнота на странице рыбы использует ту же ADMIN-границу доступа. */
@Controller('admin/catalog/fish')
@UseGuards(AuthGuard, AdminGuard)
export class AdminFishNotesController {
  constructor(
    @Inject(BaseFishNotebookService) private readonly notebook: BaseFishNotebookService,
  ) {}

  /** Владелец определяется исключительно сессией; ответ не попадает в общий кеш. */
  @Get(':fishId/notebook')
  @Header('Cache-Control', 'private, no-store')
  @Header('Vary', 'Cookie')
  getNotes(
    @CurrentUser() user: SafeUser,
    @Param(createApplicationValidationPipe(FishIdParamsDto)) params: FishIdParamsDto,
  ) {
    return this.notebook.getFishNotes(params.fishId, user.id);
  }
}
