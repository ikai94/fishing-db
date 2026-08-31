import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, it } from 'node:test';
import { chmodSync, lstatSync, readdirSync, rmSync } from 'node:fs';
import { buildFishImageRelease, inspectPng } from './fish-image-release.js';

const ONE_PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);
const temporaryDirectories: string[] = [];

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'fish-image-release-test-'));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    makeTreeWritable(directory);
    rmSync(directory, { recursive: true, force: true });
  }
});

function makeTreeWritable(path: string): void {
  let item;
  try {
    item = lstatSync(path);
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw error;
  }
  if (!item.isDirectory()) {
    chmodSync(path, 0o644);
    return;
  }
  chmodSync(path, 0o755);
  for (const name of readdirSync(path)) makeTreeWritable(join(path, name));
}

void describe('Fish image immutable release', () => {
  void it('validates PNG structure and CRC', () => {
    assert.deepEqual(inspectPng(ONE_PIXEL_PNG), { width: 1, height: 1 });
    const corrupted = Buffer.from(ONE_PIXEL_PNG);
    corrupted[corrupted.length - 1] = (corrupted[corrupted.length - 1] ?? 0) ^ 0xff;
    assert.throws(() => inspectPng(corrupted), /CRC is invalid/u);
    assert.throws(() => inspectPng(Buffer.from('not png')), /signature is invalid/u);
  });

  void it('publishes atomically, excludes extras, and reuses an identical release', async () => {
    const root = await temporaryDirectory();
    const source = join(root, 'source');
    const releases = join(root, 'releases');
    await mkdir(source);
    await writeFile(join(source, '101.png'), ONE_PIXEL_PNG);
    await writeFile(join(source, '999.png'), ONE_PIXEL_PNG);
    const sourceBefore = await readFile(join(source, '101.png'));
    const input = {
      sourceDirectory: source,
      releasesDirectory: releases,
      expectedKeys: [101],
      sourceManifestSha256: 'a'.repeat(64),
    };

    const first = await buildFishImageRelease(input);
    assert.equal(first.idempotency, 'CREATED');
    assert.equal(first.matched, 1);
    assert.deepEqual(first.excludedKeys, [999]);
    assert.equal(first.invalid, 0);
    assert.deepEqual(await readFile(join(source, '101.png')), sourceBefore);
    const index = JSON.parse(
      await readFile(join(first.releasePath, 'fish-image-assets.json'), 'utf8'),
    ) as { assets: Array<{ path: string }> };
    assert.match(index.assets[0]?.path ?? '', /^assets\/101-[a-f0-9]{64}\.png$/u);
    assert.equal(
      (await stat(join(first.releasePath, index.assets[0]?.path ?? ''))).mode & 0o777,
      0o444,
    );

    const second = await buildFishImageRelease(input);
    assert.equal(second.idempotency, 'REUSED_IDENTICAL');
    assert.equal(second.assetIndexSha256, first.assetIndexSha256);
    assert.equal(second.releasePath, first.releasePath);
    assert.equal(second.totalReleaseSizeBytes, first.totalReleaseSizeBytes);
  });

  void it('refuses a release when an expected image is invalid', async () => {
    const root = await temporaryDirectory();
    const source = join(root, 'source');
    const releases = join(root, 'releases');
    await mkdir(source);
    await writeFile(join(source, '101.png'), Buffer.from('not png'));

    await assert.rejects(
      () =>
        buildFishImageRelease({
          sourceDirectory: source,
          releasesDirectory: releases,
          expectedKeys: [101],
          sourceManifestSha256: 'b'.repeat(64),
        }),
      /missing or invalid expected keys: 101/u,
    );
  });
});
