import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  appendManualWeightGold,
  benchmarkManualWeightGold,
  parseGoldCatalog,
  parseGoldPredictions,
  validateManualWeightGold,
} from './manual-weight-gold.js';

import {
  appendManualWeightGoldBatch,
  validateManualWeightGoldBatch,
} from './manual-weight-gold-batch.js';

/** Начальный эталон независим от манифеста исправлений и от текущих весов БД. */
const defaultGoldPath = fileURLToPath(
  new URL('../../prisma/catalog-data/weight-gold/2026-10-05.v1.json', import.meta.url),
);

/** Для CLI доступны лишь проверка, новая файловая версия и оценка готовых прогнозов. */
export function runManualWeightGoldCommand(args: string[]): void {
  const [command, ...flags] = args;
  if (!['validate', 'append', 'benchmark', 'validate-batch', 'append-batch'].includes(command)) {
    throw new Error(
      'Use validate|append|benchmark|validate-batch|append-batch --catalog <snapshot.json> [--gold <version.json>]',
    );
  }
  const options = new Map<string, string>();
  const allowed = [
    '--catalog',
    '--gold',
    ...(command === 'append' ? ['--entry', '--output'] : []),
    ...(command === 'benchmark' ? ['--predictions'] : []),
    ...(['validate-batch', 'append-batch'].includes(command) ? ['--csv'] : []),
    ...(command === 'append-batch' ? ['--output'] : []),
  ];
  for (let i = 0; i < flags.length; i += 2) {
    const flag = flags[i];
    const value = flags[i + 1];
    if (!allowed.includes(flag) || !value || value.startsWith('--') || options.has(flag)) {
      throw new Error(`Invalid or repeated option: ${flag}`);
    }
    options.set(flag, value);
  }
  /** Отсутствующий путь — ошибка, а не повод обратиться к БД или догадаться о другом файле. */
  const required = (flag: string): string => {
    const value = options.get(flag);
    if (!value) throw new Error(`Required option: ${flag}`);
    return resolve(value);
  };
  /** Хеш позволяет воспроизвести результат по тем же файлам, не сохраняя внешних секретов. */
  const read = (path: string): { value: unknown; sha256: string } => {
    const bytes = readFileSync(path);
    return {
      value: JSON.parse(bytes.toString('utf8')) as unknown,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    };
  };
  const catalogFile = read(required('--catalog'));
  const catalog = parseGoldCatalog(catalogFile.value);
  const goldPath = resolve(options.get('--gold') ?? defaultGoldPath);
  // Прогноз загружается отдельно; никакая функция inference не получает эталонные поля.
  const predictionFile = command === 'benchmark' ? read(required('--predictions')) : null;
  const predictions = predictionFile ? parseGoldPredictions(predictionFile.value) : null;
  const goldFile = read(goldPath);
  const gold = validateManualWeightGold(goldFile.value, catalog);
  if (basename(goldPath, '.json') !== gold.datasetVersion) {
    throw new Error('GOLD filename must match datasetVersion');
  }
  if (command === 'validate-batch' || command === 'append-batch') {
    const validation = validateManualWeightGoldBatch(
      readFileSync(required('--csv'), 'utf8'),
      gold,
      catalog,
    );
    const summary = {
      valid: validation.valid,
      accepted: validation.accepted,
      rejected: validation.rejected,
      errors: validation.errors,
    };
    if (!validation.valid) {
      console.log(JSON.stringify({ ...summary, written: false }, null, 2));
      throw new Error('Batch rejected; no GOLD file written');
    }
    if (command === 'validate-batch') {
      console.log(JSON.stringify({ ...summary, written: false }, null, 2));
      return;
    }
    const output = required('--output');
    if (!output.endsWith('.json')) throw new Error('Output must be a .json version file');
    const next = appendManualWeightGoldBatch(gold, validation, basename(output, '.json'), catalog);
    // Проверка всего пакета предшествует exclusive-записи; частичного добавления нет.
    writeFileSync(output, `${JSON.stringify(next, null, 2)}\n`, { flag: 'wx' });
    console.log(
      JSON.stringify(
        {
          ...summary,
          written: true,
          output,
          datasetVersion: next.datasetVersion,
          entries: next.entries.length,
        },
        null,
        2,
      ),
    );
  } else if (command === 'append') {
    const output = required('--output');
    if (!output.endsWith('.json')) throw new Error('Output must be a .json version file');
    const next = appendManualWeightGold(
      gold,
      read(required('--entry')).value,
      basename(output, '.json'),
      catalog,
    );
    // exclusive запрещает перезапись любой версии; все проверки завершены до записи.
    writeFileSync(output, `${JSON.stringify(next, null, 2)}\n`, { flag: 'wx' });
    console.log(
      JSON.stringify(
        { output, datasetVersion: next.datasetVersion, entries: next.entries.length },
        null,
        2,
      ),
    );
  } else if (command === 'benchmark' && predictions && predictionFile) {
    console.log(
      JSON.stringify(
        {
          ...benchmarkManualWeightGold(predictions, gold),
          sources: {
            goldSha256: goldFile.sha256,
            predictionsSha256: predictionFile.sha256,
            catalogSha256: catalogFile.sha256,
          },
        },
        null,
        2,
      ),
    );
  } else {
    console.log(
      JSON.stringify(
        {
          valid: true,
          datasetVersion: gold.datasetVersion,
          entries: gold.entries.length,
          goldSha256: goldFile.sha256,
          catalogSha256: catalogFile.sha256,
        },
        null,
        2,
      ),
    );
  }
}

// Импорт тестом не запускает команду и не создает файлов.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    runManualWeightGoldCommand(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
