import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { getTestDatabaseConfiguration } from './database.js';

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
});
