const DEFAULT_API_PORT = 3001;
const NODE_ENVIRONMENTS = ['development', 'test', 'production'] as const;

export type NodeEnvironment = (typeof NODE_ENVIRONMENTS)[number];

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

export function validateEnvironment(config: Record<string, unknown>): Record<string, unknown> {
  const databaseUrl = validateDatabaseUrl(requiredString(config, 'DATABASE_URL'));
  const webOrigin = validateWebOrigin(requiredString(config, 'WEB_ORIGIN'));
  const nodeEnvironment = validateNodeEnvironment(requiredString(config, 'NODE_ENV'));

  return {
    ...config,
    NODE_ENV: nodeEnvironment,
    PORT: parsePort(config.PORT),
    DATABASE_URL: databaseUrl,
    WEB_ORIGIN: webOrigin,
  };
}
