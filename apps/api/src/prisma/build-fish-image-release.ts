import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { ForumFishIdentity } from './fish-catalog-audit.js';
import { sha256, stableJson } from './fish-catalog-audit.js';
import { buildFishImageRelease } from './fish-image-release.js';
import {
  validateFishImageMetadataManifest,
  type FishImageMetadataManifest,
} from './fish-image-metadata.js';
import {
  validateFishImageLocalMappingManifest,
  validateFishImageLocalMappingsAgainstMetadata,
} from './fish-image-local-mappings.js';

const REPOSITORY_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const CATALOG_DATA = new URL('../../prisma/catalog-data/', import.meta.url);
const SOURCE_DIRECTORY = fileURLToPath(
  new URL('../../.local/fish-images/source/', import.meta.url),
);
const RELEASES_DIRECTORY = fileURLToPath(
  new URL('../../.local/fish-images/releases/', import.meta.url),
);
const MANIFEST_PATHS = {
  images: 'apps/api/prisma/catalog-data/fish-image-metadata.json',
  localMappings: 'apps/api/prisma/catalog-data/fish-image-local-mappings-20260909.json',
  forum: 'apps/api/prisma/catalog-data/forum69-fish.json',
} as const;

interface ForumManifest {
  fish: ForumFishIdentity[];
}

async function readTrackedFile(repositoryPath: string, fileName: string): Promise<string> {
  execFileSync('git', ['ls-files', '--error-unmatch', '--', repositoryPath], {
    cwd: REPOSITORY_ROOT,
    stdio: 'pipe',
  });
  const content = await readFile(new URL(fileName, CATALOG_DATA), 'utf8');
  const indexed = execFileSync('git', ['show', `:${repositoryPath}`], {
    cwd: REPOSITORY_ROOT,
    encoding: 'utf8',
    maxBuffer: 50 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (content !== indexed) throw new Error(`${repositoryPath} differs from the Git index`);
  return content;
}

async function run(): Promise<void> {
  if (process.argv.length !== 2) throw new Error('usage: pnpm db:build:fish-image-release');
  const [imageContent, localMappingContent, forumContent] = await Promise.all([
    readTrackedFile(MANIFEST_PATHS.images, 'fish-image-metadata.json'),
    readTrackedFile(
      MANIFEST_PATHS.localMappings,
      'fish-image-local-mappings-20260909.json',
    ),
    readTrackedFile(MANIFEST_PATHS.forum, 'forum69-fish.json'),
  ]);
  const forum = JSON.parse(forumContent) as ForumManifest;
  const manifest = validateFishImageMetadataManifest(
    JSON.parse(imageContent) as unknown,
    forum.fish,
  );
  const localMappings = validateFishImageLocalMappingManifest(
    JSON.parse(localMappingContent) as unknown,
  );
  validateFishImageLocalMappingsAgainstMetadata(localMappings, manifest.entries);
  for (const mapping of localMappings.mappings) {
    const bytes = await readFile(
      new URL(`../../.local/fish-images/source/${mapping.fileName}`, import.meta.url),
    );
    if (sha256(bytes) !== mapping.sha256) {
      throw new Error(`approved local Fish image changed: ${mapping.fileName}`);
    }
  }
  const expectedKeys = [
    ...manifest.entries.flatMap((entry) =>
      entry.official === null ? [] : [entry.official.imageKey],
    ),
    ...localMappings.mappings.map((mapping) => mapping.imageKey),
  ];
  const sourceManifestSha256 = sha256(
    stableJson({
      fishImageManifestSha256: sha256(imageContent),
      fishImageLocalMappingsSha256: sha256(localMappingContent),
    }),
  );
  const result = await buildFishImageRelease({
    sourceDirectory: SOURCE_DIRECTORY,
    releasesDirectory: RELEASES_DIRECTORY,
    expectedKeys,
    sourceManifestSha256,
  });

  process.stdout.write(
    stableJson({
      ...result,
      releasePath: fileURLToPath(pathToFileURL(result.releasePath)),
      networkUsed: false,
      runtimeDeliveryEnabled: false,
      databaseWrites: false,
    }),
  );
}

const entryPoint = process.argv[1];
if (entryPoint !== undefined && import.meta.url === pathToFileURL(entryPoint).href) {
  run().catch((error: unknown) => {
    process.stderr.write(
      `Fish image release build failed: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  });
}

export type { FishImageMetadataManifest };
