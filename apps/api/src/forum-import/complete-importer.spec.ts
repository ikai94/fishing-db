import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { PrismaClient } from '../generated/prisma/client.js';
import { assertForumImportSchemaReady, ForumCompleteImportError } from './complete-importer.js';

void describe('forum COMPLETE importer database readiness', () => {
  void it('fails closed when required migrations and schema objects are absent', async () => {
    let query = 0;
    const prisma = {
      $queryRaw: () => {
        query += 1;
        if (query === 1) return Promise.resolve([]);
        if (query === 2) return Promise.resolve([]);
        return Promise.resolve([
          { requiredConstraints: false, importKeyIndex: false, identityTrigger: false },
        ]);
      },
    } as unknown as PrismaClient;

    await assert.rejects(assertForumImportSchemaReady(prisma), (error: unknown) => {
      assert.ok(error instanceof ForumCompleteImportError);
      assert.equal(error.code, 'DATABASE_SCHEMA_NOT_READY');
      assert.match(error.message, /missing migrations/u);
      assert.match(error.message, /missing columns/u);
      assert.match(error.message, /identity trigger missing/u);
      return true;
    });
  });

  void it('converts schema inspection errors into an explicit readiness blocker', async () => {
    const prisma = {
      $queryRaw: () => Promise.reject(new Error('_prisma_migrations does not exist')),
    } as unknown as PrismaClient;

    await assert.rejects(assertForumImportSchemaReady(prisma), (error: unknown) => {
      assert.ok(error instanceof ForumCompleteImportError);
      assert.equal(error.code, 'DATABASE_SCHEMA_NOT_READY');
      assert.match(error.message, /readiness check failed/u);
      return true;
    });
  });
});
