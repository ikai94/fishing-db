const DEFAULT_API_PORT = 3001;
const NODE_ENVIRONMENTS = ['development', 'test', 'production'] as const;
const FISH_IMAGE_DELIVERY_MODES = ['disabled', 'local'] as const;
const BAIT_IMAGE_DELIVERY_MODES = ['disabled', 'local'] as const;
const AUTH_EMAIL_DELIVERY_MODES = ['console', 'smtp'] as const;
const DEVELOPMENT_AUTH_EMAIL_ENCRYPTION_KEY = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

export type NodeEnvironment = (typeof NODE_ENVIRONMENTS)[number];
export type FishImageDeliveryMode = (typeof FISH_IMAGE_DELIVERY_MODES)[number];
export type BaitImageDeliveryMode = (typeof BAIT_IMAGE_DELIVERY_MODES)[number];
export type AuthEmailDeliveryMode = (typeof AUTH_EMAIL_DELIVERY_MODES)[number];

function requiredString(config: Record<string, unknown>, key: string): string {
  const value = config[key];

  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${key} must be a non-empty string`);
  }

  return value.trim();
}

function parsePort(value: unknown): number {
  const port = value === undefined ? DEFAULT_API_PORT : Number(value);

  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error('PORT must be an integer between 1 and 65535');
  }

  return port;
}

function validateDatabaseUrl(value: string): string {
  let url: URL;

  try {
    url = new URL(value);
  } catch {
    throw new Error('DATABASE_URL must be a valid PostgreSQL URL');
  }

  if ((url.protocol !== 'postgresql:' && url.protocol !== 'postgres:') || !url.hostname) {
    throw new Error('DATABASE_URL must be a valid PostgreSQL URL');
  }

  return value;
}

function validateWebOrigin(value: string): string {
  let url: URL;

  try {
    url = new URL(value);
  } catch {
    throw new Error('WEB_ORIGIN must be a valid HTTP origin');
  }

  if ((url.protocol !== 'http:' && url.protocol !== 'https:') || !url.hostname) {
    throw new Error('WEB_ORIGIN must be a valid HTTP origin');
  }

  return url.origin;
}

function validateNodeEnvironment(value: string): NodeEnvironment {
  if (!NODE_ENVIRONMENTS.includes(value as NodeEnvironment)) {
    throw new Error('NODE_ENV must be one of: development, test, production');
  }

  return value as NodeEnvironment;
}

function validateFishImageDeliveryMode(value: unknown): FishImageDeliveryMode {
  const mode = value === undefined ? 'disabled' : typeof value === 'string' ? value.trim() : '';
  if (!FISH_IMAGE_DELIVERY_MODES.includes(mode as FishImageDeliveryMode)) {
    throw new Error('FISH_IMAGE_DELIVERY_MODE must be one of: disabled, local');
  }
  return mode as FishImageDeliveryMode;
}

function validateBaitImageDeliveryMode(value: unknown): BaitImageDeliveryMode {
  const mode = value === undefined ? 'disabled' : typeof value === 'string' ? value.trim() : '';
  if (!BAIT_IMAGE_DELIVERY_MODES.includes(mode as BaitImageDeliveryMode)) {
    throw new Error('BAIT_IMAGE_DELIVERY_MODE must be one of: disabled, local');
  }
  return mode as BaitImageDeliveryMode;
}

function validateAuthEmailDeliveryMode(
  value: unknown,
  nodeEnvironment: NodeEnvironment,
): AuthEmailDeliveryMode {
  const mode = value === undefined ? 'console' : typeof value === 'string' ? value.trim() : '';

  if (!AUTH_EMAIL_DELIVERY_MODES.includes(mode as AuthEmailDeliveryMode)) {
    throw new Error('AUTH_EMAIL_DELIVERY_MODE must be one of: console, smtp');
  }

  if (nodeEnvironment === 'production' && mode !== 'smtp') {
    throw new Error('AUTH_EMAIL_DELIVERY_MODE must be smtp in production');
  }

  return mode as AuthEmailDeliveryMode;
}

function validateAuthEmailEncryptionKey(value: unknown, nodeEnvironment: NodeEnvironment): string {
  const key =
    value === undefined && nodeEnvironment !== 'production'
      ? DEVELOPMENT_AUTH_EMAIL_ENCRYPTION_KEY
      : typeof value === 'string'
        ? value.trim()
        : '';

  if (!/^[A-Za-z0-9_-]{43}$/.test(key)) {
    throw new Error('AUTH_EMAIL_TOKEN_ENCRYPTION_KEY must be a canonical 32-byte base64url value');
  }

  const decoded = Buffer.from(key, 'base64url');

  if (decoded.length !== 32 || decoded.toString('base64url') !== key) {
    throw new Error('AUTH_EMAIL_TOKEN_ENCRYPTION_KEY must be a canonical 32-byte base64url value');
  }

  if (nodeEnvironment === 'production' && key === DEVELOPMENT_AUTH_EMAIL_ENCRYPTION_KEY) {
    throw new Error(
      'AUTH_EMAIL_TOKEN_ENCRYPTION_KEY must not use the development key in production',
    );
  }

  return key;
}

function validateSmtpUrl(value: string): string {
  let url: URL;

  try {
    url = new URL(value);
  } catch {
    throw new Error('SMTP_URL must be a valid SMTP URL');
  }

  if ((url.protocol !== 'smtp:' && url.protocol !== 'smtps:') || !url.hostname) {
    throw new Error('SMTP_URL must be a valid SMTP URL');
  }

  if (url.search || url.hash || (url.pathname && url.pathname !== '/')) {
    throw new Error('SMTP_URL must not contain query options, fragments, or paths');
  }

  return value;
}

export function validateEnvironment(config: Record<string, unknown>): Record<string, unknown> {
  const databaseUrl = validateDatabaseUrl(requiredString(config, 'DATABASE_URL'));
  const webOrigin = validateWebOrigin(requiredString(config, 'WEB_ORIGIN'));
  const nodeEnvironment = validateNodeEnvironment(requiredString(config, 'NODE_ENV'));
  const authEmailDeliveryMode = validateAuthEmailDeliveryMode(
    config.AUTH_EMAIL_DELIVERY_MODE,
    nodeEnvironment,
  );
  const authEmailTokenEncryptionKey = validateAuthEmailEncryptionKey(
    config.AUTH_EMAIL_TOKEN_ENCRYPTION_KEY,
    nodeEnvironment,
  );
  if (nodeEnvironment === 'production' && !webOrigin.startsWith('https://')) {
    throw new Error('WEB_ORIGIN must use HTTPS in production');
  }
  const emailFrom =
    authEmailDeliveryMode === 'smtp' ? requiredString(config, 'EMAIL_FROM') : undefined;
  const smtpUrl =
    authEmailDeliveryMode === 'smtp'
      ? validateSmtpUrl(requiredString(config, 'SMTP_URL'))
      : undefined;
  const fishImageDeliveryMode = validateFishImageDeliveryMode(config.FISH_IMAGE_DELIVERY_MODE);
  const fishImageStorageRoot =
    fishImageDeliveryMode === 'local'
      ? requiredString(config, 'FISH_IMAGE_STORAGE_ROOT')
      : undefined;
  const baitImageDeliveryMode = validateBaitImageDeliveryMode(config.BAIT_IMAGE_DELIVERY_MODE);
  const baitImageStorageRoot =
    baitImageDeliveryMode === 'local'
      ? requiredString(config, 'BAIT_IMAGE_STORAGE_ROOT')
      : undefined;

  return {
    ...config,
    NODE_ENV: nodeEnvironment,
    PORT: parsePort(config.PORT),
    DATABASE_URL: databaseUrl,
    AUTH_EMAIL_DELIVERY_MODE: authEmailDeliveryMode,
    AUTH_EMAIL_TOKEN_ENCRYPTION_KEY: authEmailTokenEncryptionKey,
    ...(emailFrom === undefined ? {} : { EMAIL_FROM: emailFrom }),
    ...(smtpUrl === undefined ? {} : { SMTP_URL: smtpUrl }),
    BAIT_IMAGE_DELIVERY_MODE: baitImageDeliveryMode,
    ...(baitImageStorageRoot === undefined
      ? {}
      : { BAIT_IMAGE_STORAGE_ROOT: baitImageStorageRoot }),
    FISH_IMAGE_DELIVERY_MODE: fishImageDeliveryMode,
    ...(fishImageStorageRoot === undefined
      ? {}
      : { FISH_IMAGE_STORAGE_ROOT: fishImageStorageRoot }),
    WEB_ORIGIN: webOrigin,
  };
}
