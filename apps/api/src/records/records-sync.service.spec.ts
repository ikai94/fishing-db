import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { RECORDS_PARSER_VERSION } from './records.constants.js';
import { RecordsSyncService } from './records-sync.service.js';

const HTML = `
<table>
  <thead><tr><td colspan="2">Рыба:</td><td>Вес:</td><td>Водоем:</td><td>Прим-ка:</td><td>Игрок:</td><td>Дата:</td></tr></thead>
  <tbody><tr>
    <td><img src="assets/images/fish/small/2334.png"></td>
    <td><a href="abramites-mramornyij.html">Абрамитес мраморный</a></td>
    <td>1,632 кг</td>
    <td>Амазония</td>
    <td><img src="assets/images/baits/worm.png" title="Червь"></td>
    <td>Игрок</td>
    <td>25.09.2030 14:00</td>
  </tr></tbody>
</table>`;

const originalFetch = globalThis.fetch;

void describe('official records sync', () => {
  void afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  void it('stores the RR3 bait title in the immutable snapshot row', async () => {
    let leaseOwner: string | undefined;
    let snapshotCreate: unknown;
    const prisma = {
      officialRecordSyncState: {
        upsert: () => Promise.resolve({}),
        updateMany: (query: { data: { leaseOwner?: string } }) => {
          leaseOwner = query.data.leaseOwner;
          return Promise.resolve({ count: 1 });
        },
      },
      fish: {
        findMany: () =>
          Promise.resolve([
            {
              id: '00000000-0000-4000-8000-000000000001',
              nameNormalized: 'абрамитес мраморный',
              forumTopicId: '32425',
              officialFishImageKey: 2334,
            },
          ]),
      },
      fishingBase: {
        findMany: () =>
          Promise.resolve([
            {
              id: '00000000-0000-4000-8000-000000000002',
              nameNormalized: 'амазония',
            },
          ]),
      },
      $transaction: async (run: (tx: unknown) => Promise<void>) => {
        const tx = {
          $queryRaw: () =>
            Promise.resolve([{ leaseOwner, leaseUntil: new Date('2030-09-25T12:02:00.000Z') }]),
          officialRecordSnapshot: {
            findFirst: () => Promise.resolve(null),
            create: (query: unknown) => {
              snapshotCreate = query;
              return Promise.resolve({});
            },
          },
          officialRecordSyncState: { update: () => Promise.resolve({}) },
        };
        await run(tx);
      },
    };
    const config = { getOrThrow: () => false };
    globalThis.fetch = () => Promise.resolve(new Response(HTML, { status: 200 }));

    const result = await new RecordsSyncService(prisma as never, config as never).syncNow(
      new Date('2030-09-25T12:00:00.000Z'),
    );

    assert.equal(result, true);
    const data = (
      snapshotCreate as {
        data: {
          parserVersion: number;
          rows: { create: Array<{ baitRaw: string | null }> };
        };
      }
    ).data;
    assert.equal(data.parserVersion, RECORDS_PARSER_VERSION);
    assert.equal(data.rows.create[0]?.baitRaw, 'Червь');
  });
});
