import assert from 'node:assert/strict';
import { chmodSync, lstatSync, readdirSync, rmSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, it } from 'node:test';
import type { BaitImageMappingManifest } from './bait-image-mapping.js';
import { buildBaitImageRelease } from './bait-image-release.js';

const ONE_PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);
const temporaryDirectories: string[] = [];

const manifest: BaitImageMappingManifest = {
  schemaVersion: 1,
  mode: 'EXPLICIT_BAIT_IMAGE_MAPPING',
  counts: { baits: 2, sourceFiles: 1, unusedSourceFiles: 1 },
  entries: [
    { baitName: 'Живец', baitType: 'BAIT', sourceFile: 'zhivec.png' },
    { baitName: 'Живец (перехват)', baitType: 'BAIT', sourceFile: 'zhivec.png' },
  ],
  unusedSourceFiles: ['none.png'],
};

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

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    makeTreeWritable(directory);
    rmSync(directory, { recursive: true, force: true });
  }
});

async function fixture(): Promise<{ root: string; source: string; releases: string }> {
  const root = await mkdtemp(join(tmpdir(), 'bait-image-release-test-'));
  temporaryDirectories.push(root);
  const source = join(root, 'source');
  const releases = join(root, 'releases');
  await mkdir(source);
  await writeFile(join(source, 'zhivec.png'), ONE_PIXEL_PNG);
  await writeFile(join(source, 'none.png'), ONE_PIXEL_PNG);
  return { root, source, releases };
}

void describe('buildBaitImageRelease', () => {
  void it('builds and reuses a deterministic immutable release with shared mappings', async () => {
    const paths = await fixture();
    const input = {
      sourceDirectory: paths.source,
      releasesDirectory: paths.releases,
      manifest,
      sourceManifestSha256: 'a'.repeat(64),
    };
    const first = await buildBaitImageRelease(input);
    const second = await buildBaitImageRelease(input);
    const index = JSON.parse(
      await readFile(join(first.releasePath, 'bait-image-assets.json'), 'utf8'),
    ) as { counts: unknown; mappings: unknown[]; assets: Array<{ path: string }> };

    assert.equal(first.idempotency, 'CREATED');
    assert.equal(second.idempotency, 'REUSED_IDENTICAL');
    assert.equal(second.assetIndexSha256, first.assetIndexSha256);
    assert.deepEqual(first.unusedSourceFiles, ['none.png']);
    assert.equal(first.mappedBaits, 2);
    assert.equal(first.assets, 1);
    assert.deepEqual(index.counts, { mappedBaits: 2, assets: 1 });
    assert.equal(index.mappings.length, 2);
    assert.equal(index.assets.length, 1);
    assert.deepEqual(
      await readFile(join(first.releasePath, index.assets[0]?.path ?? 'missing')),
      ONE_PIXEL_PNG,
    );
    assert.equal(lstatSync(first.releasePath).mode & 0o222, 0);
  });

  void it('refuses an unaccounted source file', async () => {
    const paths = await fixture();
    await writeFile(join(paths.source, 'extra.png'), ONE_PIXEL_PNG);

    await assert.rejects(
      () =>
        buildBaitImageRelease({
          sourceDirectory: paths.source,
          releasesDirectory: paths.releases,
          manifest,
          sourceManifestSha256: 'a'.repeat(64),
        }),
      /unexpected=extra\.png/u,
    );
  });
});
