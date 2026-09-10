import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { Prisma, PrismaClient } from '../generated/prisma/client.js';
import { sha256, stableJson } from './fish-catalog-audit.js';
import {
  buildFishRarityMaterializationPlan,
  validateFishRarityManifest,
  type LiveFishRarityRow,
} from './fish-rarity-materialization.js';
import { createPrismaAdapter } from './prisma-adapter.js';

export const ACCEPTED_FISH_RARITY_MANIFEST_SHA256 =
  '227a266bbed2f56ad3330f17a09afdcd07c707b7a895a3c9fd175e8d9a9c030e';

const MANIFEST_URL = new URL(
  '../../prisma/catalog-data/fish-rarity-20260910.json',
  import.meta.url,
);
const MATERIALIZATION_LOCK = 'LOCK TABLE "Fish" IN SHARE ROW EXCLUSIVE MODE';

type Command = { mode: 'DRY_RUN' } | { mode: 'APPLY'; expectedPlanFingerprint: string };

export function parseFishRarityMaterializationCommand(arguments_: readonly string[]): Command {
  if (arguments_.length === 1 && arguments_[0] === '--dry-run') return { mode: 'DRY_RUN' };
  const prefix = '--expected-plan-fingerprint=';
  if (arguments_.length === 2 && arguments_[0] === '--apply' && arguments_[1]?.startsWith(prefix)) {
    const expectedPlanFingerprint = arguments_[1].slice(prefix.length);
    if (/^[a-f0-9]{64}$/u.test(expectedPlanFingerprint)) {
      return { mode: 'APPLY', expectedPlanFingerprint };
    }
  }
  throw new Error(
    'usage: --dry-run OR --apply --expected-plan-fingerprint=<64-character lowercase SHA-256>',
  );
}

async function readManifest() {
  const content = await readFile(MANIFEST_URL, 'utf8');
  const hash = sha256(content);
  if (hash !== ACCEPTED_FISH_RARITY_MANIFEST_SHA256) {
    throw new Error(
      `Fish rarity manifest SHA-256 is ${hash}; expected ${ACCEPTED_FISH_RARITY_MANIFEST_SHA256}`,
    );
  }
  const manifest = validateFishRarityManifest(JSON.parse(content) as unknown);
  if (content !== stableJson(manifest)) {
    throw new Error('Fish rarity manifest formatting is not deterministic');
  }
  return { hash, manifest };
}

async function loadLiveFish(transaction: Prisma.TransactionClient): Promise<LiveFishRarityRow[]> {
  return transaction.fish.findMany({
    orderBy: [{ name: 'asc' }, { id: 'asc' }],
    select: { id: true, name: true, isRarest: true },
  });
}

async function main(): Promise<void> {
  const command = parseFishRarityMaterializationCommand(process.argv.slice(2));
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) throw new Error('DATABASE_URL is required');
  const source = await readManifest();
  const prisma = new PrismaClient({ adapter: createPrismaAdapter(databaseUrl) });

  try {
    if (command.mode === 'DRY_RUN') {
      const liveFish = await loadLiveFish(prisma);
      const plan = buildFishRarityMaterializationPlan({
        manifestSha256: source.hash,
        manifest: source.manifest,
        liveFish,
      });
      process.stdout.write(stableJson(plan));
      if (plan.blockers.length > 0) process.exitCode = 1;
      return;
    }

    const result = await prisma.$transaction(
      async (transaction) => {
        await transaction.$executeRawUnsafe(MATERIALIZATION_LOCK);
        const liveFish = await loadLiveFish(transaction);
        const plan = buildFishRarityMaterializationPlan({
          manifestSha256: source.hash,
          manifest: source.manifest,
          liveFish,
        });
        if (plan.planFingerprint !== command.expectedPlanFingerprint) {
          throw new Error(
            `Fish rarity plan fingerprint is ${plan.planFingerprint}; expected ${command.expectedPlanFingerprint}`,
          );
        }
        if (plan.blockers.length > 0) {
          throw new Error(
            `Fish rarity materialization is blocked:\n- ${plan.blockers.join('\n- ')}`,
          );
        }

        const targetNames = source.manifest.fish;
        const enabled = await transaction.fish.updateMany({
          where: { name: { in: targetNames }, isRarest: false },
          data: { isRarest: true },
        });
        const disabled = await transaction.fish.updateMany({
          where: { name: { notIn: targetNames }, isRarest: true },
          data: { isRarest: false },
        });
        const postPlan = buildFishRarityMaterializationPlan({
          manifestSha256: source.hash,
          manifest: source.manifest,
          liveFish: await loadLiveFish(transaction),
        });
        const expectedRarest = source.manifest.fish.length;
        if (
          postPlan.blockers.length > 0 ||
          postPlan.counts.rareAfter !== expectedRarest ||
          postPlan.counts.notRareAfter !== source.manifest.expectedFishCount - expectedRarest ||
          postPlan.counts.writes !== 0
        ) {
          throw new Error('Fish rarity materialization post-state assertion failed');
        }
        return { enabled: enabled.count, disabled: disabled.count, postState: postPlan.counts };
      },
      { isolationLevel: 'Serializable', maxWait: 10_000, timeout: 60_000 },
    );
    process.stdout.write(stableJson({ mode: 'APPLIED', ...result }));
  } finally {
    await prisma.$disconnect();
  }
}

const isDirectRun =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) {
  void main().catch((error: unknown) => {
    process.stderr.write(
      `Fish rarity materialization failed: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  });
}
