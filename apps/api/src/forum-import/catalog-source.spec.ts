import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { CatalogSnapshotSource } from './catalog-source.js';
import {
  fingerprintCatalogSnapshot,
  loadCatalogSnapshot,
  serializeCatalogSnapshot,
} from './catalog-source.js';

void describe('forum import catalog source', () => {
  void it('loads only deterministic read-only catalog projections and fingerprints sorted data', async () => {
    const queries: Array<{ delegate: string; input: unknown }> = [];
    const source = {
      fishingBase: {
        findMany: (input: unknown) => {
          queries.push({ delegate: 'fishingBase', input });
          return Promise.resolve([
            { id: 'base-z', name: 'Волга', nameNormalized: 'волга', isActive: true },
            { id: 'base-a', name: 'Амур', nameNormalized: 'амур', isActive: false },
          ]);
        },
      },
      location: {
        findMany: (input: unknown) => {
          queries.push({ delegate: 'location', input });
          return Promise.resolve([
            {
              id: 'location-z',
              fishingBaseId: 'base-z',
              number: 2,
              name: 'Яма',
              nameNormalized: 'яма',
              isActive: true,
            },
            {
              id: 'location-a',
              fishingBaseId: 'base-a',
              number: 1,
              name: 'Бухта',
              nameNormalized: 'бухта',
              isActive: false,
            },
          ]);
        },
      },
      fish: {
        findMany: (input: unknown) => {
          queries.push({ delegate: 'fish', input });
          return Promise.resolve([
            { id: 'fish-z', name: 'Щука', nameNormalized: 'щука', isActive: true },
            { id: 'fish-a', name: 'Амур', nameNormalized: 'амур', isActive: true },
          ]);
        },
      },
      bait: {
        findMany: (input: unknown) => {
          queries.push({ delegate: 'bait', input });
          return Promise.resolve([
            {
              id: 'bait-z',
              name: 'Червь',
              nameNormalized: 'червь',
              isActive: true,
              type: 'BAIT' as const,
            },
          ]);
        },
      },
      fishingBaseFish: {
        findMany: (input: unknown) => {
          queries.push({ delegate: 'fishingBaseFish', input });
          return Promise.resolve([
            { fishingBaseId: 'base-z', fishId: 'fish-z' },
            { fishingBaseId: 'base-a', fishId: 'fish-a' },
          ]);
        },
      },
    } as unknown as CatalogSnapshotSource;

    const snapshot = await loadCatalogSnapshot(source);

    assert.deepEqual(
      queries.map((query) => query.delegate),
      ['fishingBase', 'location', 'fish', 'bait', 'fishingBaseFish'],
    );
    assert.equal(snapshot.fishingBases[0]?.id, 'base-a');
    assert.equal(snapshot.locations[0]?.id, 'location-a');
    assert.equal(snapshot.fish[0]?.id, 'fish-a');
    assert.deepEqual(snapshot.memberships[0], {
      fishingBaseId: 'base-a',
      fishId: 'fish-a',
    });

    for (const query of queries) {
      const input = query.input as Record<string, unknown>;
      assert.deepEqual(Object.keys(input).sort(), ['orderBy', 'select']);
      assert.equal('where' in input, false);
    }

    const data = {
      version: snapshot.version,
      fishingBases: snapshot.fishingBases,
      locations: snapshot.locations,
      fish: snapshot.fish,
      baits: snapshot.baits,
      memberships: snapshot.memberships,
    } as const;
    assert.equal(snapshot.fingerprint, fingerprintCatalogSnapshot(data));
    assert.equal(snapshot.fingerprint.length, 64);
    assert.equal(serializeCatalogSnapshot(data), JSON.stringify(data));
  });

  void it('includes lifecycle and Bait type in the fingerprint', () => {
    const base = {
      version: 1 as const,
      fishingBases: [],
      locations: [],
      fish: [{ id: 'fish', name: 'Ёрш', nameNormalized: 'ёрш', isActive: true }],
      baits: [
        {
          id: 'bait',
          name: 'Муха',
          nameNormalized: 'муха',
          isActive: true,
          type: 'BAIT' as const,
        },
      ],
      memberships: [],
    };

    assert.notEqual(
      fingerprintCatalogSnapshot(base),
      fingerprintCatalogSnapshot({
        ...base,
        baits: [{ ...base.baits[0], type: 'LURE' }],
      }),
    );
    assert.notEqual(
      fingerprintCatalogSnapshot(base),
      fingerprintCatalogSnapshot({
        ...base,
        fish: [{ ...base.fish[0], isActive: false }],
      }),
    );
  });
});
