import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { validateBaitImageMappingManifest } from './bait-image-mapping.js';
import { buildBaitImageRelease } from './bait-image-release.js';
import { stableJson } from './fish-catalog-audit.js';

const CATALOG_DATA = new URL('../../prisma/catalog-data/', import.meta.url);
const SOURCE_DIRECTORY = fileURLToPath(new URL('../../.local/baits/', import.meta.url));
const RELEASES_DIRECTORY = fileURLToPath(
  new URL('../../.local/bait-images/releases/', import.meta.url),
);

interface BaitCatalogFile {
  schemaVersion: number;
  baits: Array<{ name: string; type: 'BAIT' | 'LURE' }>;
}

async function run(): Promise<void> {
  if (process.argv.length !== 2) throw new Error('usage: pnpm db:build:bait-image-release');
  const [mappingContent, catalogContent] = await Promise.all([
    readFile(new URL('bait-image-mapping.json', CATALOG_DATA), 'utf8'),
    readFile(new URL('baits.json', CATALOG_DATA), 'utf8'),
  ]);
  const catalog = JSON.parse(catalogContent) as BaitCatalogFile;
  if (catalog.schemaVersion !== 1 || !Array.isArray(catalog.baits)) {
    throw new Error('canonical Bait catalog shape is invalid');
  }
  const manifest = validateBaitImageMappingManifest(
    JSON.parse(mappingContent) as unknown,
    catalog.baits,
  );
  const sourceManifestSha256 = createHash('sha256').update(mappingContent).digest('hex');
  const result = await buildBaitImageRelease({
    sourceDirectory: SOURCE_DIRECTORY,
    releasesDirectory: RELEASES_DIRECTORY,
    manifest,
    sourceManifestSha256,
  });
  process.stdout.write(
    stableJson({
      ...result,
      releasePath: fileURLToPath(pathToFileURL(result.releasePath)),
      sourceManifestSha256,
      networkUsed: false,
      databaseWrites: false,
    }),
  );
}

const entryPoint = process.argv[1];
if (entryPoint !== undefined && import.meta.url === pathToFileURL(entryPoint).href) {
  run().catch((error: unknown) => {
    process.stderr.write(
      `Bait image release build failed: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  });
}
