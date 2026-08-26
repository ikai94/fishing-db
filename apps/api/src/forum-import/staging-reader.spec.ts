import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, it } from 'node:test';
import { deriveExternalContributorKey, deriveExternalImportKey } from './identity.js';
import type { StagingCandidate } from './staging.js';
import {
  buildStagingManifest,
  serializeCandidatesJsonl,
  serializeDeterministicJson,
  writeStagingFiles,
} from './staging.js';
import { ForumStagingArtifactError, readVerifiedForumStagingBundle } from './staging-reader.js';

const BASE_ID = '10000000-0000-4000-8000-000000000001';
const LOCATION_ID = '20000000-0000-4000-8000-000000000001';
const FISH_ID = '30000000-0000-4000-8000-000000000001';
const BAIT_ID = '40000000-0000-4000-8000-000000000001';
const temporaryDirectories: string[] = [];

function candidate(ordinal: number, overrides: Partial<StagingCandidate> = {}): StagingCandidate {
  return {
    contributorKey: deriveExternalContributorKey('41'),
    importKey: deriveExternalImportKey('901', ordinal),
    fishNameRaw: 'Ёрш',
    weightGrams: 750,
    fishingBaseRaw: 'Волга',
    locationRaw: 'Омут',
    baitRaw: 'Червь',
    fishingMethod: 'BAIT_FISHING',
    holeDepthCm: 1_222,
    spotPositionRaw: 'лев.край снастей',
    fishingNote: 'FROM_BOTTOM',
    spinningSize: null,
    spinningSpeed: null,
    userNoteRaw: 'заброс с бугорка 6.76',
    resolution: {
      fish: { status: 'RESOLVED', reason: null, id: FISH_ID, name: 'Ёрш' },
      fishingBase: { status: 'RESOLVED', reason: null, id: BASE_ID, name: 'Волга' },
      location: {
        status: 'RESOLVED',
        reason: null,
        id: LOCATION_ID,
        name: 'Омут',
        number: 1,
      },
      bait: { status: 'RESOLVED', reason: null, id: BAIT_ID, name: 'Червь', type: 'BAIT' },
      fishingBaseFish: { status: 'RESOLVED' },
    },
    status: 'USABLE_COMPLETE',
    issues: [],
    ...overrides,
  };
}

async function directory(): Promise<string> {
  const value = await mkdtemp(join(tmpdir(), 'forum-staging-reader-'));
  temporaryDirectories.push(value);
  return value;
}

async function writeBundle(
  outputDirectory: string,
  candidates: readonly StagingCandidate[],
  jsonlOverride?: string,
): Promise<void> {
  const candidatesJsonl = jsonlOverride ?? serializeCandidatesJsonl(candidates);
  const candidatesCsv = 'fixture-only\r\n';
  const manifest = buildStagingManifest('a'.repeat(64), candidates.length, {
    'candidates.csv': candidatesCsv,
    'candidates.jsonl': candidatesJsonl,
  });
  await writeStagingFiles(outputDirectory, {
    'candidates.csv': candidatesCsv,
    'candidates.jsonl': candidatesJsonl,
    'manifest.json': serializeDeterministicJson(manifest),
  });
}

void describe('forum staging reader', () => {
  void afterEach(async () => {
    await Promise.all(
      temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
    );
  });

  void it('verifies the manifest and preserves COMPLETE, PARTIAL, and UNRESOLVED statuses', async () => {
    const outputDirectory = await directory();
    const complete = candidate(1);
    const partial = candidate(2, {
      weightGrams: null,
      status: 'USABLE_PARTIAL',
      issues: [{ code: 'MISSING_WEIGHT_GRAMS', field: 'weightGrams' }],
    });
    const unresolved = candidate(3, {
      contributorKey: null,
      status: 'UNRESOLVED',
      issues: [{ code: 'MISSING_EXTERNAL_MEMBER_ID', field: 'contributorKey' }],
    });
    await writeBundle(outputDirectory, [complete, partial, unresolved]);

    const result = await readVerifiedForumStagingBundle(outputDirectory);

    assert.equal(result.manifest.candidatesCount, 3);
    assert.deepEqual(
      result.candidates.map((item) => item.status),
      ['USABLE_COMPLETE', 'USABLE_PARTIAL', 'UNRESOLVED'],
    );
  });

  void it('rejects checksum changes and duplicate import keys', async () => {
    const checksumDirectory = await directory();
    await writeBundle(checksumDirectory, [candidate(1)]);
    await writeStagingFiles(checksumDirectory, {
      'candidates.jsonl': `${serializeCandidatesJsonl([candidate(1)])} `,
    });
    await assert.rejects(
      readVerifiedForumStagingBundle(checksumDirectory),
      (error: unknown) =>
        error instanceof ForumStagingArtifactError && /checksum mismatch/u.test(error.message),
    );

    const duplicateDirectory = await directory();
    const duplicate = candidate(2, { importKey: candidate(1).importKey });
    await writeBundle(duplicateDirectory, [candidate(1), duplicate]);
    await assert.rejects(
      readVerifiedForumStagingBundle(duplicateDirectory),
      (error: unknown) =>
        error instanceof ForumStagingArtifactError &&
        /Duplicate staging importKey/u.test(error.message),
    );
  });

  void it('rejects unexpected technical fields and invalid COMPLETE resolutions', async () => {
    const technicalDirectory = await directory();
    const withTechnical = { ...candidate(1), technical: { bodyText: 'private body' } };
    await writeBundle(technicalDirectory, [candidate(1)], `${JSON.stringify(withTechnical)}\n`);
    await assert.rejects(
      readVerifiedForumStagingBundle(technicalDirectory),
      (error: unknown) =>
        error instanceof ForumStagingArtifactError &&
        /unexpected or missing fields/u.test(error.message),
    );

    const invalidIdDirectory = await directory();
    const invalidId = candidate(1, {
      resolution: {
        ...candidate(1).resolution,
        fish: { status: 'RESOLVED', reason: null, id: 'not-a-uuid', name: 'Ёрш' },
      },
    });
    await writeBundle(invalidIdDirectory, [invalidId]);
    await assert.rejects(
      readVerifiedForumStagingBundle(invalidIdDirectory),
      (error: unknown) =>
        error instanceof ForumStagingArtifactError &&
        /invalid fish resolution/u.test(error.message),
    );
  });

  void it('accepts optional parser warnings on an otherwise COMPLETE candidate', async () => {
    const outputDirectory = await directory();
    const complete = candidate(1, {
      holeDepthCm: null,
      issues: [{ code: 'AMBIGUOUS_HOLE_DEPTH', field: 'holeDepthCm' }],
    });
    await writeBundle(outputDirectory, [complete]);

    const result = await readVerifiedForumStagingBundle(outputDirectory);
    assert.equal(result.candidates[0]?.status, 'USABLE_COMPLETE');
  });
});
