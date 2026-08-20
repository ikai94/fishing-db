const NATIVE_CONTRIBUTOR_PREFIX = 'local-user:';

export function nativeContributorKey(userId: string): string {
  return `${NATIVE_CONTRIBUTOR_PREFIX}${userId}`;
}
