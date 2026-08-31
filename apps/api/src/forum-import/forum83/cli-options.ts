import { parseForum83Scope, type Forum83ScanScope } from './scope.js';
import { FORUM83_REVIEWED_AUDIT_SHA256 } from './reviewed-audit.js';

export type Forum83Command = 'scan' | 'stage' | 'audit' | 'review' | 'import-complete';

export interface Forum83CliOptions {
  command: Forum83Command;
  scope: Forum83ScanScope;
  delayMs: number;
  dryRun: boolean;
  approvedAuditSha256: string | null;
}

export class Forum83CliArgumentError extends Error {
  readonly code = 'INVALID_FORUM83_CLI_ARGUMENTS';

  constructor(message: string) {
    super(message);
    this.name = 'Forum83CliArgumentError';
  }
}

const COMMANDS = new Set<Forum83Command>(['scan', 'stage', 'audit', 'review', 'import-complete']);
const DEFAULT_DELAY_MS = 2_000;

export function parseForum83CliOptions(arguments_: readonly string[]): Forum83CliOptions {
  const [rawCommand, ...forwarded] = arguments_;
  if (rawCommand === undefined || !COMMANDS.has(rawCommand as Forum83Command)) {
    throw new Forum83CliArgumentError(
      'Command must be scan, stage, audit, review, or import-complete',
    );
  }
  const command = rawCommand as Forum83Command;
  const options = forwarded[0] === '--' ? forwarded.slice(1) : forwarded;
  const scopeArguments: string[] = [];
  let delayMs = DEFAULT_DELAY_MS;
  let delaySeen = false;
  let dryRun = false;
  let apply = false;
  let approvedAuditSha256: string | null = null;
  for (let index = 0; index < options.length; index += 1) {
    const argument = options[index];
    if (argument === undefined) continue;
    if (argument === '--dry-run') {
      if (command !== 'import-complete') {
        throw new Forum83CliArgumentError('--dry-run is only valid for import-complete');
      }
      if (dryRun) throw new Forum83CliArgumentError('Duplicate option: --dry-run');
      dryRun = true;
      continue;
    }
    if (argument === '--apply') {
      if (command !== 'import-complete') {
        throw new Forum83CliArgumentError('--apply is only valid for import-complete');
      }
      if (apply) throw new Forum83CliArgumentError('Duplicate option: --apply');
      apply = true;
      continue;
    }
    const approvedAuditMatch = /^--approved-audit-sha256=([0-9a-f]{64})$/u.exec(argument);
    if (approvedAuditMatch !== null) {
      if (command !== 'import-complete') {
        throw new Forum83CliArgumentError(
          '--approved-audit-sha256 is only valid for import-complete',
        );
      }
      if (approvedAuditSha256 !== null) {
        throw new Forum83CliArgumentError('Duplicate option: --approved-audit-sha256');
      }
      approvedAuditSha256 = approvedAuditMatch[1] ?? null;
      continue;
    }
    if (argument.startsWith('--dry-run=')) {
      throw new Forum83CliArgumentError('--dry-run does not accept a value');
    }
    if (argument.startsWith('--apply=')) {
      throw new Forum83CliArgumentError('--apply does not accept a value');
    }
    if (argument.startsWith('--approved-audit-sha256')) {
      throw new Forum83CliArgumentError(
        '--approved-audit-sha256 requires a lowercase SHA-256 value',
      );
    }
    const match = /^--delay-ms(?:=(.*))?$/u.exec(argument);
    if (match === null) {
      scopeArguments.push(argument);
      continue;
    }
    if (command !== 'scan') throw new Forum83CliArgumentError('--delay-ms is only valid for scan');
    if (delaySeen) throw new Forum83CliArgumentError('Duplicate option: --delay-ms');
    let value = match[1];
    if (value === undefined) {
      const following = options[index + 1];
      if (following !== undefined && !following.startsWith('--')) {
        value = following;
        index += 1;
      }
    }
    if (value === undefined || !/^\d+$/u.test(value)) {
      throw new Forum83CliArgumentError('--delay-ms requires a decimal integer');
    }
    delayMs = Number(value);
    if (!Number.isSafeInteger(delayMs) || delayMs < 1_000 || delayMs > 60_000) {
      throw new Forum83CliArgumentError('--delay-ms must be between 1000 and 60000');
    }
    delaySeen = true;
  }
  try {
    const scope = parseForum83Scope(scopeArguments);
    if (command === 'import-complete') {
      if (dryRun === apply) {
        throw new Forum83CliArgumentError(
          'forum83 import-complete requires exactly one of --dry-run or --apply',
        );
      }
      if (apply && approvedAuditSha256 === null) {
        throw new Forum83CliArgumentError('forum83 live import requires --approved-audit-sha256');
      }
      if (apply && approvedAuditSha256 !== FORUM83_REVIEWED_AUDIT_SHA256) {
        throw new Forum83CliArgumentError(
          `forum83 live import requires approved audit ${FORUM83_REVIEWED_AUDIT_SHA256}`,
        );
      }
      if (dryRun && approvedAuditSha256 !== null) {
        throw new Forum83CliArgumentError('--approved-audit-sha256 is only accepted with --apply');
      }
      if (scope.mode !== 'ALL' || scope.limitPosts !== null) {
        throw new Forum83CliArgumentError(
          'forum83 import-complete requires the frozen --all scope without --limit-posts',
        );
      }
    }
    return { command, scope, delayMs, dryRun, approvedAuditSha256 };
  } catch (error: unknown) {
    throw new Forum83CliArgumentError(error instanceof Error ? error.message : 'Invalid scope');
  }
}
