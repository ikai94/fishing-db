import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import type { CatchReportObservationErrors } from './catch-report-observation.js';

function response(statusCode: number, code: string, message: string): object {
  return { statusCode, code, message };
}

export const catchReportErrors = {
  observationValidation: (errors: CatchReportObservationErrors): BadRequestException =>
    new BadRequestException({
      ...response(400, 'VALIDATION_ERROR', 'Проверьте введённые данные'),
      errors,
    }),
  invalidCursor: (): BadRequestException =>
    new BadRequestException({
      ...response(400, 'VALIDATION_ERROR', 'Проверьте введённые данные'),
      errors: { cursor: ['Некорректный курсор пагинации'] },
    }),
  emptyUpdate: (): BadRequestException =>
    new BadRequestException({
      ...response(400, 'VALIDATION_ERROR', 'Проверьте введённые данные'),
      errors: { body: ['Укажите хотя бы одно поле для изменения'] },
    }),
  notFound: (): NotFoundException =>
    new NotFoundException(response(404, 'CATCH_REPORT_NOT_FOUND', 'Отчёт об улове не найден')),
  notOwned: (): ForbiddenException =>
    new ForbiddenException(
      response(403, 'CATCH_REPORT_NOT_OWNED', 'Нельзя изменить чужой отчёт об улове'),
    ),
  accountBanned: (): ForbiddenException =>
    new ForbiddenException(response(403, 'ACCOUNT_BANNED', 'Аккаунт заблокирован')),
  referenceConflict: (): ConflictException =>
    new ConflictException(
      response(
        409,
        'CATCH_REPORT_REFERENCE_CONFLICT',
        'Не удалось сохранить отчёт из-за изменения каталога',
      ),
    ),
} as const;
