export interface NormalizedCatalogName {
  name: string;
  nameNormalized: string;
}

export interface CatalogNameValidationIssue {
  field: 'name';
  code: 'INVALID_CATALOG_NAME';
  message: string;
}

export class CatalogNameValidationError extends Error {
  constructor(readonly issue: CatalogNameValidationIssue) {
    super(issue.message);
    this.name = 'CatalogNameValidationError';
  }
}

const CATALOG_NAME_MAX_CODE_POINTS = 128;
const INVALID_CATALOG_CHARACTER = /\p{C}/u;
const CATALOG_NAME_HAS_LETTER_OR_NUMBER = /[\p{L}\p{N}]/u;
const REPEATED_UNICODE_WHITESPACE = /\p{White_Space}+/gu;

function codePointLength(value: string): number {
  return Array.from(value).length;
}

function invalidCatalogName(message: string): never {
  throw new CatalogNameValidationError({
    field: 'name',
    code: 'INVALID_CATALOG_NAME',
    message,
  });
}

export function normalizeCatalogName(value: unknown): NormalizedCatalogName {
  if (typeof value !== 'string') {
    return invalidCatalogName('Название должно быть строкой');
  }

  if (INVALID_CATALOG_CHARACTER.test(value)) {
    return invalidCatalogName('Название содержит недопустимые управляющие символы');
  }

  const name = value.trim();
  const nameNormalized = name
    .normalize('NFKC')
    .replace(REPEATED_UNICODE_WHITESPACE, ' ')
    .toLowerCase();
  const displayLength = codePointLength(name);
  const normalizedLength = codePointLength(nameNormalized);

  if (
    displayLength < 1 ||
    displayLength > CATALOG_NAME_MAX_CODE_POINTS ||
    normalizedLength < 1 ||
    normalizedLength > CATALOG_NAME_MAX_CODE_POINTS
  ) {
    return invalidCatalogName('Название должно содержать от 1 до 128 символов');
  }

  if (
    INVALID_CATALOG_CHARACTER.test(nameNormalized) ||
    !CATALOG_NAME_HAS_LETTER_OR_NUMBER.test(nameNormalized)
  ) {
    return invalidCatalogName('Название должно содержать хотя бы одну букву или цифру');
  }

  return { name, nameNormalized };
}
