import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { config as loadEnvironmentFile } from 'dotenv';
import { Client } from 'pg';
import { getTestDatabaseConfiguration } from './database.js';

const API_DIRECTORY = fileURLToPath(new URL('..', import.meta.url));
loadEnvironmentFile({ path: `${API_DIRECTORY}/.env`, quiet: true });
loadEnvironmentFile({ path: `${API_DIRECTORY}/test/.env`, quiet: true });

void test('Fish catch counts: backfill, bulk mutations, idempotency, rollback and concurrency', async () => {
  const configuration = getTestDatabaseConfiguration(process.env);
  const client = new Client({ connectionString: configuration.testDatabaseUrl });
  const concurrent = new Client({ connectionString: configuration.testDatabaseUrl });
  const schema = `fish_counts_${randomUUID().replaceAll('-', '')}`;
  const fishA = randomUUID();
  const fishB = randomUUID();
  const fishZero = randomUUID();
  await client.connect();
  try {
    // Изолированная схема проверяет SQL миграции, не меняя общие таблицы даже тестовой БД.
    await client.query(`CREATE SCHEMA "${schema}"`);
    await client.query(`SET search_path TO "${schema}"`);
    await client.query(`
      CREATE TABLE "Fish" ("id" uuid PRIMARY KEY, "isActive" boolean NOT NULL DEFAULT true);
      CREATE TABLE "CatchReport" (
        "id" integer PRIMARY KEY, "fishId" uuid NOT NULL REFERENCES "Fish"("id"),
        "weightGrams" integer NOT NULL DEFAULT 100
      );
    `);
    await client.query(
      'INSERT INTO "Fish" ("id", "isActive") VALUES ($1, true), ($2, false), ($3, true)',
      [fishA, fishB, fishZero],
    );
    await client.query(
      'INSERT INTO "CatchReport" ("id", "fishId") VALUES (1, $1), (2, $1), (3, $2)',
      [fishA, fishB],
    );
    await client.query(
      await readFile(
        `${API_DIRECTORY}/prisma/migrations/20261001120000_add_fish_catch_counts/migration.sql`,
        'utf8',
      ),
    );

    async function counts(): Promise<Record<string, string>> {
      const result = await client.query<{ id: string; catchReportsCount: string }>(
        'SELECT "id", "catchReportsCount" FROM "Fish"',
      );
      return Object.fromEntries(result.rows.map((row) => [row.id, row.catchReportsCount]));
    }
    assert.deepEqual(await counts(), { [fishA]: '2', [fishB]: '1', [fishZero]: '0' });

    // Повторный импорт с конфликтом не увеличивает число уловов повторно.
    await client.query(
      'INSERT INTO "CatchReport" ("id", "fishId") VALUES (4, $1), (5, $1), (6, $2) ON CONFLICT DO NOTHING',
      [fishA, fishB],
    );
    await client.query(
      'INSERT INTO "CatchReport" ("id", "fishId") VALUES (4, $1), (5, $1), (6, $2) ON CONFLICT DO NOTHING',
      [fishA, fishB],
    );
    assert.deepEqual(await counts(), { [fishA]: '4', [fishB]: '2', [fishZero]: '0' });
    await client.query('UPDATE "CatchReport" SET "weightGrams" = 200');
    assert.deepEqual(await counts(), { [fishA]: '4', [fishB]: '2', [fishZero]: '0' });
    await client.query('UPDATE "CatchReport" SET "fishId" = $1 WHERE "id" IN (1, 4)', [fishB]);
    assert.deepEqual(await counts(), { [fishA]: '2', [fishB]: '4', [fishZero]: '0' });
    await client.query('DELETE FROM "CatchReport" WHERE "id" IN (2, 3)');
    assert.deepEqual(await counts(), { [fishA]: '1', [fishB]: '3', [fishZero]: '0' });

    await client.query('BEGIN');
    await client.query('INSERT INTO "CatchReport" ("id", "fishId") VALUES (7, $1)', [fishZero]);
    await client.query('DELETE FROM "CatchReport" WHERE "id" = 6');
    await client.query('ROLLBACK');
    assert.deepEqual(await counts(), { [fishA]: '1', [fishB]: '3', [fishZero]: '0' });

    await concurrent.connect();
    await concurrent.query(`SET search_path TO "${schema}"`);
    await Promise.all([
      client.query('INSERT INTO "CatchReport" ("id", "fishId") VALUES (8, $1), (9, $2)', [
        fishA,
        fishB,
      ]),
      concurrent.query('INSERT INTO "CatchReport" ("id", "fishId") VALUES (10, $1), (11, $2)', [
        fishB,
        fishA,
      ]),
    ]);
    assert.deepEqual(await counts(), { [fishA]: '3', [fishB]: '5', [fishZero]: '0' });
    await client.query('DELETE FROM "CatchReport"');
    assert.deepEqual(await counts(), { [fishA]: '0', [fishB]: '0', [fishZero]: '0' });
    await client.query('INSERT INTO "CatchReport" ("id", "fishId") VALUES (12, $1)', [fishA]);
    await client.query('TRUNCATE "CatchReport"');
    assert.deepEqual(await counts(), { [fishA]: '0', [fishB]: '0', [fishZero]: '0' });
    await client.query('INSERT INTO "Fish" ("id") VALUES ($1)', [randomUUID()]);
    assert.ok(Object.values(await counts()).every((count) => count === '0'));
  } finally {
    await concurrent.end();
    await client.query('ROLLBACK');
    await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await client.end();
  }
});
