import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ServiceUnavailableException } from '@nestjs/common';
import type { PrismaService } from '../prisma/prisma.service.js';
import { HealthService } from './health.service.js';

void describe('HealthService', () => {
  void it('reports a healthy database after a real query succeeds', async () => {
    let receivedQuery = '';
    const prisma = {
      $queryRawUnsafe: (query: string) => {
        receivedQuery = query;
        return Promise.resolve([{ connected: 1 }]);
      },
    } as unknown as PrismaService;
    const service = new HealthService(prisma);

    const response = await service.check();

    assert.equal(receivedQuery, 'SELECT 1');
    assert.equal(response.status, 'ok');
    assert.equal(response.application, 'up');
    assert.equal(response.database, 'up');
    assert.match(response.timestamp, /^\d{4}-\d{2}-\d{2}T/);
  });

  void it('returns a service unavailable error without leaking the database error', async () => {
    const prisma = {
      $queryRawUnsafe: () => Promise.reject(new Error('connection contains sensitive details')),
    } as unknown as PrismaService;
    const service = new HealthService(prisma);

    await assert.rejects(
      () => service.check(),
      (error: unknown) => {
        assert.ok(error instanceof ServiceUnavailableException);
        const response = error.getResponse() as Record<string, unknown>;
        assert.equal(response.status, 'error');
        assert.equal(response.application, 'up');
        assert.equal(response.database, 'down');
        assert.equal(JSON.stringify(response).includes('sensitive'), false);
        return true;
      },
    );
  });
});
