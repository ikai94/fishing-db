import { isEmail } from 'class-validator';

export interface AuthFieldValidationIssue {
  field: 'email' | 'nickname' | 'password';
  code: string;
  message: string;
}

export class AuthInputValidationError extends Error {
  constructor(readonly issue: AuthFieldValidationIssue) {
    super(issue.message);
    this.name = 'AuthInputValidationError';
  }
}

export interface NormalizedNickname {
  nickname: string;
  nicknameNormalized: string;
}

const NICKNAME_ALLOWED_CHARACTERS = /^[\p{L}\p{M}\p{N} _.'-]+$/u;
const NICKNAME_HAS_LETTER_OR_NUMBER = /[\p{L}\p{N}]/u;
const PASSWORD_CONTROL_CHARACTER = /\p{Cc}/u;

function codePointLength(value: string): number {
  return Array.from(value).length;
}

function invalid(field: AuthFieldValidationIssue['field'], code: string, message: string): never {
  throw new AuthInputValidationError({ field, code, message });
}

export function normalizeEmail(value: string): string {
  if (typeof value !== 'string') {
    return invalid('email', 'INVALID_EMAIL', 'Введите корректный email');
  }

  const normalized = value.trim().toLowerCase();

  if (normalized.length > 254 || !isEmail(normalized)) {
    return invalid('email', 'INVALID_EMAIL', 'Введите корректный email');
  }

  const separatorIndex = normalized.lastIndexOf('@');
  const domain = normalized.slice(separatorIndex + 1);

  if (!domain.endsWith('.ru')) {
    return invalid(
      'email',
      'EMAIL_DOMAIN_NOT_ALLOWED',
      'Разрешены только email с доменом, оканчивающимся на .ru',
    );
  }

  return normalized;
}

export function normalizeNickname(value: string): NormalizedNickname {
  if (typeof value !== 'string') {
    return invalid('nickname', 'INVALID_NICKNAME', 'Введите корректный никнейм');
  }

  const nickname = value.trim();
  const nicknameNormalized = nickname.normalize('NFKC').toLowerCase();
  const displayLength = codePointLength(nickname);
  const normalizedLength = codePointLength(nicknameNormalized);

  if (displayLength < 3 || displayLength > 32 || normalizedLength < 3 || normalizedLength > 32) {
    return invalid(
      'nickname',
      'INVALID_NICKNAME_LENGTH',
      'Никнейм должен содержать от 3 до 32 символов',
    );
  }

  if (
    !NICKNAME_ALLOWED_CHARACTERS.test(nickname) ||
    !NICKNAME_ALLOWED_CHARACTERS.test(nicknameNormalized) ||
    !NICKNAME_HAS_LETTER_OR_NUMBER.test(nicknameNormalized)
  ) {
    return invalid(
      'nickname',
      'INVALID_NICKNAME_CHARACTERS',
      'Никнейм содержит недопустимые символы',
    );
  }

  return { nickname, nicknameNormalized };
}

export function validatePassword(value: string): string {
  if (typeof value !== 'string') {
    return invalid('password', 'INVALID_PASSWORD', 'Введите корректный пароль');
  }

  const length = codePointLength(value);

  if (length < 15 || length > 128) {
    return invalid(
      'password',
      'INVALID_PASSWORD_LENGTH',
      'Пароль должен содержать от 15 до 128 символов',
    );
  }

  if (PASSWORD_CONTROL_CHARACTER.test(value)) {
    return invalid(
      'password',
      'INVALID_PASSWORD_CHARACTERS',
      'Пароль не должен содержать управляющие символы',
    );
  }

  return value;
}
