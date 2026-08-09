import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import type { CatalogNameValidationIssue } from './catalog-normalization.js';

interface PrismaErrorLike {
  code?: unknown;
  meta?: unknown;
}

function response(statusCode: number, code: string, message: string): object {
  return { statusCode, code, message };
}

function notFound(code: string, message: string): NotFoundException {
  return new NotFoundException(response(404, code, message));
}

function conflict(code: string, message: string): ConflictException {
  return new ConflictException(response(409, code, message));
}

export function catalogNameValidationException(
  issue: CatalogNameValidationIssue,
): BadRequestException {
  return new BadRequestException({
    statusCode: 400,
    code: 'VALIDATION_ERROR',
    message: 'Проверьте введённые данные',
    errors: { [issue.field]: [issue.message] },
  });
}

export function emptyUpdateException(): BadRequestException {
  return new BadRequestException({
    statusCode: 400,
    code: 'VALIDATION_ERROR',
    message: 'Проверьте введённые данные',
    errors: { body: ['Укажите хотя бы одно поле для изменения'] },
  });
}

export const catalogErrors = {
  fishingBaseNotFound: (): NotFoundException =>
    notFound('FISHING_BASE_NOT_FOUND', 'Рыболовная база не найдена'),
  locationNotFound: (): NotFoundException => notFound('LOCATION_NOT_FOUND', 'Локация не найдена'),
  fishNotFound: (): NotFoundException => notFound('FISH_NOT_FOUND', 'Рыба не найдена'),
  baitNotFound: (): NotFoundException => notFound('BAIT_NOT_FOUND', 'Наживка не найдена'),
  locationFishNotFound: (): NotFoundException =>
    notFound('LOCATION_FISH_NOT_FOUND', 'Связь локации и рыбы не найдена'),
  fishingBaseNameExists: (): ConflictException =>
    conflict('FISHING_BASE_NAME_ALREADY_EXISTS', 'База с таким названием уже существует'),
  locationNumberExists: (): ConflictException =>
    conflict('LOCATION_NUMBER_ALREADY_EXISTS', 'Локация с таким номером уже существует на базе'),
  locationNameExists: (): ConflictException =>
    conflict('LOCATION_NAME_ALREADY_EXISTS', 'Локация с таким названием уже существует на базе'),
  fishNameExists: (): ConflictException =>
    conflict('FISH_NAME_ALREADY_EXISTS', 'Рыба с таким названием уже существует'),
  baitNameExists: (): ConflictException =>
    conflict('BAIT_NAME_ALREADY_EXISTS', 'Наживка с таким названием уже существует'),
  locationFishExists: (): ConflictException =>
    conflict('LOCATION_FISH_ALREADY_EXISTS', 'Рыба уже добавлена в эту локацию'),
  fishingBaseInactive: (): ConflictException =>
    conflict('FISHING_BASE_INACTIVE', 'Рыболовная база неактивна'),
  locationInactive: (): ConflictException => conflict('LOCATION_INACTIVE', 'Локация неактивна'),
  fishInactive: (): ConflictException => conflict('FISH_INACTIVE', 'Рыба неактивна'),
  baitInactive: (): ConflictException => conflict('BAIT_INACTIVE', 'Наживка неактивна'),
  fishNotAvailableAtLocation: (): ConflictException =>
    conflict('FISH_NOT_AVAILABLE_AT_LOCATION', 'Выбранная рыба сейчас недоступна на этой локации'),
  locationFishRelationInvalid: (): ConflictException =>
    conflict('LOCATION_FISH_RELATION_INVALID', 'Не удалось изменить связь локации и рыбы'),
  catalogConflict: (): ConflictException =>
    conflict('CATALOG_CONFLICT', 'Не удалось изменить каталог из-за конфликта данных'),
} as const;

function prismaErrorMetadata(error: unknown): string {
  if (typeof error !== 'object' || error === null) {
    return '';
  }

  const prismaError = error as PrismaErrorLike;

  try {
    return JSON.stringify(prismaError.meta ?? '').toLowerCase();
  } catch {
    return '';
  }
}

export function isPrismaError(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && (error as PrismaErrorLike).code === code;
}

export function isPrismaUniqueConstraintErrorFor(error: unknown, field: string): boolean {
  return isPrismaError(error, 'P2002') && prismaErrorMetadata(error).includes(field.toLowerCase());
}
