import 'dotenv/config';
import { pathToFileURL } from 'node:url';
import { PrismaClient } from '../generated/prisma/client.js';
import { REAL_CATALOG_DATA, assertAuthoritativeCatalogCounts } from './catalog-seed-data.js';
import { seedCatalog, validateCatalogSeedData } from './catalog-seed.js';
import { createPrismaAdapter } from './prisma-adapter.js';

export async function runCatalogSeed(environment: NodeJS.ProcessEnv = process.env): Promise<void> {
  // Validate the complete static dataset before even constructing a database client.
  assertAuthoritativeCatalogCounts(REAL_CATALOG_DATA);
  validateCatalogSeedData(REAL_CATALOG_DATA);

  const databaseUrl = environment.DATABASE_URL;

  if (databaseUrl === undefined || databaseUrl.trim() === '') {
    throw new Error('DATABASE_URL is required');
  }

  const prisma = new PrismaClient({ adapter: createPrismaAdapter(databaseUrl) });

  try {
    const summary = await seedCatalog(prisma, REAL_CATALOG_DATA);
    console.info(`Catalog seed completed: ${JSON.stringify(summary)}`);
  } finally {
    await prisma.$disconnect();
  }
}

const entryPoint = process.argv[1];

if (entryPoint !== undefined && import.meta.url === pathToFileURL(entryPoint).href) {
  void runCatalogSeed().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : 'Unknown catalog seed error';
    console.error(`Catalog seed failed: ${message}`);
    process.exitCode = 1;
  });
}
