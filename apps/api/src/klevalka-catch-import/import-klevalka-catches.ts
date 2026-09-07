import 'dotenv/config';
import { isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';
import { PrismaClient } from '../generated/prisma/client.js';
import { createPrismaAdapter } from '../prisma/prisma-adapter.js';
import { importKlevalkaCatchRelease } from './klevalka-catch-importer.js';

interface Command {
  releasePath: string;
  targetUserId: string;
}

function requiredValue(args: readonly string[], index: number, option: string): string {
  const value = args[index + 1];
  if (value === undefined || value.startsWith('--')) throw new Error(`${option} requires a value`);
  return value;
}

export function parseKlevalkaCatchImportCommand(args: readonly string[]): Command {
  let releasePath: string | undefined;
  let targetUserId: string | undefined;
  for (let index = 0; index < args.length; index += 1) {
    const option = args[index];
    if (option === '--release') releasePath = requiredValue(args, index++, option);
    else if (option === '--user-id') targetUserId = requiredValue(args, index++, option);
    else throw new Error(`Unknown argument: ${option ?? ''}`);
  }
  if (releasePath === undefined || targetUserId === undefined) {
    throw new Error(
      'usage: import-klevalka-catches --release <absolute v3 directory> --user-id <UUIDv4>',
    );
  }
  if (!isAbsolute(releasePath)) throw new Error('--release must be an absolute path');
  return { releasePath, targetUserId };
}

export async function runKlevalkaCatchImport(args = process.argv.slice(2)): Promise<void> {
  const command = parseKlevalkaCatchImportCommand(args);
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) throw new Error('DATABASE_URL is required');
  const prisma = new PrismaClient({ adapter: createPrismaAdapter(databaseUrl) });
  try {
    console.info(JSON.stringify(await importKlevalkaCatchRelease(prisma, command), null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

const entryPoint = process.argv[1];
if (entryPoint !== undefined && import.meta.url === pathToFileURL(entryPoint).href) {
  void runKlevalkaCatchImport().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : 'Unknown Klevalka catch import error');
    process.exitCode = 1;
  });
}
