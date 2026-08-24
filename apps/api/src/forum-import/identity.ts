import { createHash } from 'node:crypto';

const CONTRIBUTOR_NAMESPACE = 'rus-fishsoft/member/v1';
const CONTRIBUTOR_PREFIX = 'external:rus-fishsoft:member:v1:';
const IMPORT_NAMESPACE = 'rus-fishsoft/post-candidate/v1';
export const EXTERNAL_IMPORT_KEY_PREFIX = 'external:rus-fishsoft:observation:v1:';
const DECIMAL_ID = /^\d+$/u;

export function canonicalizeExternalNumericId(value: string): string {
  if (!DECIMAL_ID.test(value)) {
    throw new TypeError('External ID must contain only base-10 digits');
  }

  const canonical = BigInt(value).toString(10);

  if (canonical === '0') {
    throw new RangeError('External ID must be positive');
  }

  return canonical;
}

function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

export function deriveExternalContributorKey(memberId: string): string {
  const canonicalMemberId = canonicalizeExternalNumericId(memberId);
  const digest = sha256Hex(`${CONTRIBUTOR_NAMESPACE}\0${canonicalMemberId}`);
  return `${CONTRIBUTOR_PREFIX}${digest}`;
}

export function deriveExternalImportKey(postId: string, candidateOrdinal: number): string {
  const canonicalPostId = canonicalizeExternalNumericId(postId);

  if (!Number.isSafeInteger(candidateOrdinal) || candidateOrdinal < 1) {
    throw new RangeError('Candidate ordinal must be a positive safe integer');
  }

  const digest = sha256Hex(
    `${IMPORT_NAMESPACE}\0${canonicalPostId}\0${candidateOrdinal.toString(10)}`,
  );
  return `${EXTERNAL_IMPORT_KEY_PREFIX}${digest}`;
}
