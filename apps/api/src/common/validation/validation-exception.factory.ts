import {
  BadRequestException,
  type Type,
  type ValidationError,
  ValidationPipe,
} from '@nestjs/common';

type FieldErrors = Record<string, string[]>;

function collectErrors(
  validationErrors: ValidationError[],
  result: FieldErrors,
  parentPath = '',
): void {
  for (const validationError of validationErrors) {
    const path = parentPath
      ? `${parentPath}.${validationError.property}`
      : validationError.property;
    const messages = validationError.constraints ? Object.values(validationError.constraints) : [];

    if (messages.length > 0) {
      result[path] = messages;
    }

    if (validationError.children && validationError.children.length > 0) {
      collectErrors(validationError.children, result, path);
    }
  }
}

export function createValidationException(
  validationErrors: ValidationError[],
): BadRequestException {
  const errors: FieldErrors = {};
  collectErrors(validationErrors, errors);

  return new BadRequestException({
    statusCode: 400,
    code: 'VALIDATION_ERROR',
    message: 'Проверьте введённые данные',
    errors,
  });
}

export function createApplicationValidationPipe(expectedType?: Type<unknown>): ValidationPipe {
  return new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    transformOptions: {
      enableImplicitConversion: false,
    },
    exceptionFactory: createValidationException,
    expectedType,
  });
}
