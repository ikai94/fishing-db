import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { PrismaClient } from '../generated/prisma/client.js';
import { auditLegacyCatchReports } from './audit-catch-reports.js';

void describe('legacy CatchReport audit', () => {
  void it('reports missing and incompatible method-specific observations without mutating rows', async () => {
    let reads = 0;
    const prisma = {
      catchReport: {
        findMany: () => {
          reads += 1;
          return Promise.resolve([
            {
              id: '10000000-0000-4000-8000-000000000001',
              fishingMethod: 'BAIT_FISHING',
              holeDepthCm: null,
              spinningSize: null,
              spinningSpeed: null,
            },
            {
              id: '10000000-0000-4000-8000-000000000002',
              fishingMethod: 'SPINNING',
              holeDepthCm: 1_078,
              spinningSize: null,
              spinningSpeed: 'SLOW',
            },
            {
              id: '10000000-0000-4000-8000-000000000003',
              fishingMethod: 'BAIT_FISHING',
              holeDepthCm: 600,
              spinningSize: null,
              spinningSpeed: null,
            },
          ]);
        },
      },
    } as unknown as Pick<PrismaClient, 'catchReport'>;

    const result = await auditLegacyCatchReports(prisma);

    assert.equal(reads, 1);
    assert.deepEqual(result, {
      compatibleCount: 1,
      incompatibleCount: 2,
      items: [
        {
          id: '10000000-0000-4000-8000-000000000001',
          fishingMethod: 'BAIT_FISHING',
          missingFields: ['holeDepthCm'],
          incompatibleFields: [],
        },
        {
          id: '10000000-0000-4000-8000-000000000002',
          fishingMethod: 'SPINNING',
          missingFields: ['spinningSize'],
          incompatibleFields: [],
        },
      ],
    });
  });
});
