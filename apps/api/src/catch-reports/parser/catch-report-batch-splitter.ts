export const CATCH_REPORT_BATCH_MAX_ITEMS = 5_000;
export const CATCH_REPORT_BATCH_MAX_SOURCE_LENGTH = 1_000_000;

export interface CatchReportBatchCandidate {
  index: number;
  sourceLine: number;
  rawSourceText: string;
}

export function splitCatchReportBatchSource(rawSourceText: string): CatchReportBatchCandidate[] {
  const candidates: CatchReportBatchCandidate[] = [];
  const lines = rawSourceText.split(/\r\n|[\n\r]/u);

  for (const [lineIndex, line] of lines.entries()) {
    if (line.trim().length === 0) continue;

    candidates.push({
      index: candidates.length,
      sourceLine: lineIndex + 1,
      rawSourceText: line,
    });
  }

  return candidates;
}

export function duplicateIndexesByCandidate(
  candidates: readonly CatchReportBatchCandidate[],
): ReadonlyMap<number, number[]> {
  const indexesBySource = new Map<string, number[]>();

  for (const candidate of candidates) {
    const indexes = indexesBySource.get(candidate.rawSourceText) ?? [];
    indexes.push(candidate.index);
    indexesBySource.set(candidate.rawSourceText, indexes);
  }

  const duplicates = new Map<number, number[]>();
  for (const indexes of indexesBySource.values()) {
    if (indexes.length < 2) continue;
    const first = indexes[0];
    const second = indexes[1];
    if (first === undefined || second === undefined) continue;

    duplicates.set(first, [second]);
    for (const index of indexes.slice(1)) {
      duplicates.set(index, [first]);
    }
  }

  return duplicates;
}
