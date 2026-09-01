import assert from 'node:assert/strict';
import { chmodSync, lstatSync, readdirSync, rmSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NotFoundException } from '@nestjs/common';
import type { Response } from 'express';
import { afterEach, describe, it } from 'node:test';
import type { BaitImageMappingManifest } from '../prisma/bait-image-mapping.js';
import { buildBaitImageRelease } from '../prisma/bait-image-release.js';
import { BaitImagesController } from './bait-images.controller.js';
import { LocalBaitImageDelivery } from './local-bait-image-delivery.service.js';

const ONE_PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);
const temporaryDirectories: string[] = [];

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

async function createRelease() {
  const storageRoot = await mkdtemp(join(tmpdir(), 'local-bait-delivery-test-'));
  temporaryDirectories.push(storageRoot);
  const source = join(storageRoot, 'source');
  await mkdir(source);
  await writeFile(join(source, 'zhivec.png'), ONE_PIXEL_PNG);
  await writeFile(join(source, 'none.png'), ONE_PIXEL_PNG);
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
  const sourceManifestSha256 = 'a'.repeat(64);
  const release = await buildBaitImageRelease({
    sourceDirectory: source,
    releasesDirectory: join(storageRoot, 'releases'),
    manifest,
    sourceManifestSha256,
  });
  const index = JSON.parse(
    await readFile(join(release.releasePath, 'bait-image-assets.json'), 'utf8'),
  ) as { assets: Array<{ path: string }> };
  return {
    storageRoot,
    sourceManifestSha256,
    assetIndexSha256: release.assetIndexSha256,
    assetFileName: index.assets[0]?.path.split('/').at(-1) ?? 'missing',
  };
}

void describe('LocalBaitImageDelivery', () => {
  void it('maps exact normalized identities and serves only indexed immutable assets', async () => {
    const release = await createRelease();
    const delivery = await LocalBaitImageDelivery.load({
      storageRoot: release.storageRoot,
      approvedAssetIndexSha256: release.assetIndexSha256,
      approvedSourceManifestSha256: release.sourceManifestSha256,
    });

    assert.equal(delivery.mappedImageCount, 2);
    const expected = { url: `/api/v1/bait-images/${release.assetFileName}` };
    assert.deepEqual(
      delivery.resolvePublicImage({ baitId: 'one', nameNormalized: 'живец' }),
      expected,
    );
    assert.deepEqual(
      delivery.resolvePublicImage({ baitId: 'two', nameNormalized: 'живец (перехват)' }),
      expected,
    );
    assert.equal(delivery.resolvePublicImage({ baitId: 'three', nameNormalized: 'Живец' }), null);
    assert.deepEqual((await delivery.readPublicAsset(release.assetFileName))?.bytes, ONE_PIXEL_PNG);
    assert.equal(await delivery.readPublicAsset(`../${release.assetFileName}`), null);
  });

  void it('serves immutable cache headers, ETag, 304, and 404', async () => {
    const release = await createRelease();
    const delivery = await LocalBaitImageDelivery.load({
      storageRoot: release.storageRoot,
      approvedAssetIndexSha256: release.assetIndexSha256,
      approvedSourceManifestSha256: release.sourceManifestSha256,
    });
    const controller = new BaitImagesController(delivery);
    const headers = new Map<string, string>();
    let statusCode = 200;
    const response = {
      setHeader: (name: string, value: string) => headers.set(name, value),
      status: (value: number) => {
        statusCode = value;
        return response;
      },
    } as unknown as Response;

    assert.ok(await controller.getBaitImage(release.assetFileName, undefined, response));
    assert.equal(headers.get('Cache-Control'), 'public, max-age=31536000, immutable');
    assert.equal(headers.get('Content-Type'), 'image/png');
    assert.match(headers.get('ETag') ?? '', /^"[a-f0-9]{64}"$/u);
    assert.equal(
      await controller.getBaitImage(release.assetFileName, headers.get('ETag'), response),
      undefined,
    );
    assert.equal(statusCode, 304);
    await assert.rejects(
      () => controller.getBaitImage(`${'b'.repeat(64)}.png`, undefined, response),
      NotFoundException,
    );
  });
});
