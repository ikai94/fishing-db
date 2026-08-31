import { canonicalizePositiveDecimalId } from '../scope.js';
import { FORUM83_ID } from './constants.js';

export type Forum83ScanScope =
  | { mode: 'TOPIC'; topicId: string; limitPosts: number | null }
  | { mode: 'ALL'; forumId: typeof FORUM83_ID; limitPosts: number | null };

export class Forum83ScopeArgumentError extends Error {
  readonly code = 'INVALID_FORUM83_SCOPE';

  constructor(message: string) {
    super(message);
    this.name = 'Forum83ScopeArgumentError';
  }
}

export function parseForum83Scope(arguments_: readonly string[]): Forum83ScanScope {
  const options = parseOptions(arguments_);
  const modes = ['topic-id', 'all'].filter((name) => options.has(name));
  if (modes.length !== 1) {
    throw new Forum83ScopeArgumentError('Exactly one of --topic-id or --all is required');
  }
  const limitPosts = parseLimit(options.get('limit-posts'));
  if (options.has('all')) {
    if (options.get('all') !== null) {
      throw new Forum83ScopeArgumentError('--all does not accept a value');
    }
    return { mode: 'ALL', forumId: FORUM83_ID, limitPosts };
  }
  const topicId = options.get('topic-id');
  if (topicId === null || topicId === undefined) {
    throw new Forum83ScopeArgumentError('--topic-id requires a value');
  }
  try {
    return {
      mode: 'TOPIC',
      topicId: canonicalizePositiveDecimalId(topicId, '--topic-id'),
      limitPosts,
    };
  } catch (error: unknown) {
    throw new Forum83ScopeArgumentError(error instanceof Error ? error.message : 'Invalid scope');
  }
}

export function forum83ScopeKey(scope: Forum83ScanScope): string {
  const base = scope.mode === 'TOPIC' ? `forum83-topic-${scope.topicId}` : 'forum83-all-forum-83';
  return scope.limitPosts === null ? base : `${base}-limit-${scope.limitPosts}`;
}

function parseOptions(arguments_: readonly string[]): Map<string, string | null> {
  const allowed = new Set(['topic-id', 'all', 'limit-posts']);
  const options = new Map<string, string | null>();
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument === undefined || !argument.startsWith('--') || argument === '--') {
      throw new Forum83ScopeArgumentError(`Unexpected positional argument: ${argument ?? ''}`);
    }
    const separator = argument.indexOf('=');
    const name = argument.slice(2, separator === -1 ? undefined : separator);
    if (!allowed.has(name)) throw new Forum83ScopeArgumentError(`Unknown option: --${name}`);
    if (options.has(name)) throw new Forum83ScopeArgumentError(`Duplicate option: --${name}`);
    let value: string | null = null;
    if (separator !== -1) {
      value = argument.slice(separator + 1);
      if (value.length === 0) {
        throw new Forum83ScopeArgumentError(`--${name} requires a non-empty value`);
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

function parseLimit(value: string | null | undefined): number | null {
  if (value === undefined) return null;
  if (value === null) throw new Forum83ScopeArgumentError('--limit-posts requires a value');
  try {
    const canonical = canonicalizePositiveDecimalId(value, '--limit-posts');
    const limit = BigInt(canonical);
    if (limit > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new Forum83ScopeArgumentError('--limit-posts exceeds the safe integer range');
    }
    return Number(limit);
  } catch (error: unknown) {
    if (error instanceof Forum83ScopeArgumentError) throw error;
    throw new Forum83ScopeArgumentError(error instanceof Error ? error.message : 'Invalid limit');
  }
}
