import { Body, Controller, Get, Header, Inject, Param, Put, UseGuards } from '@nestjs/common';
import { AdminGuard } from '../auth/admin.guard.js';
import { AuthGuard } from '../auth/auth.guard.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import type { SafeUser } from '../auth/auth.types.js';
import { createApplicationValidationPipe } from '../common/validation/validation-exception.factory.js';
import { BaseFishNotebookService } from './base-fish-notebook.service.js';
import { FishingBaseFishParamsDto, FishingBaseIdParamsDto } from './dto/catalog-params.dto.js';
import { SaveBaseFishNotebookDto } from './dto/save-base-fish-notebook.dto.js';
import { SetBaseFishNotebookVisibilityDto } from './dto/set-base-fish-notebook-visibility.dto.js';

/** Отдельная приватная граница блокнота: публичный каталог не получает его данные. */
@Controller('admin/catalog/bases')
@UseGuards(AuthGuard, AdminGuard)
export class AdminBaseFishNotebookController {
  constructor(
    @Inject(BaseFishNotebookService) private readonly notebook: BaseFishNotebookService,
  ) {}

  /** Только чтение; персональный административный ответ запрещено сохранять в общих кешах. */
  @Get(':baseId/notebook')
  @Header('Cache-Control', 'private, no-store')
  @Header('Vary', 'Cookie')
  getNotebook(
    @CurrentUser() user: SafeUser,
    @Param(createApplicationValidationPipe(FishingBaseIdParamsDto)) params: FishingBaseIdParamsDto,
  ) {
    return this.notebook.getNotebook(params.baseId, user.id);
  }

  /** Владелец берётся только из сессии; тело запроса содержит лишь текст личной заметки. */
  @Put(':baseId/notebook/fish/:fishId')
  @Header('Cache-Control', 'private, no-store')
  @Header('Vary', 'Cookie')
  saveEntry(
    @CurrentUser() user: SafeUser,
    @Param(createApplicationValidationPipe(FishingBaseFishParamsDto))
    params: FishingBaseFishParamsDto,
    @Body(createApplicationValidationPipe(SaveBaseFishNotebookDto)) dto: SaveBaseFishNotebookDto,
  ) {
    return this.notebook.saveEntry(user.id, params.baseId, params.fishId, dto);
  }

  /** Отдельная операция не перезаписывает сохранённую заметку при скрытии или восстановлении. */
  @Put(':baseId/notebook/fish/:fishId/visibility')
  @Header('Cache-Control', 'private, no-store')
  @Header('Vary', 'Cookie')
  setVisibility(
    @CurrentUser() user: SafeUser,
    @Param(createApplicationValidationPipe(FishingBaseFishParamsDto))
    params: FishingBaseFishParamsDto,
    @Body(createApplicationValidationPipe(SetBaseFishNotebookVisibilityDto))
    dto: SetBaseFishNotebookVisibilityDto,
  ) {
    return this.notebook.setVisibility(user.id, params.baseId, params.fishId, dto);
  }
}
