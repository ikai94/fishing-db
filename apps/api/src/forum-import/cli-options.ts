import { parseScanScopeArgs, type ScanScope } from './scope.js';

export type ForumCliCommand = 'scan' | 'stage' | 'audit' | 'review' | 'import-complete';

export interface ForumCliOptions {
  command: ForumCliCommand;
  scope: ScanScope;
  delayMs: number;
  rebaseIdentities: boolean;
  dryRun: boolean;
}

export class ForumCliArgumentError extends Error {
  readonly code = 'INVALID_FORUM_CLI_ARGUMENTS';

  constructor(message: string) {
    super(message);
    this.name = 'ForumCliArgumentError';
  }
}

const COMMANDS = new Set<ForumCliCommand>(['scan', 'stage', 'audit', 'review', 'import-complete']);
const DEFAULT_DELAY_MS = 2_000;
const MINIMUM_DELAY_MS = 1_000;
const MAXIMUM_DELAY_MS = 60_000;

export function parseForumCliOptions(arguments_: readonly string[]): ForumCliOptions {
  const [rawCommand, ...forwardedOptions] = arguments_;
  if (rawCommand === undefined || !COMMANDS.has(rawCommand as ForumCliCommand)) {
    throw new ForumCliArgumentError(
      'Command must be scan, stage, audit, review, or import-complete',
    );
  }
  const command = rawCommand as ForumCliCommand;
  const rawOptions = forwardedOptions[0] === '--' ? forwardedOptions.slice(1) : forwardedOptions;
  const extracted = extractLocalOptions(rawOptions);
  if (command !== 'scan' && extracted.delayValue !== undefined) {
    throw new ForumCliArgumentError('--delay-ms is only valid for scan');
  }
  if (command !== 'stage' && extracted.rebaseIdentities) {
    throw new ForumCliArgumentError('--rebase-identities is only valid for stage');
  }
  if (command !== 'import-complete' && extracted.dryRun) {
    throw new ForumCliArgumentError('--dry-run is only valid for import-complete');
  }

  try {
    return {
      command,
      scope: parseScanScopeArgs(extracted.scopeArguments),
      delayMs:
        extracted.delayValue === undefined ? DEFAULT_DELAY_MS : parseDelay(extracted.delayValue),
      rebaseIdentities: extracted.rebaseIdentities,
      dryRun: extracted.dryRun,
    };
  } catch (error: unknown) {
    if (error instanceof ForumCliArgumentError) throw error;
    throw new ForumCliArgumentError(error instanceof Error ? error.message : 'Invalid scan scope');
  }
}

function extractLocalOptions(arguments_: readonly string[]): {
  scopeArguments: string[];
  delayValue: string | undefined;
  rebaseIdentities: boolean;
  dryRun: boolean;
} {
  const scopeArguments: string[] = [];
  let delayValue: string | undefined;
  let rebaseIdentities = false;
  let dryRun = false;

  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument === undefined) continue;
    if (argument === '--rebase-identities') {
      if (rebaseIdentities) {
        throw new ForumCliArgumentError('Duplicate option: --rebase-identities');
      }
      rebaseIdentities = true;
      continue;
    }
    if (argument === '--dry-run') {
      if (dryRun) {
        throw new ForumCliArgumentError('Duplicate option: --dry-run');
      }
      dryRun = true;
      continue;
    }
    if (argument.startsWith('--dry-run=')) {
      throw new ForumCliArgumentError('--dry-run does not accept a value');
    }
    if (argument.startsWith('--rebase-identities=')) {
      throw new ForumCliArgumentError('--rebase-identities does not accept a value');
    }
    const match = /^--delay-ms(?:=(.*))?$/u.exec(argument);
    if (match === null) {
      scopeArguments.push(argument);
      continue;
    }

    let value = match[1];
    if (value === undefined) {
      const following = arguments_[index + 1];
      if (following !== undefined && !following.startsWith('--')) {
        value = following;
        index += 1;
      }
    }
    if (value === undefined || value.length === 0) {
      throw new ForumCliArgumentError('--delay-ms requires a non-empty value');
    }

    if (delayValue !== undefined) {
      throw new ForumCliArgumentError('Duplicate option: --delay-ms');
    }
    delayValue = value;
  }

  return { scopeArguments, delayValue, rebaseIdentities, dryRun };
}

function parseDelay(value: string): number {
  if (!/^\d+$/u.test(value)) {
    throw new ForumCliArgumentError('--delay-ms must be a decimal integer');
  }
  const delay = Number(value);
  if (!Number.isSafeInteger(delay) || delay < MINIMUM_DELAY_MS || delay > MAXIMUM_DELAY_MS) {
    throw new ForumCliArgumentError(
      `--delay-ms must be between ${MINIMUM_DELAY_MS} and ${MAXIMUM_DELAY_MS}`,
    );
  }
  return delay;
}
