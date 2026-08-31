import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { ParsedForumCandidate } from './candidate-types.js';
import { resolveForumCandidate } from './catalog-resolver.js';
import type { CatalogSnapshot } from './catalog-source.js';
import { deriveExternalContributorKey, deriveExternalImportKey } from './identity.js';

function snapshot(): CatalogSnapshot {
  return {
    version: 1,
    fingerprint: 'f'.repeat(64),
    fishingBases: [
      { id: 'base-1', name: 'Волга', nameNormalized: 'волга', isActive: true },
      { id: 'base-2', name: 'Амур', nameNormalized: 'амур', isActive: true },
      {
        id: 'base-inactive',
        name: 'Старая база',
        nameNormalized: 'старая база',
        isActive: false,
      },
    ],
    locations: [
      {
        id: 'location-1',
        fishingBaseId: 'base-1',
        number: 1,
        name: 'Омут',
        nameNormalized: 'омут',
        isActive: true,
      },
      {
        id: 'location-2',
        fishingBaseId: 'base-2',
        number: 7,
        name: 'Омут',
        nameNormalized: 'омут',
        isActive: true,
      },
    ],
    fish: [
      { id: 'fish-1', name: 'Ёрш', nameNormalized: 'ёрш', isActive: true },
      {
        id: 'fish-2',
        name: 'Озеро-1',
        nameNormalized: 'озеро-1',
        isActive: true,
      },
      {
        id: 'fish-inactive',
        name: 'Сом',
        nameNormalized: 'сом',
        isActive: false,
      },
    ],
    baits: [
      {
        id: 'bait-1',
        name: 'Червь',
        nameNormalized: 'червь',
        type: 'BAIT',
        isActive: true,
      },
      {
        id: 'bait-2',
        name: 'Блесна',
        nameNormalized: 'блесна',
        type: 'LURE',
        isActive: true,
      },
      {
        id: 'bait-inactive',
        name: 'Старая муха',
        nameNormalized: 'старая муха',
        type: 'BAIT',
        isActive: false,
      },
    ],
    memberships: [
      { fishingBaseId: 'base-1', fishId: 'fish-1' },
      { fishingBaseId: 'base-1', fishId: 'fish-inactive' },
    ],
  };
}

function candidate(overrides: Partial<ParsedForumCandidate> = {}): ParsedForumCandidate {
  return {
    contributorKey: deriveExternalContributorKey('42'),
    importKey: deriveExternalImportKey('9001', 1),
    candidateOrdinal: 1,
    fishNameRaw: 'Ёрш',
    weightGrams: 1_250,
    fishingBaseRaw: 'Волга',
    locationRaw: 'Омут',
    baitRaw: 'Червь',
    fishingMethod: null,
    holeDepthCm: 1_222,
    spotPositionRaw: 'лев.край снастей',
    fishingNote: 'FROM_BOTTOM',
    spinningSize: null,
    spinningSpeed: null,
    userNoteRaw: 'заброс с бугорка 6.76',
    issues: [],
    technical: {
      subforumId: '70',
      topicId: '800',
      postId: '9001',
      sourceRange: { startOffset: 0, endOffset: 10, startLine: 1, endLine: 1 },
      sourceText: 'local technical source only',
      supplementarySourceRanges: [],
    },
    ...overrides,
  };
}

void describe('forum catalog resolver', () => {
  void it('uses exact canonical normalization, Base-scoped Location, and Bait-derived method', () => {
    const resolved = resolveForumCandidate(
      candidate({ fishingBaseRaw: '  ВОЛГА ', locationRaw: ' омут ' }),
      snapshot(),
    );

    assert.equal(resolved.status, 'USABLE_COMPLETE');
    assert.equal(resolved.fishingMethod, 'BAIT_FISHING');
    assert.equal(resolved.resolution.fishingBase.id, 'base-1');
    assert.equal(resolved.resolution.location.id, 'location-1');
    assert.equal(resolved.resolution.location.number, 1);
    assert.equal(resolved.resolution.bait.type, 'BAIT');
    assert.equal(resolved.resolution.fishingBaseFish.status, 'RESOLVED');
    assert.deepEqual(resolved.issues, []);
    assert.equal(resolved.fishingBaseRaw, '  ВОЛГА ');
    assert.equal(resolved.spotPositionRaw, 'лев.край снастей');
  });

  void it('does not merge е/ё or punctuation variants', () => {
    const eYo = resolveForumCandidate(candidate({ fishNameRaw: 'Ерш' }), snapshot());
    const punctuation = resolveForumCandidate(candidate({ fishNameRaw: 'Озеро 1' }), snapshot());

    assert.equal(eYo.resolution.fish.reason, 'NOT_FOUND');
    assert.equal(eYo.status, 'UNRESOLVED');
    assert.equal(punctuation.resolution.fish.reason, 'NOT_FOUND');
    assert.equal(punctuation.status, 'UNRESOLVED');
  });

  void it('accepts explicit caller-scoped catalog raw overrides without changing source raw fields', () => {
    const resolved = resolveForumCandidate(
      candidate({ fishNameRaw: 'Ерш', locationRaw: 'Омут!', baitRaw: 'Червь!' }),
      snapshot(),
      {
        catalogRawOverride: () => ({
          fishNameRaw: 'Ёрш',
          locationRaw: 'Омут',
          baitRaw: 'Червь',
        }),
      },
    );

    assert.equal(resolved.status, 'USABLE_COMPLETE');
    assert.equal(resolved.fishNameRaw, 'Ерш');
    assert.equal(resolved.locationRaw, 'Омут!');
    assert.equal(resolved.baitRaw, 'Червь!');
    assert.equal(resolved.resolution.fish.name, 'Ёрш');
    assert.equal(resolved.resolution.location.name, 'Омут');
    assert.equal(resolved.resolution.bait.name, 'Червь');
  });

  void it('preserves exact inactive reference identity but does not mark it usable', () => {
    const resolved = resolveForumCandidate(candidate({ fishNameRaw: 'Сом' }), snapshot());

    assert.deepEqual(resolved.resolution.fish, {
      status: 'UNRESOLVED',
      reason: 'INACTIVE',
      id: 'fish-inactive',
      name: 'Сом',
    });
    assert.deepEqual(resolved.resolution.fishingBaseFish, {
      status: 'UNRESOLVED',
      reason: 'DEPENDENCY_UNRESOLVED',
    });
    assert.equal(resolved.status, 'UNRESOLVED');

    const inactiveBait = resolveForumCandidate(candidate({ baitRaw: 'Старая муха' }), snapshot());
    assert.equal(inactiveBait.resolution.bait.reason, 'INACTIVE');
    assert.equal(inactiveBait.resolution.bait.type, 'BAIT');
    assert.equal(inactiveBait.fishingMethod, null);

    const inactiveBase = resolveForumCandidate(
      candidate({ fishingBaseRaw: 'Старая база' }),
      snapshot(),
    );
    assert.equal(inactiveBase.resolution.fishingBase.reason, 'INACTIVE');
    assert.equal(inactiveBase.resolution.location.reason, 'DEPENDENCY_UNRESOLVED');
  });

  void it('blocks a missing current Base-to-Fish membership', () => {
    const resolved = resolveForumCandidate(candidate({ fishingBaseRaw: 'Амур' }), snapshot());

    assert.equal(resolved.resolution.location.id, 'location-2');
    assert.deepEqual(resolved.resolution.fishingBaseFish, {
      status: 'MISSING',
      reason: 'MISSING_MEMBERSHIP',
    });
    assert.equal(resolved.status, 'UNRESOLVED');
    assert.ok(
      resolved.issues.some((issue) => issue.code === 'MISSING_FISHING_BASE_FISH_MEMBERSHIP'),
    );
  });

  void it('distinguishes missing source fields from unknown raw catalog values', () => {
    const partial = resolveForumCandidate(candidate({ baitRaw: null }), snapshot());
    const unresolved = resolveForumCandidate(candidate({ baitRaw: 'Неизвестная' }), snapshot());

    assert.equal(partial.resolution.bait.status, 'MISSING');
    assert.equal(partial.status, 'USABLE_PARTIAL');
    assert.equal(unresolved.resolution.bait.reason, 'NOT_FOUND');
    assert.equal(unresolved.status, 'UNRESOLVED');
  });

  void it('derives the method and permits omitted spinning observations after exact Lure resolution', () => {
    const complete = resolveForumCandidate(
      candidate({
        baitRaw: 'Блесна',
        holeDepthCm: null,
        spinningSize: 'SMALL',
        spinningSpeed: 'FAST',
      }),
      snapshot(),
    );
    const withoutSettings = resolveForumCandidate(
      candidate({ baitRaw: 'Блесна', holeDepthCm: null }),
      snapshot(),
    );
    const conflict = resolveForumCandidate(
      candidate({
        baitRaw: 'Блесна',
        fishingMethod: 'BAIT_FISHING',
        spinningSize: 'SMALL',
        spinningSpeed: 'FAST',
      }),
      snapshot(),
    );

    assert.equal(complete.fishingMethod, 'SPINNING');
    assert.equal(complete.status, 'USABLE_COMPLETE');
    assert.equal(withoutSettings.status, 'USABLE_COMPLETE');
    assert.deepEqual(withoutSettings.issues, []);
    assert.equal(conflict.status, 'UNRESOLVED');
    assert.ok(conflict.issues.some((issue) => issue.code === 'FISHING_METHOD_CONFLICT'));
  });

  void it('keeps optional parser ambiguity as a warning while missing identity remains blocking', () => {
    const resolved = resolveForumCandidate(
      candidate({
        contributorKey: null,
        issues: [{ code: 'AMBIGUOUS_HOLE_DEPTH', field: 'holeDepthCm' }],
      }),
      snapshot(),
    );

    assert.equal(resolved.status, 'UNRESOLVED');
    assert.ok(resolved.issues.some((issue) => issue.code === 'MISSING_EXTERNAL_MEMBER_ID'));
    assert.ok(resolved.issues.some((issue) => issue.code === 'AMBIGUOUS_HOLE_DEPTH'));
  });

  void it('does not block an otherwise complete candidate on an optional parser warning', () => {
    const resolved = resolveForumCandidate(
      candidate({ issues: [{ code: 'AMBIGUOUS_HOLE_DEPTH', field: 'holeDepthCm' }] }),
      snapshot(),
    );

    assert.equal(resolved.status, 'USABLE_COMPLETE');
    assert.deepEqual(resolved.issues, [{ code: 'AMBIGUOUS_HOLE_DEPTH', field: 'holeDepthCm' }]);
  });
});
