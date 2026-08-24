export const SOURCE_ORIGIN = 'https://rus-fishsoft.ru';
export const PARENT_FORUM_ID = '69' as const;

export type ScanScope =
  | {
      mode: 'TOPIC';
      topicId: string;
      limitPosts: number | null;
    }
  | {
      mode: 'SUBFORUM';
      subforumId: string;
      limitPosts: number | null;
    }
  | {
      mode: 'ALL';
      parentForumId: typeof PARENT_FORUM_ID;
      limitPosts: number | null;
    };

export class ScanScopeArgumentError extends Error {
  readonly code = 'INVALID_SCAN_SCOPE';

  constructor(message: string) {
    super(message);
    this.name = 'ScanScopeArgumentError';
  }
}

export function canonicalizePositiveDecimalId(value: string, label = 'ID'): string {
  if (!/^\d+$/.test(value)) {
    throw new ScanScopeArgumentError(`${label} must be a positive decimal integer`);
  }

  const canonical = BigInt(value);
  if (canonical <= 0n) {
    throw new ScanScopeArgumentError(`${label} must be greater than zero`);
  }

  return canonical.toString(10);
}

export function compareCanonicalIds(left: string, right: string): number {
  const leftId = BigInt(left);
  const rightId = BigInt(right);

  if (leftId < rightId) {
    return -1;
  }
  if (leftId > rightId) {
    return 1;
  }
  return 0;
}

export function parseScanScopeArgs(arguments_: readonly string[]): ScanScope {
  const options = parseOptions(arguments_);
  const scopeOptions = ['topic-id', 'subforum-id', 'all'].filter((name) => options.has(name));

  if (scopeOptions.length !== 1) {
    throw new ScanScopeArgumentError(
      'Exactly one of --topic-id, --subforum-id, or --all is required',
    );
  }

  const limitPosts = parseLimitPosts(options.get('limit-posts'));

  if (options.has('all')) {
    if (options.get('all') !== null) {
      throw new ScanScopeArgumentError('--all does not accept a value');
    }
    return { mode: 'ALL', parentForumId: PARENT_FORUM_ID, limitPosts };
  }

  const topicId = options.get('topic-id');
  if (topicId !== undefined) {
    if (topicId === null) {
      throw new ScanScopeArgumentError('--topic-id requires a value');
    }
    return {
      mode: 'TOPIC',
      topicId: canonicalizePositiveDecimalId(topicId, '--topic-id'),
      limitPosts,
    };
  }

  const subforumId = options.get('subforum-id');
  if (subforumId === undefined || subforumId === null) {
    throw new ScanScopeArgumentError('--subforum-id requires a value');
  }
  return {
    mode: 'SUBFORUM',
    subforumId: canonicalizePositiveDecimalId(subforumId, '--subforum-id'),
    limitPosts,
  };
}

export function getScopeKey(scope: ScanScope): string {
  const base =
    scope.mode === 'TOPIC'
      ? `topic-${scope.topicId}`
      : scope.mode === 'SUBFORUM'
        ? `subforum-${scope.subforumId}`
        : `all-parent-${scope.parentForumId}`;

  return scope.limitPosts === null ? base : `${base}-limit-${scope.limitPosts}`;
}

const ALLOWED_OPTIONS = new Set(['topic-id', 'subforum-id', 'all', 'limit-posts']);

function parseOptions(arguments_: readonly string[]): Map<string, string | null> {
  const options = new Map<string, string | null>();

  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument === undefined || !argument.startsWith('--') || argument === '--') {
      throw new ScanScopeArgumentError(`Unexpected positional argument: ${argument ?? ''}`);
    }

    const separatorIndex = argument.indexOf('=');
    const name = argument.slice(2, separatorIndex === -1 ? undefined : separatorIndex);
    if (!ALLOWED_OPTIONS.has(name)) {
      throw new ScanScopeArgumentError(`Unknown option: --${name}`);
    }
    if (options.has(name)) {
      throw new ScanScopeArgumentError(`Duplicate option: --${name}`);
    }

    let value: string | null = null;
    if (separatorIndex !== -1) {
      value = argument.slice(separatorIndex + 1);
      if (value.length === 0) {
        throw new ScanScopeArgumentError(`--${name} requires a non-empty value`);
      }
    } else if (name !== 'all') {
      const following = arguments_[index + 1];
      if (following !== undefined && !following.startsWith('--')) {
        value = following;
        index += 1;
      }
    }

    options.set(name, value);
  }

  return options;
}

function parseLimitPosts(value: string | null | undefined): number | null {
  if (value === undefined) {
    return null;
  }
  if (value === null) {
    throw new ScanScopeArgumentError('--limit-posts requires a value');
  }

  const canonical = canonicalizePositiveDecimalId(value, '--limit-posts');
  const limit = BigInt(canonical);
  if (limit > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new ScanScopeArgumentError('--limit-posts exceeds the safe integer range');
  }

  return Number(limit);
}
