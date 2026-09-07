import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import {
  KLEVALKA_FISH_INDEX_URL,
  crawlKlevalkaFishSnapshots,
  discoverKlevalkaFish,
  fishSnapshotRelativePath,
  parseExternalCookieFile,
  validateKlevalkaFishSnapshot,
} from './klevalka-fish-snapshot-crawler.js';
import { parseKlevalkaCrawlCommand } from './crawl-klevalka-fish-snapshots.js';

function authenticatedNavigation(): string {
  return '<a href="/profile">личный кабинет</a><a href="/login/off">выход</a>';
}

function fishIndexHtml(): string {
  return `<!doctype html><html><body>
    ${authenticatedNavigation()}
    <div id="fish_tabs"><ol>
      <li><a href="/fish/detail/2">Азиатская зубатка</a></li>
      <li><a href="/fish/detail/1">Адский вампир</a></li>
      <li><a href="/fish/detail/2">Азиатская зубатка</a></li>
      <li><a href="/fish/detail/2">Зубатка азиатская редкая</a></li>
    </ol></div>
  </body></html>`;
}

function fishPageHtml(input: {
  sourceId: number;
  name: string;
  mode?: 'all' | 'good' | 'best';
  int?: number;
}): string {
  const mode = input.mode ?? 'all';
  return `<!doctype html><html><body>
    ${authenticatedNavigation()}
    <div class="header"><h2>рыба: ${input.name}</h2></div>
    <input type="radio" name="count_show" value="all"${mode === 'all' ? ' checked="checked"' : ''}>
    <input type="radio" name="count_show" value="good"${mode === 'good' ? ' checked="checked"' : ''}>
    <input type="radio" name="count_show" value="best"${mode === 'best' ? ' checked="checked"' : ''}>
    <table id="founds_items"><tr>
      <th>#</th><th>вес (гр)</th><th>база, локация</th><th>наживка / блесна</th><th>добавил(а)</th><th></th><th>инт</th><th></th>
    </tr><tr class="baza_2 tr_item item_1">
      <td>1</td><td>100</td>
      <td><a href="/location/baza/2">Амур</a>, <a href="/location/detail/30">Протока</a></td>
      <td><a href="/nazhivka/detail/2">Живец</a></td><td>author</td><td></td>
      <td class="item_total">${input.int ?? 1}</td><td></td>
    </tr></table>
    <script>function ChangeBest(stype) { window.location.href = '/fish/detail/${input.sourceId}/' + stype; }</script>
  </body></html>`;
}

function emptyFishPageHtml(sourceId: number, name: string): string {
  return `<!doctype html><html><body>
    ${authenticatedNavigation()}
    <div class="header"><h2>рыба: ${name}</h2></div>
    <input type="radio" name="count_show" value="all" checked="checked">
    <input type="radio" name="count_show" value="good">
    <input type="radio" name="count_show" value="best">
    Прискорбно, но поправимо... по данному запросу ничего не найдено.
    <script>function ChangeBest(stype) { window.location.href = '/fish/detail/${sourceId}/' + stype; }</script>
  </body></html>`;
}

void describe('authenticated Klevalka Fish snapshot crawler', () => {
  void it('discovers unique Fish IDs and deterministic ALL snapshot paths', () => {
    const fish = discoverKlevalkaFish(fishIndexHtml());
    assert.deepEqual(fish, [
      {
        sourceId: 1,
        discoveredNames: ['Адский вампир'],
        allUrl: 'https://klevalka.org/fish/detail/1/all',
        relativePath: 'fish/00000001.html',
      },
      {
        sourceId: 2,
        discoveredNames: ['Азиатская зубатка', 'Зубатка азиатская редкая'],
        allUrl: 'https://klevalka.org/fish/detail/2/all',
        relativePath: 'fish/00000002.html',
      },
    ]);
    assert.equal(fishSnapshotRelativePath(175), 'fish/00000175.html');
  });

  void it('refuses unauthenticated indexes and filtered or mismatched Fish pages', () => {
    assert.throws(
      () =>
        discoverKlevalkaFish(
          fishIndexHtml().replace(authenticatedNavigation(), '<a href="/login">вход</a>'),
        ),
      /unauthenticated/u,
    );
    const expected = {
      sourceId: 1,
      discoveredNames: ['Адский вампир'],
      relativePath: fishSnapshotRelativePath(1),
    };
    assert.throws(
      () =>
        validateKlevalkaFishSnapshot(
          fishPageHtml({ sourceId: 1, name: 'Адский вампир', mode: 'best' }),
          expected,
        ),
      /BEST mode/u,
    );
    assert.throws(
      () =>
        validateKlevalkaFishSnapshot(
          fishPageHtml({ sourceId: 2, name: 'Адский вампир' }),
          expected,
        ),
      /does not prove its source ID/u,
    );
  });

  void it('validates authenticated ALL pages and preserves low INT', () => {
    const expected = {
      sourceId: 175,
      discoveredNames: ['Сима'],
      relativePath: fishSnapshotRelativePath(175),
    };
    assert.deepEqual(
      validateKlevalkaFishSnapshot(fishPageHtml({ sourceId: 175, name: 'Сима', int: 1 }), expected),
      {
        sourceId: 175,
        name: 'Сима',
        status: 'ROWS',
        discoveryNameMatch: true,
        rowCount: 1,
        minimumInt: 1,
        maximumInt: 1,
      },
    );
  });

  void it('accepts only the explicit authenticated ALL empty-page state without a table', () => {
    const expected = {
      sourceId: 138,
      discoveredNames: ['Пиратский клад'],
      relativePath: fishSnapshotRelativePath(138),
    };
    assert.deepEqual(
      validateKlevalkaFishSnapshot(emptyFishPageHtml(138, 'Пиратский клад'), expected),
      {
        sourceId: 138,
        name: 'Пиратский клад',
        status: 'EMPTY_CONFIRMED',
        discoveryNameMatch: true,
        rowCount: 0,
        minimumInt: null,
        maximumInt: null,
      },
    );
    assert.throws(
      () =>
        validateKlevalkaFishSnapshot(
          emptyFishPageHtml(138, 'Пиратский клад').replace(
            'Прискорбно, но поправимо... по данному запросу ничего не найдено.',
            '',
          ),
          expected,
        ),
      /SOURCE_TABLE_MISSING/u,
    );
  });

  void it('records an index/detail name mismatch when the page proves the same numeric ID', () => {
    const expected = {
      sourceId: 404,
      discoveredNames: ['Муреная ячеистая'],
      relativePath: fishSnapshotRelativePath(404),
    };
    const snapshot = validateKlevalkaFishSnapshot(
      fishPageHtml({ sourceId: 404, name: 'Мурена ячеистая' }),
      expected,
    );
    assert.equal(snapshot.name, 'Мурена ячеистая');
    assert.equal(snapshot.discoveryNameMatch, false);
  });

  void it('reads raw and Netscape cookie files without retaining their contents', () => {
    assert.equal(
      parseExternalCookieFile('session=secret; preference=all\n'),
      'session=secret; preference=all',
    );
    assert.equal(
      parseExternalCookieFile(
        '# Netscape HTTP Cookie File\n#HttpOnly_.klevalka.org\tTRUE\t/\tTRUE\t0\tsession\tsecret\n.example.org\tTRUE\t/\tTRUE\t0\tignored\tvalue\n',
      ),
      'session=secret',
    );
  });

  void it('writes checksummed snapshots once and reuses them on resume', async () => {
    const workspaceRoot = await mkdtemp('/tmp/klevalka-crawler-test-');
    const pages = new Map([
      [KLEVALKA_FISH_INDEX_URL, fishIndexHtml()],
      [
        'https://klevalka.org/fish/detail/1/all',
        fishPageHtml({ sourceId: 1, name: 'Адский вампир' }),
      ],
      [
        'https://klevalka.org/fish/detail/2/all',
        fishPageHtml({ sourceId: 2, name: 'Азиатская зубатка', int: 2 }),
      ],
    ]);
    let requests = 0;
    const fetchImplementation: typeof fetch = (input) => {
      requests += 1;
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const body = pages.get(url);
      return Promise.resolve(
        new Response(body ?? 'missing', {
          status: body === undefined ? 404 : 200,
          headers: { 'content-type': 'text/html; charset=utf-8' },
        }),
      );
    };
    try {
      const first = await crawlKlevalkaFishSnapshots({
        workspaceRoot,
        cookieHeader: 'session=secret',
        maximumFish: 2,
        requestDelayMs: 1_000,
        fetchImplementation,
        sleep: () => Promise.resolve(),
      });
      assert.equal(first.fetched, 2);
      assert.equal(first.reused, 0);
      assert.equal(first.manifest.savedFishCount, 2);
      assert.equal(first.manifest.complete, true);
      assert.equal(requests, 3);
      const firstManifest = await readFile(join(workspaceRoot, 'manifest.json'), 'utf8');
      assert.doesNotMatch(firstManifest, /secret/u);

      const second = await crawlKlevalkaFishSnapshots({
        workspaceRoot,
        cookieHeader: 'session=secret',
        maximumFish: 2,
        requestDelayMs: 1_000,
        fetchImplementation,
        sleep: () => Promise.resolve(),
      });
      assert.equal(second.fetched, 0);
      assert.equal(second.reused, 2);
      assert.equal(requests, 4);
      assert.equal(await readFile(join(workspaceRoot, 'manifest.json'), 'utf8'), firstManifest);
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });

  void it('records an invalid discovered Fish without saving it and continues', async () => {
    const workspaceRoot = await mkdtemp('/tmp/klevalka-crawler-invalid-test-');
    const pages = new Map([
      [KLEVALKA_FISH_INDEX_URL, fishIndexHtml()],
      [
        'https://klevalka.org/fish/detail/1/all',
        fishPageHtml({ sourceId: 1, name: 'Адский вампир' }),
      ],
      ['https://klevalka.org/fish/detail/2/all', fishPageHtml({ sourceId: 2, name: '' })],
    ]);
    const fetchImplementation: typeof fetch = (input) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const body = pages.get(url);
      return Promise.resolve(
        new Response(body ?? 'missing', { status: body === undefined ? 404 : 200 }),
      );
    };
    try {
      const result = await crawlKlevalkaFishSnapshots({
        workspaceRoot,
        cookieHeader: 'session=secret',
        maximumFish: 2,
        requestDelayMs: 1_000,
        fetchImplementation,
        sleep: () => Promise.resolve(),
      });
      assert.equal(result.manifest.savedFishCount, 1);
      assert.equal(result.manifest.failedFishCount, 1);
      assert.equal(result.manifest.attemptedFishCount, 2);
      assert.equal(result.manifest.complete, true);
      assert.deepEqual(result.manifest.failures[0]?.discoveredNames, [
        'Азиатская зубатка',
        'Зубатка азиатская редкая',
      ]);
      assert.equal(result.manifest.failures[0]?.sourceId, 2);
      assert.equal(result.manifest.failures[0]?.code, 'VALIDATION_FAILED');
      assert.match(result.manifest.failures[0]?.message ?? '', /Klevalka Fish 2 page/u);
      await assert.rejects(readFile(join(workspaceRoot, fishSnapshotRelativePath(2))), /ENOENT/u);
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });

  void it('requires external paths, external authentication and conservative rates in the CLI', () => {
    assert.throws(() => parseKlevalkaCrawlCommand([]), /usage/u);
    assert.throws(
      () => parseKlevalkaCrawlCommand(['--workspace', '/tmp/crawl', '--delay-ms', '999']),
      /at least 1000/u,
    );
    assert.deepEqual(
      parseKlevalkaCrawlCommand([
        '--workspace',
        '/tmp/crawl',
        '--cookie-file',
        '/tmp/cookies.txt',
        '--max-fish',
        '5',
      ]),
      {
        workspacePath: '/tmp/crawl',
        cookieFilePath: '/tmp/cookies.txt',
        maximumFish: 5,
        requestDelayMs: 2_000,
      },
    );
  });
});
