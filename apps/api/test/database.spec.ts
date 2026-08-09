import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { clearTestData, getTestDatabaseConfiguration, type TestDataCleaner } from './database.js';

function recordingCleaner(calls: string[]): TestDataCleaner {
  return {
    deleteCatchReports: () => {
      calls.push('catchReports');
      return Promise.resolve();
    },
    deleteLocationFish: () => {
      calls.push('locationFish');
      return Promise.resolve();
    },
    deleteLocations: () => {
      calls.push('locations');
      return Promise.resolve();
    },
    deleteFishingBases: () => {
      calls.push('fishingBases');
      return Promise.resolve();
    },
    deleteFish: () => {
      calls.push('fish');
      return Promise.resolve();
    },
    deleteBaits: () => {
      calls.push('baits');
      return Promise.resolve();
    },
    deleteSessions: () => {
      calls.push('sessions');
      return Promise.resolve();
    },
    deleteUsers: () => {
      calls.push('users');
      return Promise.resolve();
    },
  };
}

void describe('test database safety guard', () => {
  void test('rejects the development database even when credentials and query parameters differ', () => {
    assert.throws(
      () =>
        getTestDatabaseConfiguration({
          DATABASE_URL: 'postgresql://development:secret@localhost:5432/fishing_db',
          TEST_DATABASE_URL: 'postgresql://test:another-secret@LOCALHOST/fishing_db?schema=public',
        }),
      /database name separate from DATABASE_URL/,
    );
  });

  void test('rejects host aliases and different ports when the database name is unchanged', () => {
    assert.throws(
      () =>
        getTestDatabaseConfiguration({
          DATABASE_URL: 'postgresql://development:secret@localhost:5432/fishing_db',
          TEST_DATABASE_URL: 'postgresql://test:secret@127.0.0.1:5432/fishing_db',
        }),
      /database name separate from DATABASE_URL/,
    );
    assert.throws(
      () =>
        getTestDatabaseConfiguration({
          DATABASE_URL: 'postgresql://development:secret@development-db:5432/fishing_db',
          TEST_DATABASE_URL: 'postgresql://test:secret@test-db:5433/fishing_db',
        }),
      /database name separate from DATABASE_URL/,
    );
  });

  void test('accepts an explicitly different test database name', () => {
    assert.deepEqual(
      getTestDatabaseConfiguration({
        DATABASE_URL: 'postgresql://fishing:secret@localhost:5432/fishing_db',
        TEST_DATABASE_URL: 'postgresql://fishing_test:secret@localhost:5433/fishing_db_test',
      }),
      {
        developmentDatabaseUrl: 'postgresql://fishing:secret@localhost:5432/fishing_db',
        testDatabaseUrl: 'postgresql://fishing_test:secret@localhost:5433/fishing_db_test',
      },
    );
  });

  void test('requires both database URLs explicitly', () => {
    assert.throws(
      () =>
        getTestDatabaseConfiguration({
          TEST_DATABASE_URL: 'postgresql://fishing_test:secret@localhost:5433/fishing_db_test',
        }),
      /DATABASE_URL is required/,
    );
    assert.throws(
      () =>
        getTestDatabaseConfiguration({
          DATABASE_URL: 'postgresql://fishing:secret@localhost:5432/fishing_db',
        }),
      /TEST_DATABASE_URL is required/,
    );
  });

  void test('cleans all test data in foreign-key-safe order', async () => {
    const calls: string[] = [];

    await clearTestData(
      {
        developmentDatabaseUrl: 'postgresql://fishing:secret@localhost:5432/fishing_db',
        testDatabaseUrl: 'postgresql://fishing_test:secret@localhost:5433/fishing_db_test',
      },
      recordingCleaner(calls),
    );

    assert.deepEqual(calls, [
      'catchReports',
      'locationFish',
      'locations',
      'fishingBases',
      'fish',
      'baits',
      'sessions',
      'users',
    ]);
  });

  void test('rechecks database separation immediately before destructive cleanup', async () => {
    const calls: string[] = [];
    const configuration = getTestDatabaseConfiguration({
      DATABASE_URL: 'postgresql://fishing:secret@localhost:5432/fishing_db',
      TEST_DATABASE_URL: 'postgresql://fishing_test:secret@localhost:5433/fishing_db_test',
    });

    configuration.testDatabaseUrl =
      'postgresql://different_credentials:secret@127.0.0.1:5432/fishing_db';

    await assert.rejects(
      clearTestData(configuration, recordingCleaner(calls)),
      /refusing destructive cleanup/,
    );
    assert.deepEqual(calls, []);
  });
});
