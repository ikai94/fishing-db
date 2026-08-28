import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { FishReconciliationEntry } from '../prisma/fish-catalog-audit.js';
import { resolveForumCandidate } from './catalog-resolver.js';
import {
  fingerprintCatalogSnapshot,
  type CatalogSnapshot,
  type CatalogSnapshotData,
} from './catalog-source.js';
import { buildCandidateIdentityManifest } from './candidate-identity-manifest.js';
import type { ParsedForumCandidate, TechnicalForumPost } from './candidate-types.js';
import {
  assertCandidateIdentityManifestExactlyEqual,
  ForumFishCatalogRecoveryError,
  recoverForumFishCatalogCandidates,
  type FishReconciliationManifest,
  type ForumFishCatalogRecoveryInput,
} from './fish-catalog-recovery.js';
import { deriveExternalContributorKey, deriveExternalImportKey } from './identity.js';
import { toStagingCandidate } from './staging.js';

const OLD_FISH_ID = '11111111-1111-4111-8111-111111111111';
const TARGET_FISH_ID = '22222222-2222-4222-8222-222222222222';
const OTHER_FISH_ID = '33333333-3333-4333-8333-333333333333';
const BASE_ID = '44444444-4444-4444-8444-444444444444';
const LOCATION_ID = '55555555-5555-4555-8555-555555555555';
const BAIT_ID = '66666666-6666-4666-8666-666666666666';

const POST: TechnicalForumPost = {
  subforumId: '70',
  topicId: '700',
  postId: '9000',
  memberId: '42',
  topicTitle: 'Старая рыба',
  bodyText: 'Старая рыба 1 кг. Поймана на База: Локация, Наживка.',
};

function catalogSnapshot(
  fish: CatalogSnapshotData['fish'],
  memberships: CatalogSnapshotData['memberships'] = [
    { fishingBaseId: BASE_ID, fishId: OLD_FISH_ID },
  ],
): CatalogSnapshot {
  const data: CatalogSnapshotData = {
    version: 1,
    fishingBases: [{ id: BASE_ID, name: 'База', nameNormalized: 'база', isActive: true }],
    locations: [
      {
        id: LOCATION_ID,
        fishingBaseId: BASE_ID,
        number: 1,
        name: 'Локация',
        nameNormalized: 'локация',
        isActive: true,
      },
    ],
    fish,
    baits: [
      {
        id: BAIT_ID,
        name: 'Наживка',
        nameNormalized: 'наживка',
        type: 'BAIT',
        isActive: true,
      },
    ],
    memberships,
  };
  return { ...data, fingerprint: fingerprintCatalogSnapshot(data) };
}

function candidate(
  ordinal: number,
  fishNameRaw: string,
  overrides: Partial<ParsedForumCandidate> = {},
): ParsedForumCandidate {
  return {
    contributorKey: deriveExternalContributorKey('42'),
    importKey: deriveExternalImportKey(POST.postId, ordinal),
    candidateOrdinal: ordinal,
    fishNameRaw,
    weightGrams: 1_000,
    fishingBaseRaw: 'База',
    locationRaw: 'Локация',
    baitRaw: 'Наживка',
    fishingMethod: null,
    holeDepthCm: 600,
    spotPositionRaw: null,
    fishingNote: null,
    spinningSize: null,
    spinningSpeed: null,
    userNoteRaw: null,
    issues: [],
    technical: {
      subforumId: POST.subforumId,
      topicId: POST.topicId,
      postId: POST.postId,
      sourceRange: {
        startOffset: (ordinal - 1) * 10,
        endOffset: ordinal * 10,
        startLine: ordinal,
        endLine: ordinal,
      },
      sourceText: `candidate-${String(ordinal)}`,
      supplementarySourceRanges: [],
    },
    ...overrides,
  };
}

function entry(overrides: Partial<FishReconciliationEntry> = {}): FishReconciliationEntry {
  return {
    category: 'EXPLICIT_RENAME',
    currentFishId: OLD_FISH_ID,
    currentName: 'Старая рыба',
    currentIsActive: true,
    topicId: '700',
    canonicalName: 'Каноническая рыба',
    preservesFishId: true,
    decision: 'RENAME',
    reason: 'accepted exact lineage',
    ...overrides,
  };
}

function recoveryInput(
  parsedCandidates: ParsedForumCandidate[],
  previousCatalogSnapshot: CatalogSnapshot,
  currentCatalogSnapshot: CatalogSnapshot,
  entries: FishReconciliationEntry[] = [entry()],
): ForumFishCatalogRecoveryInput {
  const identities = buildCandidateIdentityManifest('all-parent-69', [POST], parsedCandidates);
  const previousCandidates = parsedCandidates.map((parsed) =>
    toStagingCandidate(resolveForumCandidate(parsed, previousCatalogSnapshot)),
  );
  const fishReconciliation: FishReconciliationManifest = {
    schemaVersion: 2,
    mode: 'APPLY_READY',
    sourceCatalogFingerprint: previousCatalogSnapshot.fingerprint,
    entries,
  };
  return {
    scopeKey: 'all-parent-69',
    pinnedIdentities: identities,
    currentIdentities: structuredClone(identities),
    parsedCandidates,
    previousStaging: {
      manifest: {
        version: 1,
        catalogSnapshotFingerprint: previousCatalogSnapshot.fingerprint,
        candidatesCount: previousCandidates.length,
        files: [],
      },
      candidates: previousCandidates,
    },
    previousCatalogSnapshot,
    currentCatalogSnapshot,
    fishReconciliation,
  };
}

void describe('forum69 Fish-catalog recovery', () => {
  void it('preserves COMPLETE through UUID lineage and makes only old non-COMPLETE exact matches newly importable', () => {
    const previous = catalogSnapshot([
      {
        id: OLD_FISH_ID,
        name: 'Старая рыба',
        nameNormalized: 'старая рыба',
        isActive: true,
      },
    ]);
    const current = catalogSnapshot([
      {
        id: OLD_FISH_ID,
        name: 'Каноническая рыба',
        nameNormalized: 'каноническая рыба',
        isActive: true,
      },
    ]);
    const oldComplete = candidate(1, 'Старая рыба');
    const newlyExact = candidate(2, 'Каноническая рыба');

    const result = recoverForumFishCatalogCandidates(
      recoveryInput([oldComplete, newlyExact], previous, current),
    );

    assert.deepEqual(result.summary.candidates.previous, {
      USABLE_COMPLETE: 1,
      USABLE_PARTIAL: 0,
      UNRESOLVED: 1,
    });
    assert.deepEqual(result.summary.candidates.recovered, {
      USABLE_COMPLETE: 2,
      USABLE_PARTIAL: 0,
      UNRESOLVED: 0,
    });
    assert.equal(result.summary.candidates.newlyComplete, 1);
    assert.deepEqual(result.newlyImportableImportKeys, [newlyExact.importKey]);
    assert.equal(result.summary.lineage.fallbackCandidates, 1);
    assert.deepEqual(result.summary.lineage.byPreviousStatus, { USABLE_COMPLETE: 1 });
    assert.equal(result.candidates[0]?.fishNameRaw, 'Старая рыба');
    assert.equal(result.candidates[0]?.resolution.fish.id, OLD_FISH_ID);
    assert.equal(result.candidates[0]?.importKey, oldComplete.importKey);
    assert.equal(result.candidates[0]?.contributorKey, oldComplete.contributorKey);
  });

  void it('never folds е/ё while resolving a previously unresolved raw Fish name', () => {
    const previous = catalogSnapshot(
      [
        {
          id: OLD_FISH_ID,
          name: 'Ёрш',
          nameNormalized: 'ёрш',
          isActive: false,
        },
      ],
      [],
    );
    const current = catalogSnapshot([
      {
        id: OLD_FISH_ID,
        name: 'Ёрш канонический',
        nameNormalized: 'ёрш канонический',
        isActive: true,
      },
    ]);
    const unresolved = candidate(1, 'Ерш');
    const input = recoveryInput([unresolved], previous, current, [
      entry({ currentName: 'Ёрш', canonicalName: 'Ёрш канонический' }),
    ]);

    const result = recoverForumFishCatalogCandidates(input);

    assert.equal(result.summary.lineage.fallbackCandidates, 0);
    assert.equal(result.candidates[0]?.status, 'UNRESOLVED');
    assert.equal(result.candidates[0]?.resolution.fish.reason, 'NOT_FOUND');
    assert.deepEqual(result.newlyImportableImportKeys, []);
  });

  void it('never applies UUID lineage when the previous Fish resolution was unresolved', () => {
    const previous = catalogSnapshot(
      [
        {
          id: OLD_FISH_ID,
          name: 'Старая рыба',
          nameNormalized: 'старая рыба',
          isActive: false,
        },
      ],
      [],
    );
    const current = catalogSnapshot([
      {
        id: OLD_FISH_ID,
        name: 'Каноническая рыба',
        nameNormalized: 'каноническая рыба',
        isActive: true,
      },
    ]);
    const parsed = candidate(1, 'Старая рыба');
    const input = recoveryInput([parsed], previous, current);
    assert.equal(input.previousStaging.candidates[0]?.resolution.fish.reason, 'INACTIVE');
    assert.equal(input.previousStaging.candidates[0]?.resolution.fish.id, OLD_FISH_ID);

    const result = recoverForumFishCatalogCandidates(input);

    assert.equal(result.summary.lineage.fallbackCandidates, 0);
    assert.equal(result.summary.lineage.fallbackPreviouslyUnresolvedFish, 0);
    assert.equal(result.candidates[0]?.resolution.fish.reason, 'NOT_FOUND');
    assert.equal(result.candidates[0]?.status, 'UNRESOLVED');
  });

  void it('requires strict identity-manifest equality and rejects append-only candidates', () => {
    const parsed = [candidate(1, 'Старая рыба')];
    const pinned = buildCandidateIdentityManifest('all-parent-69', [POST], parsed);
    const appended = structuredClone(pinned);
    const boundary = structuredClone(appended.posts[0]?.candidates[0]);
    assert.ok(boundary);
    boundary.candidateOrdinal = 2;
    appended.posts[0]?.candidates.push(boundary);

    assert.throws(
      () => assertCandidateIdentityManifestExactlyEqual(pinned, appended),
      ForumFishCatalogRecoveryError,
    );
  });

  void it('rejects contributor identity changes even when candidate boundaries are unchanged', () => {
    const previous = catalogSnapshot([
      {
        id: OLD_FISH_ID,
        name: 'Старая рыба',
        nameNormalized: 'старая рыба',
        isActive: true,
      },
    ]);
    const current = catalogSnapshot([
      {
        id: OLD_FISH_ID,
        name: 'Каноническая рыба',
        nameNormalized: 'каноническая рыба',
        isActive: true,
      },
    ]);
    const parsed = candidate(1, 'Старая рыба');
    const input = recoveryInput([parsed], previous, current);
    input.parsedCandidates = [{ ...parsed, contributorKey: deriveExternalContributorKey('43') }];

    assert.throws(() => recoverForumFishCatalogCandidates(input), /contributorKey changed/u);
  });

  void it('rejects an exact current Fish that conflicts with frozen UUID lineage', () => {
    const previous = catalogSnapshot([
      {
        id: OLD_FISH_ID,
        name: 'Старая рыба',
        nameNormalized: 'старая рыба',
        isActive: true,
      },
    ]);
    const current = catalogSnapshot(
      [
        {
          id: OLD_FISH_ID,
          name: 'Каноническая рыба',
          nameNormalized: 'каноническая рыба',
          isActive: true,
        },
        {
          id: OTHER_FISH_ID,
          name: 'Старая рыба',
          nameNormalized: 'старая рыба',
          isActive: true,
        },
      ],
      [
        { fishingBaseId: BASE_ID, fishId: OLD_FISH_ID },
        { fishingBaseId: BASE_ID, fishId: OTHER_FISH_ID },
      ],
    );

    assert.throws(
      () =>
        recoverForumFishCatalogCandidates(
          recoveryInput([candidate(1, 'Старая рыба')], previous, current),
        ),
      /conflicts with frozen lineage/u,
    );
  });

  void it('follows an accepted repoint target by UUID without matching the typo name', () => {
    const previous = catalogSnapshot(
      [
        {
          id: OLD_FISH_ID,
          name: 'Рыба с опечаткой',
          nameNormalized: 'рыба с опечаткой',
          isActive: true,
        },
        {
          id: TARGET_FISH_ID,
          name: 'Каноническая рыба',
          nameNormalized: 'каноническая рыба',
          isActive: true,
        },
      ],
      [{ fishingBaseId: BASE_ID, fishId: OLD_FISH_ID }],
    );
    const current = catalogSnapshot(
      [
        {
          id: OLD_FISH_ID,
          name: 'Рыба с опечаткой',
          nameNormalized: 'рыба с опечаткой',
          isActive: false,
        },
        {
          id: TARGET_FISH_ID,
          name: 'Каноническая рыба',
          nameNormalized: 'каноническая рыба',
          isActive: true,
        },
      ],
      [{ fishingBaseId: BASE_ID, fishId: TARGET_FISH_ID }],
    );
    const parsed = candidate(1, 'Рыба с опечаткой');
    const input = recoveryInput([parsed], previous, current, [
      entry({
        category: 'REPOINT_DEACTIVATE',
        currentName: 'Рыба с опечаткой',
        canonicalName: 'Каноническая рыба',
        decision: 'REPOINT+DEACTIVATE',
        targetIsActive: false,
        repointTargetFishId: TARGET_FISH_ID,
      }),
    ]);

    const result = recoverForumFishCatalogCandidates(input);

    assert.equal(result.candidates[0]?.status, 'USABLE_COMPLETE');
    assert.equal(result.candidates[0]?.resolution.fish.id, TARGET_FISH_ID);
    assert.equal(result.candidates[0]?.fishNameRaw, 'Рыба с опечаткой');
    assert.deepEqual(result.summary.lineage.byDecision, { 'REPOINT+DEACTIVATE': 1 });
  });

  void it('fails closed when a previously COMPLETE candidate loses BaseFish membership', () => {
    const previous = catalogSnapshot([
      {
        id: OLD_FISH_ID,
        name: 'Старая рыба',
        nameNormalized: 'старая рыба',
        isActive: true,
      },
    ]);
    const current = catalogSnapshot(
      [
        {
          id: OLD_FISH_ID,
          name: 'Каноническая рыба',
          nameNormalized: 'каноническая рыба',
          isActive: true,
        },
      ],
      [],
    );

    assert.throws(
      () =>
        recoverForumFishCatalogCandidates(
          recoveryInput([candidate(1, 'Старая рыба')], previous, current),
        ),
      /previously COMPLETE candidate\(s\) regressed/u,
    );
  });
});
