import assert from 'node:assert/strict';
import { chmodSync, lstatSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { mkdir, mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NotFoundException } from '@nestjs/common';
import type { Response } from 'express';
import { afterEach, describe, it } from 'node:test';
import { buildFishImageRelease } from '../prisma/fish-image-release.js';
import { FishImagesController } from './fish-images.controller.js';
import { LocalFishImageDelivery } from './local-fish-image-delivery.service.js';

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

async function createRelease(): Promise<{
  storageRoot: string;
  sourceManifestSha256: string;
  assetIndexSha256: string;
  assetFileName: string;
  assetPath: string;
}> {
  const storageRoot = await mkdtemp(join(tmpdir(), 'local-fish-delivery-test-'));
  temporaryDirectories.push(storageRoot);
  const source = join(storageRoot, 'source');
  await mkdir(source);
  writeFileSync(join(source, '101.png'), ONE_PIXEL_PNG);
  writeFileSync(join(source, '999.png'), ONE_PIXEL_PNG);
  const sourceManifestSha256 = 'a'.repeat(64);
  const release = await buildFishImageRelease({
    sourceDirectory: source,
    releasesDirectory: join(storageRoot, 'releases'),
    expectedKeys: [101],
    sourceManifestSha256,
  });
  const index = JSON.parse(
    await readFile(join(release.releasePath, 'fish-image-assets.json'), 'utf8'),
  ) as { assets: Array<{ path: string }> };
  const assetPath = join(release.releasePath, index.assets[0]?.path ?? 'missing');

  return {
    storageRoot,
    sourceManifestSha256,
    assetIndexSha256: release.assetIndexSha256,
    assetFileName: index.assets[0]?.path.split('/').at(-1) ?? 'missing',
    assetPath,
  };
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    makeTreeWritable(directory);
    rmSync(directory, { recursive: true, force: true });
  }
});

void describe('LocalFishImageDelivery', () => {
  void it('validates a release and maps only indexed keys and exact filenames', async () => {
    const release = await createRelease();
    const delivery = await LocalFishImageDelivery.load({
      storageRoot: release.storageRoot,
      approvedAssetIndexSha256: release.assetIndexSha256,
      approvedSourceManifestSha256: release.sourceManifestSha256,
    });

    assert.equal(delivery.mappedImageCount, 1);
    assert.deepEqual(
      delivery.resolvePublicImage({ fishId: 'fish-101', officialFishImageKey: 101 }),
      { url: `/api/v1/fish-images/${release.assetFileName}` },
    );
    assert.equal(
      delivery.resolvePublicImage({ fishId: 'fish-extra', officialFishImageKey: 999 }),
      null,
    );
    assert.equal(
      delivery.resolvePublicImage({ fishId: 'fish-missing', officialFishImageKey: null }),
      null,
    );
    assert.deepEqual((await delivery.readPublicAsset(release.assetFileName))?.bytes, ONE_PIXEL_PNG);
    assert.equal(await delivery.readPublicAsset(`../${release.assetFileName}`), null);
    assert.equal(await delivery.readPublicAsset('101-invalid.png'), null);
  });

  void it('fails startup for a missing or corrupted approved release', async () => {
    const release = await createRelease();
    await assert.rejects(
      () =>
        LocalFishImageDelivery.load({
          storageRoot: release.storageRoot,
          approvedAssetIndexSha256: 'b'.repeat(64),
          approvedSourceManifestSha256: release.sourceManifestSha256,
        }),
      /ENOENT/u,
    );

    chmodSync(release.assetPath, 0o644);
    const corrupted = Buffer.from(ONE_PIXEL_PNG);
    corrupted[20] = (corrupted[20] ?? 0) ^ 0xff;
    writeFileSync(release.assetPath, corrupted);
    chmodSync(release.assetPath, 0o444);
    await assert.rejects(
      () =>
        LocalFishImageDelivery.load({
          storageRoot: release.storageRoot,
          approvedAssetIndexSha256: release.assetIndexSha256,
          approvedSourceManifestSha256: release.sourceManifestSha256,
        }),
      /CRC is invalid|missing or corrupt/u,
    );
  });

  void it('serves exact files with immutable headers, ETag, 304, and 404', async () => {
    const release = await createRelease();
    const delivery = await LocalFishImageDelivery.load({
      storageRoot: release.storageRoot,
      approvedAssetIndexSha256: release.assetIndexSha256,
      approvedSourceManifestSha256: release.sourceManifestSha256,
    });
    const controller = new FishImagesController(delivery);
    const headers = new Map<string, string>();
    let statusCode = 200;
    const response = {
      setHeader: (name: string, value: string) => headers.set(name, value),
      status: (value: number) => {
        statusCode = value;
        return response;
      },
    } as unknown as Response;

    const file = await controller.getFishImage(release.assetFileName, undefined, response);
    assert.ok(file);
    assert.equal(headers.get('Cache-Control'), 'public, max-age=31536000, immutable');
    assert.equal(headers.get('Content-Type'), 'image/png');
    assert.equal(headers.get('Content-Length'), String(ONE_PIXEL_PNG.length));
    assert.match(headers.get('ETag') ?? '', /^"[a-f0-9]{64}"$/u);
    assert.equal(headers.get('X-Content-Type-Options'), 'nosniff');

    const notModified = await controller.getFishImage(
      release.assetFileName,
      headers.get('ETag'),
      response,
    );
    assert.equal(notModified, undefined);
    assert.equal(statusCode, 304);
    await assert.rejects(
      () => controller.getFishImage('101-'.padEnd(69, '0') + '.png', undefined, response),
      NotFoundException,
    );
  });
});
