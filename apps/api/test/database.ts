export interface TestDatabaseConfiguration {
  developmentDatabaseUrl: string;
  testDatabaseUrl: string;
}

export interface TestDataCleaner {
  deleteCatchReports: () => Promise<unknown>;
  deleteLocationFish: () => Promise<unknown>;
  deleteLocations: () => Promise<unknown>;
  deleteFishingBases: () => Promise<unknown>;
  deleteFish: () => Promise<unknown>;
  deleteBaits: () => Promise<unknown>;
  deleteSessions: () => Promise<unknown>;
  deleteUsers: () => Promise<unknown>;
}

function getRequiredEnvironmentValue(
  environment: NodeJS.ProcessEnv,
  name: 'DATABASE_URL' | 'TEST_DATABASE_URL',
): string {
  const value = environment[name]?.trim();

  if (!value) {
    throw new Error(
      `${name} is required for PostgreSQL e2e tests. The test database must be configured explicitly.`,
    );
  }

  return value;
}

interface DatabaseTarget {
  databaseName: string;
  identity: string;
}

function getDatabaseTarget(connectionString: string, variableName: string): DatabaseTarget {
  let url: URL;

  try {
    url = new URL(connectionString);
  } catch {
    throw new Error(`${variableName} must be a valid PostgreSQL connection URL.`);
  }

  if (url.protocol !== 'postgresql:' && url.protocol !== 'postgres:') {
    throw new Error(`${variableName} must use the PostgreSQL protocol.`);
  }

  const databaseName = decodeURIComponent(url.pathname.replace(/^\/+/, '').replace(/\/+$/, ''));

  if (!url.hostname || !databaseName) {
    throw new Error(`${variableName} must identify a PostgreSQL host and database.`);
  }

  const port = url.port || '5432';

  // Credentials and query parameters do not make a PostgreSQL database a separate target.
  return {
    databaseName,
    identity: `${url.hostname.toLowerCase()}:${port}/${databaseName}`,
  };
}

function assertSeparateDatabaseNames(
  developmentDatabaseUrl: string,
  testDatabaseUrl: string,
  action: string,
): void {
  const developmentTarget = getDatabaseTarget(developmentDatabaseUrl, 'DATABASE_URL');
  const testTarget = getDatabaseTarget(testDatabaseUrl, 'TEST_DATABASE_URL');

  // Requiring a different database name is deliberately conservative. It cannot be bypassed by
  // host aliases such as localhost/127.0.0.1 or by using different credentials/query parameters.
  if (
    developmentTarget.databaseName === testTarget.databaseName ||
    developmentTarget.identity === testTarget.identity
  ) {
    throw new Error(
      `PostgreSQL e2e tests require TEST_DATABASE_URL to use a database name separate from DATABASE_URL; refusing ${action}.`,
    );
  }
}

export function getTestDatabaseConfiguration(
  environment: NodeJS.ProcessEnv,
): TestDatabaseConfiguration {
  const developmentDatabaseUrl = getRequiredEnvironmentValue(environment, 'DATABASE_URL');
  const testDatabaseUrl = getRequiredEnvironmentValue(environment, 'TEST_DATABASE_URL');

  assertSeparateDatabaseNames(developmentDatabaseUrl, testDatabaseUrl, 'test database setup');

  return { developmentDatabaseUrl, testDatabaseUrl };
}

export async function clearTestData(
  configuration: TestDatabaseConfiguration,
  cleaner: TestDataCleaner,
): Promise<void> {
  // Repeat the guard immediately before every destructive cleanup.
  assertSeparateDatabaseNames(
    configuration.developmentDatabaseUrl,
    configuration.testDatabaseUrl,
    'destructive cleanup',
  );

  await cleaner.deleteCatchReports();
  await cleaner.deleteLocationFish();
  await cleaner.deleteLocations();
  await cleaner.deleteFishingBases();
  await cleaner.deleteFish();
  await cleaner.deleteBaits();
  await cleaner.deleteSessions();
  await cleaner.deleteUsers();
}
