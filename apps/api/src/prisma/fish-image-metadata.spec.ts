import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import type { ForumFishIdentity } from './fish-catalog-audit.js';
import {
  buildFishImageManualReviewAudit,
  buildFishImageMetadataManifest,
  parseOfficialFishDetailHtml,
  parseOfficialFishListHtml,
  validateFishImageMetadataManifest,
  type FishImageMappingRules,
  type OfficialFishEvidence,
} from './fish-image-metadata.js';

function forumFish(
  topicId: string,
  canonicalName: string,
  aliases: string[] = [],
): ForumFishIdentity {
  return {
    sourceIdentity: `rus-fishsoft:forum69:topic:${topicId}`,
    topicId,
    subforumId: '70',
    sourceTitle: canonicalName,
    canonicalName,
    canonicalNameNormalized: canonicalName
      .normalize('NFKC')
      .trim()
      .replace(/\s+/gu, ' ')
      .toLowerCase(),
    aliases: aliases.map((name) => ({
      kind: 'PARENTHETICAL_ALTERNATE',
      name,
      nameNormalized: name.normalize('NFKC').trim().replace(/\s+/gu, ' ').toLowerCase(),
    })),
    mixedScriptTokens: [],
  };
}

function official(title: string, imageKey: number): OfficialFishEvidence {
  return {
    listTitle: title,
    detailTitle: title,
    detailPath: `/fish-${String(imageKey)}.html`,
    imageKey,
    middleImagePath: `/assets/images/fish/middle/${String(imageKey)}.png`,
    bigImagePath: `/assets/images/fish/big/${String(imageKey)}.png`,
  };
}

const smallForum = [
  forumFish('1', 'Точная рыба'),
  forumFish('2', 'Каноническая рыба', ['Альтернативная рыба']),
  forumFish('3', 'Явно сопоставленная рыба'),
  forumFish('4', 'Ёрш'),
  forumFish('5', 'Отсутствующая рыба'),
];
const smallOfficial = [
  official('Точная рыба', 1),
  official('Альтернативная рыба', 2),
  official('Официальное название', 3),
  official('Ерш', 4),
];
const smallRules: FishImageMappingRules = {
  explicitMappings: {
    '3': {
      officialTitle: 'Официальное название',
      detailPath: '/fish-3.html',
      imageKey: 3,
      rationale: 'Test topic-specific mapping',
    },
  },
  manualCandidateTitles: { '4': ['Ерш'] },
  noImageMappingCandidateTitles: {},
  missingTopicIds: new Set(['5']),
  expectedCounts: { EXACT: 1, MAPPED: 2, MANUAL: 1, MISSING: 1 },
};

void describe('Fish image metadata audit', () => {
  void it('parses and validates official list/detail title and numeric image-key evidence', () => {
    const [entry] = parseOfficialFishListHtml(`
      <ul><li class="fishItem imageSmall"><a class="ajax_link" href="fish.html">
        <img src="assets/images/fish/middle/2186.png"><p class="title">Рыба</p>
      </a></li></ul>
    `);
    assert.deepEqual(entry, {
      listTitle: 'Рыба',
      detailPath: '/fish.html',
      middleImagePath: '/assets/images/fish/middle/2186.png',
      imageKey: 2186,
    });
    assert.deepEqual(
      parseOfficialFishDetailHtml(
        entry,
        '<title>Русская Рыбалка 3: Рыба</title><img id="preview_full_image" src="assets/images/fish/big/2186.png">',
      ),
      {
        ...entry,
        detailTitle: 'Рыба',
        bigImagePath: '/assets/images/fish/big/2186.png',
      },
    );
  });

  void it('rejects list/detail title and middle/big image-key disagreements', () => {
    const entry = official('Рыба', 1);
    assert.throws(
      () =>
        parseOfficialFishDetailHtml(
          entry,
          '<title>Русская Рыбалка 3: Другая</title><img id="preview_full_image" src="assets/images/fish/big/2.png">',
        ),
      /list\/detail title mismatch.*middle\/big image key mismatch/su,
    );
  });

  void it('rejects off-origin detail paths and nonnumeric image keys', () => {
    assert.throws(
      () =>
        parseOfficialFishListHtml(`
          <li class="fishItem"><a class="ajax_link" href="https://example.com/fish.html">
            <img src="assets/images/fish/middle/1.png"><p class="title">Рыба</p>
          </a></li>
        `),
      /path must stay on https:\/\/rus-fishsoft\.ru/u,
    );
    assert.throws(
      () =>
        parseOfficialFishListHtml(`
          <li class="fishItem"><a class="ajax_link" href="fish.html">
            <img src="assets/images/fish/middle/not-a-number.png"><p class="title">Рыба</p>
          </a></li>
        `),
      /invalid middle image path/u,
    );
  });

  void it('classifies only exact canonical names, reviewed aliases, and topic-specific mappings', () => {
    const manifest = buildFishImageMetadataManifest(
      smallForum,
      smallOfficial,
      '2026-08-28T00:00:00.000Z',
      smallRules,
    );
    assert.deepEqual(manifest.counts, { EXACT: 1, MAPPED: 2, MANUAL: 1, MISSING: 1 });
    assert.deepEqual(
      manifest.entries.map((entry) => [entry.forumTopicId, entry.status, entry.matchRule]),
      [
        ['1', 'EXACT', 'CANONICAL_EXACT'],
        ['2', 'MAPPED', 'FORUM_ALIAS_EXACT'],
        ['3', 'MAPPED', 'EXPLICIT_TOPIC_MAPPING'],
        ['4', 'MANUAL', 'MANUAL_REVIEW_REQUIRED'],
        ['5', 'MISSING', 'NO_OFFICIAL_CANDIDATE'],
      ],
    );
    assert.equal(manifest.entries[3]?.canonicalName, 'Ёрш');
    assert.equal(manifest.entries[3]?.candidates[0]?.listTitle, 'Ерш');
  });

  void it('is deterministic regardless of forum and official input order', () => {
    const forward = buildFishImageMetadataManifest(
      smallForum,
      smallOfficial,
      '2026-08-28T00:00:00.000Z',
      smallRules,
    );
    const reverse = buildFishImageMetadataManifest(
      [...smallForum].reverse(),
      [...smallOfficial].reverse(),
      '2026-08-28T00:00:00.000Z',
      smallRules,
    );
    assert.deepEqual(reverse, forward);
  });

  void it('rejects duplicate official titles, paths, and numeric keys', () => {
    for (const duplicate of [
      { ...official('Точная рыба', 10) },
      { ...official('Другая', 10), detailPath: '/fish-1.html' },
      { ...official('Другая', 1) },
    ]) {
      assert.throws(
        () =>
          buildFishImageMetadataManifest(
            smallForum,
            [...smallOfficial, duplicate],
            '2026-08-28T00:00:00.000Z',
            smallRules,
          ),
        /duplicate official/u,
      );
    }
  });

  void it('never promotes an е/ё or punctuation-only difference without an explicit rule', () => {
    const noExpansionRules: FishImageMappingRules = {
      explicitMappings: {},
      manualCandidateTitles: {},
      noImageMappingCandidateTitles: {},
      missingTopicIds: new Set(),
      expectedCounts: { EXACT: 0, MAPPED: 0, MANUAL: 0, MISSING: 0 },
    };
    assert.throws(
      () =>
        buildFishImageMetadataManifest(
          [forumFish('1', 'Ёрш-носарь')],
          [official('Ерш носарь', 1)],
          '2026-08-28T00:00:00.000Z',
          noExpansionRules,
        ),
      /has no exact, reviewed alias, explicit, manual, or missing decision/u,
    );
  });

  void it('validates the complete tracked manifest and derives only unresolved rows offline', () => {
    const catalogData = new URL('../../prisma/catalog-data/', import.meta.url);
    const forum = JSON.parse(readFileSync(new URL('forum69-fish.json', catalogData), 'utf8')) as {
      fish: ForumFishIdentity[];
    };
    const rawManifest = JSON.parse(
      readFileSync(new URL('fish-image-metadata.json', catalogData), 'utf8'),
    ) as unknown;
    const manifest = validateFishImageMetadataManifest(rawManifest, forum.fish);
    assert.deepEqual(manifest.counts, { EXACT: 1285, MAPPED: 178, MANUAL: 0, MISSING: 16 });
    assert.equal(manifest.entries.length, 1479);
    assert.equal(manifest.source.officialEntries, 1464);
    assert.equal(Object.keys(manifest.explicitMappings).length, 42);
    assert.equal(
      manifest.entries.filter((entry) => entry.matchRule === 'EXPLICIT_TOPIC_MAPPING').length,
      42,
    );
    const carp = manifest.entries.find((entry) => entry.forumTopicId === '304');
    assert.deepEqual(
      carp === undefined
        ? undefined
        : {
            canonicalName: carp.canonicalName,
            status: carp.status,
            matchRule: carp.matchRule,
            matchedName: carp.matchedName,
            official: carp.official,
            candidateTitles: carp.candidates.map((candidate) => candidate.listTitle),
          },
      {
        canonicalName: 'Карп',
        status: 'MISSING',
        matchRule: 'NO_IMAGE_MAPPING',
        matchedName: null,
        official: null,
        candidateTitles: ['Карп чешуйчатый'],
      },
    );
    const antimora = manifest.entries.find((entry) => entry.forumTopicId === '32147');
    assert.deepEqual(
      antimora === undefined
        ? undefined
        : {
            canonicalName: antimora.canonicalName,
            status: antimora.status,
            matchRule: antimora.matchRule,
            officialTitle: antimora.official?.listTitle,
            detailPath: antimora.official?.detailPath,
            imageKey: antimora.official?.imageKey,
          },
      {
        canonicalName: 'Антимора клювокрылая',
        status: 'MAPPED',
        matchRule: 'EXPLICIT_TOPIC_MAPPING',
        officialTitle: 'Антимора  клюворылая',
        detailPath: '/antimora-klyuvoryilaya.html',
        imageKey: 2271,
      },
    );
    const manual = buildFishImageManualReviewAudit(manifest);
    assert.deepEqual(manual.entries, []);
  });
});
