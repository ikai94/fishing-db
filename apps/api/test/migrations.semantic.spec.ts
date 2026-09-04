import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { after, before, describe, test } from 'node:test';
import { config as loadEnvironmentFile } from 'dotenv';
import { Client } from 'pg';
import { getTestDatabaseConfiguration, type TestDatabaseConfiguration } from './database.js';

const API_DIRECTORY = fileURLToPath(new URL('..', import.meta.url));
const MIGRATIONS_DIRECTORY = `${API_DIRECTORY}/prisma/migrations`;
const PHASE_FOUR_MIGRATIONS = [
  '20260808153134_add_users_and_sessions',
  '20260808190803_add_game_catalog',
  '20260809121540_add_catch_reports',
] as const;
const PHASE_FIVE_COMPATIBILITY_MIGRATIONS = [
  '20260809144907_replace_location_fish_with_fishing_base_fish',
  '20260809145137_add_catch_report_v2_compatibility',
] as const;
const PHASE_FIVE_INVARIANT_MIGRATION = '20260809151033_enforce_catch_report_v2_invariant';
const CONTRIBUTOR_IDENTITY_MIGRATION = '20260820120000_add_catch_report_contributor_identity';
const RELAX_OBSERVATIONS_MIGRATION = '20260826120000_relax_catch_report_observations';
const FISH_IMAGE_METADATA_MIGRATION = '20260828190000_add_fish_image_metadata';
const BASE_FISH_WEIGHT_MIGRATION = '20260901120000_add_fishing_base_fish_weights';
const ACTIVITY_EVENT_MIGRATION = '20260904120000_add_activity_events';

loadEnvironmentFile({ path: `${API_DIRECTORY}/.env`, quiet: true });
loadEnvironmentFile({ path: `${API_DIRECTORY}/test/.env`, quiet: true });

let databaseConfiguration: TestDatabaseConfiguration;
let client: Client;
let schemaName: string;

function quotedIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}

async function applyMigration(name: string, targetClient: Client = client): Promise<void> {
  const sql = await readFile(`${MIGRATIONS_DIRECTORY}/${name}/migration.sql`, 'utf8');
  await targetClient.query(sql);
}

async function insertPhaseFourFixture(targetClient: Client = client): Promise<void> {
  await targetClient.query(`
    INSERT INTO "User" (
      "id", "email", "nickname", "nicknameNormalized", "passwordHash"
    ) VALUES (
      '00000000-0000-4000-8000-000000000001',
      'migration@example.ru',
      'MigrationUser',
      'migrationuser',
      'not-a-real-password-hash'
    );

    INSERT INTO "FishingBase" ("id", "name", "nameNormalized") VALUES
      ('00000000-0000-4000-8000-000000000010', 'Test Base', 'test base');

    INSERT INTO "Location" (
      "id", "fishingBaseId", "number", "name", "nameNormalized"
    ) VALUES
      (
        '00000000-0000-4000-8000-000000000011',
        '00000000-0000-4000-8000-000000000010',
        1,
        'First Location',
        'first location'
      ),
      (
        '00000000-0000-4000-8000-000000000012',
        '00000000-0000-4000-8000-000000000010',
        2,
        'Second Location',
        'second location'
      );

    INSERT INTO "Fish" ("id", "name", "nameNormalized") VALUES
      (
        '00000000-0000-4000-8000-000000000020',
        'Жерех-лысач',
        'жерех-лысач'
      ),
      (
        '00000000-0000-4000-8000-000000000021',
        'Жерех-лысач (спиннинг)',
        'жерех-лысач (спиннинг)'
      ),
      (
        '00000000-0000-4000-8000-000000000022',
        'Сайда (спиннинг)',
        'сайда (спиннинг)'
      );

    INSERT INTO "Bait" ("id", "name", "nameNormalized", "type") VALUES
      (
        '00000000-0000-4000-8000-000000000030',
        'Vob-3006',
        'vob-3006',
        'LURE'
      );

    INSERT INTO "LocationFish" ("locationId", "fishId", "createdAt") VALUES
      (
        '00000000-0000-4000-8000-000000000011',
        '00000000-0000-4000-8000-000000000021',
        '2026-01-02T00:00:00Z'
      ),
      (
        '00000000-0000-4000-8000-000000000012',
        '00000000-0000-4000-8000-000000000020',
        '2026-01-01T00:00:00Z'
      ),
      (
        '00000000-0000-4000-8000-000000000011',
        '00000000-0000-4000-8000-000000000022',
        '2026-01-03T00:00:00Z'
      );

    INSERT INTO "CatchReport" (
      "id",
      "userId",
      "locationId",
      "fishId",
      "baitId",
      "weightGrams",
      "holeDepthCm",
      "spotLandmark",
      "fishingNote",
      "userNoteRaw"
    ) VALUES (
      '00000000-0000-4000-8000-000000000040',
      '00000000-0000-4000-8000-000000000001',
      '00000000-0000-4000-8000-000000000011',
      '00000000-0000-4000-8000-000000000021',
      '00000000-0000-4000-8000-000000000030',
      3747,
      NULL,
      'NOTEBOOK',
      'MIDWATER',
      'старая заметка'
    );
  `);
}

void describe('Phase 5 migration semantics (disposable PostgreSQL schema)', () => {
  void before(async () => {
    databaseConfiguration = getTestDatabaseConfiguration(process.env);
    schemaName = `phase5_semantic_${randomUUID().replaceAll('-', '')}`;
    client = new Client({ connectionString: databaseConfiguration.testDatabaseUrl });
    await client.connect();
    await client.query(`CREATE SCHEMA ${quotedIdentifier(schemaName)}`);
    await client.query(`SET search_path TO ${quotedIdentifier(schemaName)}`);
  });

  void after(async () => {
    if (client === undefined) return;

    try {
      await client.query('ROLLBACK');
      await client.query(`DROP SCHEMA IF EXISTS ${quotedIdentifier(schemaName)} CASCADE`);
    } finally {
      await client.end();
    }
  });

  void test('migrates non-empty Phase 4 data and gates the final invariant on a clean audit', async () => {
    for (const migration of PHASE_FOUR_MIGRATIONS) {
      await applyMigration(migration);
    }
    await insertPhaseFourFixture();

    for (const migration of PHASE_FIVE_COMPATIBILITY_MIGRATIONS) {
      await applyMigration(migration);
    }

    const relationTable = await client.query<{ exists: boolean }>(
      `
        SELECT EXISTS (
          SELECT 1
          FROM information_schema.tables
          WHERE table_schema = $1 AND table_name = 'LocationFish'
        ) AS "exists"
      `,
      [schemaName],
    );
    assert.equal(relationTable.rows[0]?.exists, false);

    const memberships = await client.query<{
      createdAt: Date;
      fishId: string;
      fishingBaseId: string;
    }>(`
      SELECT "fishingBaseId", "fishId", "createdAt"
      FROM "FishingBaseFish"
      ORDER BY "fishId"
    `);
    assert.equal(memberships.rowCount, 2);
    assert.deepEqual(memberships.rows[0], {
      fishingBaseId: '00000000-0000-4000-8000-000000000010',
      fishId: '00000000-0000-4000-8000-000000000020',
      createdAt: new Date('2026-01-01T00:00:00Z'),
    });

    const fish = await client.query<{ id: string; name: string }>(
      `SELECT "id", "name" FROM "Fish" ORDER BY "id"`,
    );
    assert.deepEqual(fish.rows, [
      { id: '00000000-0000-4000-8000-000000000020', name: 'Жерех-лысач' },
      { id: '00000000-0000-4000-8000-000000000022', name: 'Сайда' },
    ]);

    const reports = await client.query<{
      fishId: string;
      fishingMethod: string;
      id: string;
      rawSourceText: string | null;
      spotPositionRaw: string | null;
      userNoteRaw: string | null;
    }>(`
      SELECT
        "id",
        "fishId",
        "fishingMethod"::text AS "fishingMethod",
        "spotPositionRaw",
        "userNoteRaw",
        "rawSourceText"
      FROM "CatchReport"
    `);
    assert.deepEqual(reports.rows, [
      {
        id: '00000000-0000-4000-8000-000000000040',
        fishId: '00000000-0000-4000-8000-000000000020',
        fishingMethod: 'SPINNING',
        spotPositionRaw: 'блокнот',
        userNoteRaw: 'старая заметка',
        rawSourceText: null,
      },
    ]);

    await assert.rejects(
      applyMigration(PHASE_FIVE_INVARIANT_MIGRATION),
      /CatchReport v2 invariant audit failed/u,
    );
    await client.query('ROLLBACK');

    const afterRejectedInvariant = await client.query<{
      spinningSize: string | null;
      spinningSpeed: string | null;
    }>(`
      SELECT
        "spinningSize"::text AS "spinningSize",
        "spinningSpeed"::text AS "spinningSpeed"
      FROM "CatchReport"
      WHERE "id" = '00000000-0000-4000-8000-000000000040'
    `);
    assert.deepEqual(afterRejectedInvariant.rows, [{ spinningSize: null, spinningSpeed: null }]);

    const rejectedConstraint = await client.query<{ exists: boolean }>(`
      SELECT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conrelid = '"CatchReport"'::regclass
          AND conname = 'CatchReport_method_observations_check'
      ) AS "exists"
    `);
    assert.equal(rejectedConstraint.rows[0]?.exists, false);

    await client.query(`
      UPDATE "CatchReport"
      SET "spinningSize" = 'MEDIUM', "spinningSpeed" = 'SLOW'
      WHERE "id" = '00000000-0000-4000-8000-000000000040'
    `);
    await applyMigration(PHASE_FIVE_INVARIANT_MIGRATION);

    const appliedConstraint = await client.query<{ exists: boolean }>(`
      SELECT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conrelid = '"CatchReport"'::regclass
          AND conname = 'CatchReport_method_observations_check'
      ) AS "exists"
    `);
    assert.equal(appliedConstraint.rows[0]?.exists, true);
    await assert.rejects(
      client.query(`
        UPDATE "CatchReport"
        SET "spinningSpeed" = NULL
        WHERE "id" = '00000000-0000-4000-8000-000000000040'
      `),
      /CatchReport_method_observations_check/u,
    );

    await client.query('ROLLBACK');
    await applyMigration(RELAX_OBSERVATIONS_MIGRATION);
    await client.query(`
      UPDATE "CatchReport"
      SET "spinningSize" = NULL, "spinningSpeed" = NULL
      WHERE "id" = '00000000-0000-4000-8000-000000000040'
    `);
    await client.query(`
      UPDATE "CatchReport"
      SET "fishingMethod" = 'BAIT_FISHING'
      WHERE "id" = '00000000-0000-4000-8000-000000000040'
    `);
    await assert.rejects(
      client.query(`
        UPDATE "CatchReport"
        SET "spinningSize" = 'MEDIUM'
        WHERE "id" = '00000000-0000-4000-8000-000000000040'
      `),
      /CatchReport_method_observations_check/u,
    );
  });

  void test('fails the suffix merge atomically when active states conflict', async () => {
    const conflictSchema = `phase5_conflict_${randomUUID().replaceAll('-', '')}`;
    const conflictClient = new Client({ connectionString: databaseConfiguration.testDatabaseUrl });
    await conflictClient.connect();

    try {
      await conflictClient.query(`CREATE SCHEMA ${quotedIdentifier(conflictSchema)}`);
      await conflictClient.query(`SET search_path TO ${quotedIdentifier(conflictSchema)}`);
      for (const migration of PHASE_FOUR_MIGRATIONS) {
        await applyMigration(migration, conflictClient);
      }
      await conflictClient.query(`
        INSERT INTO "Fish" ("id", "name", "nameNormalized", "isActive") VALUES
          (
            '10000000-0000-4000-8000-000000000001',
            'Сайда',
            'сайда',
            TRUE
          ),
          (
            '10000000-0000-4000-8000-000000000002',
            'Сайда (спиннинг)',
            'сайда (спиннинг)',
            FALSE
          );
      `);

      await assert.rejects(
        applyMigration(PHASE_FIVE_COMPATIBILITY_MIGRATIONS[0], conflictClient),
        /active-state resolution/u,
      );
      await conflictClient.query('ROLLBACK');

      const fish = await conflictClient.query<{ isActive: boolean; name: string }>(
        `SELECT "name", "isActive" FROM "Fish" ORDER BY "id"`,
      );
      assert.deepEqual(fish.rows, [
        { name: 'Сайда', isActive: true },
        { name: 'Сайда (спиннинг)', isActive: false },
      ]);
      const tables = await conflictClient.query<{ table_name: string }>(`
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = current_schema()
          AND table_name IN ('LocationFish', 'FishingBaseFish')
        ORDER BY table_name
      `);
      assert.deepEqual(tables.rows, [{ table_name: 'LocationFish' }]);
    } finally {
      await conflictClient.query(
        `DROP SCHEMA IF EXISTS ${quotedIdentifier(conflictSchema)} CASCADE`,
      );
      await conflictClient.end();
    }
  });
});

void describe('CatchReport contributor identity migration semantics', () => {
  void test('backfills immutable contributor identities and enforces nullable unique import identities', async () => {
    const configuration = getTestDatabaseConfiguration(process.env);
    const identitySchema = `contributor_identity_${randomUUID().replaceAll('-', '')}`;
    const identityClient = new Client({ connectionString: configuration.testDatabaseUrl });
    await identityClient.connect();

    try {
      await identityClient.query(`CREATE SCHEMA ${quotedIdentifier(identitySchema)}`);
      await identityClient.query(`SET search_path TO ${quotedIdentifier(identitySchema)}`);

      for (const migration of PHASE_FOUR_MIGRATIONS) {
        await applyMigration(migration, identityClient);
      }
      await insertPhaseFourFixture(identityClient);
      for (const migration of PHASE_FIVE_COMPATIBILITY_MIGRATIONS) {
        await applyMigration(migration, identityClient);
      }

      await identityClient.query(`
        UPDATE "CatchReport"
        SET
          "spinningSize" = 'MEDIUM',
          "spinningSpeed" = 'SLOW',
          "createdAt" = '2026-01-04T05:06:07.123Z',
          "updatedAt" = '2026-02-04T05:06:07.456Z'
        WHERE "id" = '00000000-0000-4000-8000-000000000040';
      `);
      await applyMigration(PHASE_FIVE_INVARIANT_MIGRATION, identityClient);

      await identityClient.query(`
        INSERT INTO "User" (
          "id", "email", "nickname", "nicknameNormalized", "passwordHash"
        ) VALUES (
          '00000000-0000-4000-8000-000000000002',
          'second-migration@example.ru',
          'SecondMigrationUser',
          'secondmigrationuser',
          'not-a-real-password-hash'
        );

        INSERT INTO "CatchReport" (
          "id",
          "userId",
          "locationId",
          "fishId",
          "baitId",
          "weightGrams",
          "fishingMethod",
          "spinningSize",
          "spinningSpeed",
          "createdAt",
          "updatedAt"
        ) VALUES
          (
            '00000000-0000-4000-8000-000000000041',
            '00000000-0000-4000-8000-000000000001',
            '00000000-0000-4000-8000-000000000011',
            '00000000-0000-4000-8000-000000000020',
            '00000000-0000-4000-8000-000000000030',
            4100,
            'SPINNING',
            'SMALL',
            'FAST',
            '2026-01-05T05:06:07.123Z',
            '2026-02-05T05:06:07.456Z'
          ),
          (
            '00000000-0000-4000-8000-000000000042',
            '00000000-0000-4000-8000-000000000002',
            '00000000-0000-4000-8000-000000000011',
            '00000000-0000-4000-8000-000000000020',
            '00000000-0000-4000-8000-000000000030',
            4200,
            'SPINNING',
            'LARGE',
            'MEDIUM',
            '2026-01-06T05:06:07.123Z',
            '2026-02-06T05:06:07.456Z'
          );
      `);

      const beforeMigration = await identityClient.query<{
        createdAt: Date;
        id: string;
        updatedAt: Date;
        userId: string;
      }>(`
        SELECT "id", "userId", "createdAt", "updatedAt"
        FROM "CatchReport"
        ORDER BY "id"
      `);

      await applyMigration(CONTRIBUTOR_IDENTITY_MIGRATION, identityClient);

      const migratedReports = await identityClient.query<{
        contributorKey: string;
        createdAt: Date;
        id: string;
        importKey: string | null;
        updatedAt: Date;
        userId: string;
      }>(`
        SELECT
          "id",
          "userId",
          "contributorKey",
          "importKey",
          "createdAt",
          "updatedAt"
        FROM "CatchReport"
        ORDER BY "id"
      `);
      assert.deepEqual(
        migratedReports.rows.map(({ createdAt, id, updatedAt, userId }) => ({
          createdAt,
          id,
          updatedAt,
          userId,
        })),
        beforeMigration.rows,
      );
      assert.deepEqual(
        migratedReports.rows.map(({ contributorKey, importKey, userId }) => ({
          contributorKey,
          importKey,
          userId,
        })),
        [
          {
            contributorKey: 'local-user:00000000-0000-4000-8000-000000000001',
            importKey: null,
            userId: '00000000-0000-4000-8000-000000000001',
          },
          {
            contributorKey: 'local-user:00000000-0000-4000-8000-000000000001',
            importKey: null,
            userId: '00000000-0000-4000-8000-000000000001',
          },
          {
            contributorKey: 'local-user:00000000-0000-4000-8000-000000000002',
            importKey: null,
            userId: '00000000-0000-4000-8000-000000000002',
          },
        ],
      );

      const identityColumns = await identityClient.query<{
        characterMaximumLength: number;
        columnName: string;
        isNullable: 'NO' | 'YES';
      }>(`
        SELECT
          column_name AS "columnName",
          is_nullable AS "isNullable",
          character_maximum_length AS "characterMaximumLength"
        FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND table_name = 'CatchReport'
          AND column_name IN ('contributorKey', 'importKey')
        ORDER BY column_name
      `);
      assert.deepEqual(identityColumns.rows, [
        { characterMaximumLength: 255, columnName: 'contributorKey', isNullable: 'NO' },
        { characterMaximumLength: 255, columnName: 'importKey', isNullable: 'YES' },
      ]);

      async function copyReport(
        id: string,
        contributorKey: string | null,
        importKey: string | null,
      ): Promise<void> {
        await identityClient.query(
          `
            INSERT INTO "CatchReport" (
              "id",
              "userId",
              "contributorKey",
              "importKey",
              "locationId",
              "fishId",
              "baitId",
              "weightGrams",
              "fishingMethod",
              "holeDepthCm",
              "spotPositionRaw",
              "fishingNote",
              "spinningSize",
              "spinningSpeed",
              "userNoteRaw",
              "rawSourceText",
              "createdAt",
              "updatedAt"
            )
            SELECT
              $1::uuid,
              "userId",
              $2,
              $3,
              "locationId",
              "fishId",
              "baitId",
              "weightGrams",
              "fishingMethod",
              "holeDepthCm",
              "spotPositionRaw",
              "fishingNote",
              "spinningSize",
              "spinningSpeed",
              "userNoteRaw",
              "rawSourceText",
              "createdAt",
              "updatedAt"
            FROM "CatchReport"
            WHERE "id" = '00000000-0000-4000-8000-000000000040'
          `,
          [id, contributorKey, importKey],
        );
      }

      await assert.rejects(
        copyReport('00000000-0000-4000-8000-000000000050', '', null),
        /CatchReport_contributorKey_nonempty_check/u,
      );
      await assert.rejects(
        copyReport(
          '00000000-0000-4000-8000-000000000051',
          'external:forum:17aed50d21c258564c67a441a1820e90',
          '',
        ),
        /CatchReport_importKey_nonempty_check/u,
      );

      await copyReport(
        '00000000-0000-4000-8000-000000000052',
        'external:forum:17aed50d21c258564c67a441a1820e90',
        'forum:observation:05ccba0a319baa17b702',
      );
      await copyReport(
        '00000000-0000-4000-8000-000000000053',
        'external:forum:17aed50d21c258564c67a441a1820e90',
        'forum:observation:2e749920f9b6357f04f8',
      );
      await copyReport(
        '00000000-0000-4000-8000-000000000054',
        'external:forum:e2270c0463822db11286ca442be2d401',
        'forum:observation:cbba598828e6cd581e36',
      );
      await assert.rejects(
        copyReport(
          '00000000-0000-4000-8000-000000000055',
          'external:forum:62106f30bbff7b32dbbcd92f504fe35a',
          'forum:observation:05ccba0a319baa17b702',
        ),
        /CatchReport_importKey_key/u,
      );

      const nullImportKeys = await identityClient.query<{ count: string }>(`
        SELECT count(*)::text AS "count"
        FROM "CatchReport"
        WHERE "importKey" IS NULL
      `);
      assert.equal(nullImportKeys.rows[0]?.count, '3');

      const repeatedContributors = await identityClient.query<{ count: string }>(`
        SELECT count(*)::text AS "count"
        FROM "CatchReport"
        WHERE "contributorKey" = 'external:forum:17aed50d21c258564c67a441a1820e90'
      `);
      assert.equal(repeatedContributors.rows[0]?.count, '2');

      await identityClient.query(`
        UPDATE "CatchReport"
        SET
          "contributorKey" = "contributorKey",
          "importKey" = "importKey"
        WHERE "id" = '00000000-0000-4000-8000-000000000052'
      `);
      await assert.rejects(
        identityClient.query(`
          UPDATE "CatchReport"
          SET "contributorKey" = 'external:forum:changed'
          WHERE "id" = '00000000-0000-4000-8000-000000000052'
        `),
        /CatchReport contributorKey is immutable/u,
      );
      await assert.rejects(
        identityClient.query(`
          UPDATE "CatchReport"
          SET "importKey" = 'forum:observation:changed'
          WHERE "id" = '00000000-0000-4000-8000-000000000052'
        `),
        /CatchReport importKey is immutable/u,
      );
    } finally {
      await identityClient.query(
        `DROP SCHEMA IF EXISTS ${quotedIdentifier(identitySchema)} CASCADE`,
      );
      await identityClient.end();
    }
  });
});

void describe('Fish image metadata migration semantics', () => {
  void test('adds nullable unique metadata without changing existing Fish and enforces positive image keys', async () => {
    const configuration = getTestDatabaseConfiguration(process.env);
    const imageSchema = `fish_image_metadata_${randomUUID().replaceAll('-', '')}`;
    const imageClient = new Client({ connectionString: configuration.testDatabaseUrl });
    await imageClient.connect();

    try {
      await imageClient.query(`CREATE SCHEMA ${quotedIdentifier(imageSchema)}`);
      await imageClient.query(`SET search_path TO ${quotedIdentifier(imageSchema)}`);
      await applyMigration(PHASE_FOUR_MIGRATIONS[1], imageClient);
      await imageClient.query(`
        INSERT INTO "Fish" ("id", "name", "nameNormalized", "isActive") VALUES
          ('20000000-0000-4000-8000-000000000001', 'Сом', 'сом', TRUE),
          ('20000000-0000-4000-8000-000000000002', 'Карп', 'карп', FALSE);
      `);
      const before = await imageClient.query<{
        id: string;
        isActive: boolean;
        name: string;
        nameNormalized: string;
      }>(`SELECT "id", "name", "nameNormalized", "isActive" FROM "Fish" ORDER BY "id"`);

      await applyMigration(FISH_IMAGE_METADATA_MIGRATION, imageClient);

      const after = await imageClient.query<{
        id: string;
        isActive: boolean;
        name: string;
        nameNormalized: string;
      }>(`SELECT "id", "name", "nameNormalized", "isActive" FROM "Fish" ORDER BY "id"`);
      assert.deepEqual(after.rows, before.rows);

      const columns = await imageClient.query<{
        characterMaximumLength: number | null;
        columnName: string;
        dataType: string;
        isNullable: 'YES';
      }>(`
        SELECT
          column_name AS "columnName",
          data_type AS "dataType",
          character_maximum_length AS "characterMaximumLength",
          is_nullable AS "isNullable"
        FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND table_name = 'Fish'
          AND column_name IN ('forumTopicId', 'officialFishImageKey')
        ORDER BY column_name
      `);
      assert.deepEqual(columns.rows, [
        {
          characterMaximumLength: 32,
          columnName: 'forumTopicId',
          dataType: 'character varying',
          isNullable: 'YES',
        },
        {
          characterMaximumLength: null,
          columnName: 'officialFishImageKey',
          dataType: 'integer',
          isNullable: 'YES',
        },
      ]);

      await imageClient.query(`
        UPDATE "Fish"
        SET "forumTopicId" = '91', "officialFishImageKey" = 3014
        WHERE "id" = '20000000-0000-4000-8000-000000000001';
      `);
      await assert.rejects(
        imageClient.query(`
          UPDATE "Fish" SET "forumTopicId" = '91'
          WHERE "id" = '20000000-0000-4000-8000-000000000002'
        `),
        /Fish_forumTopicId_key/u,
      );
      await assert.rejects(
        imageClient.query(`
          UPDATE "Fish" SET "officialFishImageKey" = 3014
          WHERE "id" = '20000000-0000-4000-8000-000000000002'
        `),
        /Fish_officialFishImageKey_key/u,
      );
      await assert.rejects(
        imageClient.query(`
          UPDATE "Fish" SET "officialFishImageKey" = 0
          WHERE "id" = '20000000-0000-4000-8000-000000000002'
        `),
        /Fish_officialFishImageKey_positive_check/u,
      );
    } finally {
      await imageClient.query(`DROP SCHEMA IF EXISTS ${quotedIdentifier(imageSchema)} CASCADE`);
      await imageClient.end();
    }
  });
});

void describe('FishingBaseFish weight migration semantics', () => {
  void test('adds nullable integer bounds without changing memberships and enforces conservative checks', async () => {
    const configuration = getTestDatabaseConfiguration(process.env);
    const weightSchema = `base_fish_weights_${randomUUID().replaceAll('-', '')}`;
    const weightClient = new Client({ connectionString: configuration.testDatabaseUrl });
    await weightClient.connect();

    try {
      await weightClient.query(`CREATE SCHEMA ${quotedIdentifier(weightSchema)}`);
      await weightClient.query(`SET search_path TO ${quotedIdentifier(weightSchema)}`);
      for (const migration of PHASE_FOUR_MIGRATIONS) {
        await applyMigration(migration, weightClient);
      }
      for (const migration of PHASE_FIVE_COMPATIBILITY_MIGRATIONS) {
        await applyMigration(migration, weightClient);
      }
      await weightClient.query(`
        INSERT INTO "FishingBase" ("id", "name", "nameNormalized") VALUES
          ('30000000-0000-4000-8000-000000000001', 'Weight Base', 'weight base');
        INSERT INTO "Fish" ("id", "name", "nameNormalized") VALUES
          ('30000000-0000-4000-8000-000000000002', 'Weight Fish', 'weight fish');
        INSERT INTO "FishingBaseFish" ("fishingBaseId", "fishId", "createdAt") VALUES
          (
            '30000000-0000-4000-8000-000000000001',
            '30000000-0000-4000-8000-000000000002',
            '2026-08-31T12:00:00Z'
          );
      `);
      const before = await weightClient.query<{
        createdAt: Date;
        fishId: string;
        fishingBaseId: string;
      }>(`
        SELECT "fishingBaseId", "fishId", "createdAt"
        FROM "FishingBaseFish"
      `);

      await applyMigration(BASE_FISH_WEIGHT_MIGRATION, weightClient);

      const after = await weightClient.query<{
        createdAt: Date;
        fishId: string;
        fishingBaseId: string;
        maxWeightGrams: number | null;
        minWeightGrams: number | null;
      }>(`
        SELECT
          "fishingBaseId",
          "fishId",
          "createdAt",
          "minWeightGrams",
          "maxWeightGrams"
        FROM "FishingBaseFish"
      `);
      assert.deepEqual(
        after.rows.map((membership) => ({
          fishingBaseId: membership.fishingBaseId,
          fishId: membership.fishId,
          createdAt: membership.createdAt,
        })),
        before.rows,
      );
      assert.equal(after.rows[0]?.minWeightGrams, null);
      assert.equal(after.rows[0]?.maxWeightGrams, null);

      const columns = await weightClient.query<{
        columnName: string;
        dataType: string;
        isNullable: 'YES';
      }>(`
        SELECT
          column_name AS "columnName",
          data_type AS "dataType",
          is_nullable AS "isNullable"
        FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND table_name = 'FishingBaseFish'
          AND column_name IN ('minWeightGrams', 'maxWeightGrams')
        ORDER BY column_name
      `);
      assert.deepEqual(columns.rows, [
        { columnName: 'maxWeightGrams', dataType: 'integer', isNullable: 'YES' },
        { columnName: 'minWeightGrams', dataType: 'integer', isNullable: 'YES' },
      ]);

      const constraints = await weightClient.query<{
        constraintName: string;
        isValidated: boolean;
      }>(`
        SELECT conname AS "constraintName", convalidated AS "isValidated"
        FROM pg_constraint
        JOIN pg_class ON pg_class.oid = pg_constraint.conrelid
        JOIN pg_namespace ON pg_namespace.oid = pg_class.relnamespace
        WHERE pg_namespace.nspname = current_schema()
          AND pg_class.relname = 'FishingBaseFish'
          AND conname IN (
            'FishingBaseFish_minWeightGrams_positive_check',
            'FishingBaseFish_maxWeightGrams_positive_check',
            'FishingBaseFish_weight_bounds_order_check'
          )
        ORDER BY conname
      `);
      assert.deepEqual(constraints.rows, [
        {
          constraintName: 'FishingBaseFish_maxWeightGrams_positive_check',
          isValidated: true,
        },
        {
          constraintName: 'FishingBaseFish_minWeightGrams_positive_check',
          isValidated: true,
        },
        {
          constraintName: 'FishingBaseFish_weight_bounds_order_check',
          isValidated: true,
        },
      ]);

      await weightClient.query(`
        UPDATE "FishingBaseFish" SET "minWeightGrams" = NULL, "maxWeightGrams" = 100;
        UPDATE "FishingBaseFish" SET "minWeightGrams" = 10, "maxWeightGrams" = NULL;
        UPDATE "FishingBaseFish" SET "minWeightGrams" = 10, "maxWeightGrams" = 10;
        UPDATE "FishingBaseFish" SET "minWeightGrams" = NULL, "maxWeightGrams" = NULL;
      `);
      await assert.rejects(
        weightClient.query(`UPDATE "FishingBaseFish" SET "minWeightGrams" = 0`),
        /FishingBaseFish_minWeightGrams_positive_check/u,
      );
      await assert.rejects(
        weightClient.query(`UPDATE "FishingBaseFish" SET "maxWeightGrams" = -1`),
        /FishingBaseFish_maxWeightGrams_positive_check/u,
      );
      await assert.rejects(
        weightClient.query(`
          UPDATE "FishingBaseFish" SET "minWeightGrams" = 101, "maxWeightGrams" = 100
        `),
        /FishingBaseFish_weight_bounds_order_check/u,
      );
    } finally {
      await weightClient.query(`DROP SCHEMA IF EXISTS ${quotedIdentifier(weightSchema)} CASCADE`);
      await weightClient.end();
    }
  });
});

void describe('ActivityEvent migration semantics', () => {
  void test('starts empty and enforces append-only actor-attributed events', async () => {
    const configuration = getTestDatabaseConfiguration(process.env);
    const activitySchema = `activity_events_${randomUUID().replaceAll('-', '')}`;
    const activityClient = new Client({ connectionString: configuration.testDatabaseUrl });
    await activityClient.connect();

    try {
      await activityClient.query(`CREATE SCHEMA ${quotedIdentifier(activitySchema)}`);
      await activityClient.query(`SET search_path TO ${quotedIdentifier(activitySchema)}`);
      for (const migration of PHASE_FOUR_MIGRATIONS)
        await applyMigration(migration, activityClient);
      for (const migration of PHASE_FIVE_COMPATIBILITY_MIGRATIONS) {
        await applyMigration(migration, activityClient);
      }
      await applyMigration(PHASE_FIVE_INVARIANT_MIGRATION, activityClient);
      await applyMigration(CONTRIBUTOR_IDENTITY_MIGRATION, activityClient);
      await applyMigration(RELAX_OBSERVATIONS_MIGRATION, activityClient);
      await applyMigration(FISH_IMAGE_METADATA_MIGRATION, activityClient);
      await applyMigration(BASE_FISH_WEIGHT_MIGRATION, activityClient);
      await activityClient.query(`
        INSERT INTO "User" (
          "id", "email", "nickname", "nicknameNormalized", "passwordHash"
        ) VALUES (
          '10000000-0000-4000-8000-000000000001',
          'activity@example.ru',
          'Activity User',
          'activity user',
          'not-a-real-password-hash'
        );
        INSERT INTO "FishingBase" ("id", "name", "nameNormalized") VALUES
          ('20000000-0000-4000-8000-000000000001', 'Existing Base', 'existing base');
        INSERT INTO "Location" (
          "id", "fishingBaseId", "number", "name", "nameNormalized"
        ) VALUES (
          '30000000-0000-4000-8000-000000000001',
          '20000000-0000-4000-8000-000000000001',
          1,
          'Existing Location',
          'existing location'
        );
        INSERT INTO "Fish" ("id", "name", "nameNormalized") VALUES
          ('40000000-0000-4000-8000-000000000001', 'Existing Fish', 'existing fish');
        INSERT INTO "Bait" ("id", "name", "nameNormalized", "type") VALUES
          ('50000000-0000-4000-8000-000000000001', 'Existing Bait', 'existing bait', 'BAIT');
        INSERT INTO "FishingBaseFish" ("fishingBaseId", "fishId") VALUES (
          '20000000-0000-4000-8000-000000000001',
          '40000000-0000-4000-8000-000000000001'
        );
        INSERT INTO "CatchReport" (
          "id",
          "userId",
          "contributorKey",
          "locationId",
          "fishId",
          "baitId",
          "weightGrams",
          "fishingMethod"
        ) VALUES (
          '60000000-0000-4000-8000-000000000001',
          '10000000-0000-4000-8000-000000000001',
          'local-user:10000000-0000-4000-8000-000000000001',
          '30000000-0000-4000-8000-000000000001',
          '40000000-0000-4000-8000-000000000001',
          '50000000-0000-4000-8000-000000000001',
          100,
          'BAIT_FISHING'
        )
      `);

      await applyMigration(ACTIVITY_EVENT_MIGRATION, activityClient);
      const initiallyEmpty = await activityClient.query<{ count: string }>(
        `SELECT COUNT(*)::text AS "count" FROM "ActivityEvent"`,
      );
      assert.equal(initiallyEmpty.rows[0]?.count, '0');

      const inserted = await activityClient.query<{ id: string }>(`
        INSERT INTO "ActivityEvent" (
          "type",
          "subjectType",
          "subjectKey",
          "actorUserId",
          "actorNicknameSnapshot",
          "actorRoleSnapshot",
          "payload"
        ) VALUES (
          'CATCH_REPORT_BATCH_CREATED',
          'CATCH_REPORT_BATCH',
          '20000000-0000-4000-8000-000000000001',
          '10000000-0000-4000-8000-000000000001',
          'Activity User',
          'USER',
          '{"createdCount": 2}'::jsonb
        )
        RETURNING "id"::text
      `);
      assert.equal(inserted.rows[0]?.id, '1');

      await assert.rejects(
        activityClient.query(`UPDATE "ActivityEvent" SET "subjectKey" = 'changed'`),
        /ActivityEvent is append-only/u,
      );
      await assert.rejects(
        activityClient.query(`DELETE FROM "ActivityEvent"`),
        /ActivityEvent is append-only/u,
      );
      await activityClient.query(`DELETE FROM "CatchReport"`);
      await assert.rejects(
        activityClient.query(
          `DELETE FROM "User" WHERE "id" = '10000000-0000-4000-8000-000000000001'`,
        ),
        /ActivityEvent_actorUserId_fkey/u,
      );
    } finally {
      await activityClient.query(
        `DROP SCHEMA IF EXISTS ${quotedIdentifier(activitySchema)} CASCADE`,
      );
      await activityClient.end();
    }
  });
});
