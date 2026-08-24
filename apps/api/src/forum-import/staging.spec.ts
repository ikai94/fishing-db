import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import type { ResolvedForumCandidate } from './catalog-resolver.js';
import { deriveExternalContributorKey, deriveExternalImportKey } from './identity.js';
import {
  buildStagingArtifacts,
  serializeCandidatesCsv,
  serializeCandidatesJsonl,
  sha256Text,
  toStagingCandidate,
  writeStagingFiles,
} from './staging.js';

function resolvedCandidate(
  overrides: Omit<Partial<ResolvedForumCandidate>, 'technical'> & {
    technical?: Partial<ResolvedForumCandidate['technical']>;
  } = {},
): ResolvedForumCandidate {
  const candidateOrdinal = overrides.candidateOrdinal ?? 1;
  const postId = overrides.technical?.postId ?? '901';

  return {
    contributorKey: deriveExternalContributorKey('41'),
    importKey: deriveExternalImportKey(postId, candidateOrdinal),
    candidateOrdinal,
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
      fish: { status: 'RESOLVED', reason: null, id: 'fish-id', name: 'Ёрш' },
      fishingBase: {
        status: 'RESOLVED',
        reason: null,
        id: 'base-id',
        name: 'Волга',
      },
      location: {
        status: 'RESOLVED',
        reason: null,
        id: 'location-id',
        name: 'Омут',
        number: 1,
      },
      bait: {
        status: 'RESOLVED',
        reason: null,
        id: 'bait-id',
        name: 'Червь',
        type: 'BAIT',
      },
      fishingBaseFish: { status: 'RESOLVED', reason: null },
    },
    status: 'USABLE_COMPLETE',
    issues: [],
    ...overrides,
    technical: {
      subforumId: '70',
      topicId: '800',
      postId,
      sourceRange: { startOffset: 0, endOffset: 13, startLine: 1, endLine: 1 },
      sourceText: 'PRIVATE FORUM BODY',
      supplementarySourceRanges: [],
      ...overrides.technical,
    },
  };
}

void describe('forum staging export', () => {
  void it('projects an explicit privacy allowlist with no technical source identity or body', () => {
    const projected = toStagingCandidate(resolvedCandidate());
    const jsonl = serializeCandidatesJsonl([projected]);
    const csv = serializeCandidatesCsv([projected]);

    for (const forbidden of [
      'technical',
      'candidateOrdinal',
      'subforumId',
      'topicId',
      'postId',
      'memberId',
      'nickname',
      'sourceText',
      'bodyText',
      'rawSourceText',
      'PRIVATE FORUM BODY',
    ]) {
      assert.equal(jsonl.includes(forbidden), false, forbidden);
      assert.equal(csv.includes(forbidden), false, forbidden);
    }

    assert.deepEqual(Object.keys(projected), [
      'contributorKey',
      'importKey',
      'fishNameRaw',
      'weightGrams',
      'fishingBaseRaw',
      'locationRaw',
      'baitRaw',
      'fishingMethod',
      'holeDepthCm',
      'spotPositionRaw',
      'fishingNote',
      'spinningSize',
      'spinningSpeed',
      'userNoteRaw',
      'resolution',
      'status',
      'issues',
    ]);
  });

  void it('sorts by numeric source identity and emits byte-identical JSONL, CSV, and manifest', () => {
    const first = resolvedCandidate({
      candidateOrdinal: 2,
      technical: { subforumId: '70', topicId: '10', postId: '100' },
    });
    const second = resolvedCandidate({
      candidateOrdinal: 1,
      technical: { subforumId: '70', topicId: '2', postId: '99' },
    });

    const left = buildStagingArtifacts([first, second], 'a'.repeat(64), {
      'audit.json': '{"ok":true}\n',
    });
    const right = buildStagingArtifacts([second, first], 'a'.repeat(64), {
      'audit.json': '{"ok":true}\n',
    });

    assert.equal(left.candidatesJsonl, right.candidatesJsonl);
    assert.equal(left.candidatesCsv, right.candidatesCsv);
    assert.equal(left.manifestJson, right.manifestJson);
    assert.equal(left.candidates[0]?.importKey, second.importKey);
    assert.deepEqual(left.manifest.files, [
      { path: 'audit.json', sha256: sha256Text('{"ok":true}\n') },
      { path: 'candidates.csv', sha256: sha256Text(left.candidatesCsv) },
      { path: 'candidates.jsonl', sha256: sha256Text(left.candidatesJsonl) },
    ]);
    assert.equal(left.manifestJson.endsWith('\n'), true);
  });

  void it('uses RFC-safe CSV quoting for punctuation and quotes', () => {
    const candidate = toStagingCandidate(resolvedCandidate({ spotPositionRaw: 'лево, у "ящика"' }));
    const csv = serializeCandidatesCsv([candidate]);

    assert.ok(csv.includes('"лево, у ""ящика"""'));
    assert.equal(csv.endsWith('\r\n'), true);
  });

  void it('neutralizes spreadsheet formulas in CSV while keeping JSONL raw', () => {
    const candidate = toStagingCandidate(
      resolvedCandidate({ spotPositionRaw: '=WEBSERVICE("https://example.invalid")' }),
    );

    assert.ok(serializeCandidatesCsv([candidate]).includes("'=WEBSERVICE"));
    assert.ok(serializeCandidatesJsonl([candidate]).includes('=WEBSERVICE'));
    assert.equal(serializeCandidatesJsonl([candidate]).includes("'=WEBSERVICE"), false);
  });

  void it('writes nested files atomically and rejects parent traversal', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'fishing-forum-staging-'));

    try {
      await writeStagingFiles(directory, {
        'staging/candidates.jsonl': '{"ok":true}\n',
        'staging/manifest.json': '{"version":1}\n',
      });

      assert.equal(
        await readFile(join(directory, 'staging/candidates.jsonl'), 'utf8'),
        '{"ok":true}\n',
      );
      await assert.rejects(
        () => writeStagingFiles(directory, { '../escape.json': 'blocked' }),
        /Unsafe staging output path/u,
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
