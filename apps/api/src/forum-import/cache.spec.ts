import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, it } from 'node:test';
import { ForumLocalStore, readJsonFile, sha256Hex, writeJsonAtomic } from './cache.js';

void describe('ForumLocalStore', () => {
  void it('shares validated HTTP entries independently of scan scope', async () => {
    const root = await mkdtemp(join(tmpdir(), 'forum-cache-'));
    const store = new ForumLocalStore(root);
    const url = 'https://rus-fishsoft.ru/forum/index.php?/topic/123-example/';
    await store.writeHttp({
      metadata: {
        schemaVersion: 1,
        url,
        finalUrl: url,
        contentType: 'text/html; charset=utf-8',
        etag: '"one"',
        lastModified: null,
        bodySha256: '',
      },
      body: '<html>one</html>',
    });

    assert.equal((await store.readHttp(url))?.body, '<html>one</html>');
    assert.notEqual(store.checkpointPath('topic-123'), store.checkpointPath('subforum-70'));
  });

  void it('rejects a body whose digest no longer matches metadata', async () => {
    const root = await mkdtemp(join(tmpdir(), 'forum-cache-'));
    const store = new ForumLocalStore(root);
    const url = 'https://rus-fishsoft.ru/forum/index.php?/topic/123-example/';
    await store.writeHttp({
      metadata: {
        schemaVersion: 1,
        url,
        finalUrl: url,
        contentType: 'text/html',
        etag: null,
        lastModified: null,
        bodySha256: '',
      },
      body: '<html>one</html>',
    });
    const key = sha256Hex(url);
    await writeJsonAtomic(join(root, 'http-cache', `${key}.json`), {
      schemaVersion: 1,
      url,
      finalUrl: url,
      contentType: 'text/html',
      etag: null,
      lastModified: null,
      bodySha256: sha256Hex('different'),
    });

    assert.equal(await store.readHttp(url), null);
    assert.match(await readFile(join(root, 'http-cache', `${key}.html`), 'utf8'), /one/u);
  });

  void it('writes and reads deterministic JSON with a final newline', async () => {
    const root = await mkdtemp(join(tmpdir(), 'forum-cache-'));
    const path = join(root, 'value.json');
    await writeJsonAtomic(path, { value: 1 });
    assert.deepEqual(await readJsonFile(path), { value: 1 });
    assert.equal((await readFile(path, 'utf8')).endsWith('\n'), true);
  });
});
