import 'dotenv/config';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { Prisma, PrismaClient } from '../generated/prisma/client.js';
import { createPrismaAdapter } from './prisma-adapter.js';

/** Разовая команда: проверка состояния либо применение неизменённого просмотренного плана. */
type Command = { mode: 'DRY_RUN' } | { mode: 'APPLY'; expectedFingerprint: string };

/** Запрещает запись без явного режима и отпечатка предварительно проверенных данных. */
function parseCommand(arguments_: readonly string[]): Command {
  if (arguments_.length === 1 && arguments_[0] === '--dry-run') return { mode: 'DRY_RUN' };
  const prefix = '--expected-plan-fingerprint=';
  if (arguments_.length === 2 && arguments_[0] === '--apply' && arguments_[1]?.startsWith(prefix)) {
    const expectedFingerprint = arguments_[1].slice(prefix.length);
    if (/^[a-f0-9]{64}$/u.test(expectedFingerprint)) return { mode: 'APPLY', expectedFingerprint };
  }
  throw new Error('usage: --dry-run OR --apply --expected-plan-fingerprint=<SHA-256>');
}

/** Сохраняет все поля рыб и меток для проверки точной границы изменения. */
async function readState(transaction: Prisma.TransactionClient) {
  const reviews = await transaction.fishRarityReview.findMany({ orderBy: { fishId: 'asc' } });
  const fish = await transaction.fish.findMany({ orderBy: { id: 'asc' } });
  return { reviews, fish };
}

/** Сериализует точные счётчики bigint без преобразования в потенциально неточное число. */
function json(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) =>
    typeof item === 'bigint' ? item.toString() : item,
  );
}

/** Источник целей — только существующие FishRarityReview, без фильтра активности или имён. */
function buildPlan(state: Awaited<ReturnType<typeof readState>>) {
  const reviewedIds = new Set(state.reviews.map((review) => review.fishId));
  const reviewedFish = state.fish.filter((fish) => reviewedIds.has(fish.id));
  assert.equal(reviewedFish.length, state.reviews.length, 'Every review must reference a Fish');
  const changedIds = reviewedFish.filter((fish) => !fish.isRarest).map((fish) => fish.id);
  return {
    changedIds,
    counts: {
      reviewRows: state.reviews.length,
      reviewedRarest: reviewedFish.length - changedIds.length,
      reviewedNonRarest: changedIds.length,
      totalRarest: state.fish.filter((fish) => fish.isRarest).length,
    },
    planFingerprint: createHash('sha256').update(json(state)).digest('hex'),
  };
}

/** Повышает только ещё не редчайшие отмеченные рыбы; любые нарушения откатывают транзакцию. */
async function main(): Promise<void> {
  const command = parseCommand(process.argv.slice(2));
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) throw new Error('DATABASE_URL is required');
  const prisma = new PrismaClient({ adapter: createPrismaAdapter(databaseUrl) });
  try {
    const result = await prisma.$transaction(
      async (transaction) => {
        // Блокируем изменение источника и рыб до проверки результата и завершения транзакции.
        await transaction.$executeRaw`SET LOCAL lock_timeout = '10s'`;
        await transaction.$executeRaw`LOCK TABLE "Fish", "FishRarityReview" IN SHARE ROW EXCLUSIVE MODE`;
        const before = await readState(transaction);
        const plan = buildPlan(before);
        if (command.mode === 'DRY_RUN') {
          return { mode: command.mode, counts: plan.counts, planFingerprint: plan.planFingerprint };
        }
        assert.equal(plan.planFingerprint, command.expectedFingerprint, 'Previewed state changed');
        // Уже редчайшие рыбы не обновляются: сохраняются и их поля, и updatedAt.
        const updated = await transaction.fish.updateMany({
          where: { id: { in: plan.changedIds }, isRarest: false },
          data: { isRarest: true },
        });
        assert.equal(updated.count, plan.changedIds.length, 'Unexpected number of changed Fish');
        const after = await readState(transaction);
        const postPlan = buildPlan(after);
        assert.deepEqual(after.reviews, before.reviews, 'Review rows must remain unchanged');
        assert.equal(after.fish.length, before.fish.length, 'Fish count must remain unchanged');
        const changedIds = new Set(plan.changedIds);
        for (const [index, previous] of before.fish.entries()) {
          const current = after.fish[index];
          // Только целевые рыбы получают флаг и обычную Prisma-метку времени обновления.
          const expected = changedIds.has(previous.id)
            ? { ...previous, isRarest: true, updatedAt: current.updatedAt }
            : previous;
          assert.deepEqual(current, expected, `Unexpected Fish change: ${previous.id}`);
        }
        assert.equal(postPlan.counts.reviewedNonRarest, 0, 'Reviewed Fish remain non-rarest');
        assert.equal(
          postPlan.counts.totalRarest,
          plan.counts.totalRarest + updated.count,
          'Total rarest count is inconsistent',
        );
        return {
          mode: 'APPLIED',
          before: plan.counts,
          changed: updated.count,
          after: postPlan.counts,
          postStateFingerprint: postPlan.planFingerprint,
          verification: 'PASS',
        };
      },
      { isolationLevel: 'Serializable', maxWait: 10_000, timeout: 60_000 },
    );
    // Успех публикуется только после commit, чтобы ошибка фиксации не выглядела применением.
    process.stdout.write(`${json(result)}\n`);
  } finally {
    await prisma.$disconnect();
  }
}

void main().catch((error: unknown) => {
  process.stderr.write(`Fish rarity review promotion failed: ${String(error)}\n`);
  process.exitCode = 1;
});
