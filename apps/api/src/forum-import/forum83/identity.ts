import { createHash } from 'node:crypto';
import { canonicalizeExternalNumericId, deriveExternalContributorKey } from '../identity.js';
import { FORUM83_IMPORT_KEY_PREFIX } from './constants.js';

const IMPORT_NAMESPACE = 'rus-fishsoft/forum83/post-candidate/v1';

export { deriveExternalContributorKey as deriveForum83ContributorKey };

export function forum83TopicIdentity(topicId: string): string {
  return `rus-fishsoft:forum83:topic:${canonicalizeExternalNumericId(topicId)}`;
}

export function forum83PostIdentity(postId: string): string {
  return `rus-fishsoft:forum83:post:${canonicalizeExternalNumericId(postId)}`;
}

export function forum83CandidateIdentity(postId: string, candidateOrdinal: number): string {
  const canonicalPostId = canonicalizeExternalNumericId(postId);
  assertCandidateOrdinal(candidateOrdinal);
  return `rus-fishsoft:forum83:post-candidate:v1:${canonicalPostId}:${candidateOrdinal.toString(10)}`;
}

export function deriveForum83ImportKey(postId: string, candidateOrdinal: number): string {
  const canonicalPostId = canonicalizeExternalNumericId(postId);
  assertCandidateOrdinal(candidateOrdinal);
  const digest = createHash('sha256')
    .update(`${IMPORT_NAMESPACE}\0${canonicalPostId}\0${candidateOrdinal.toString(10)}`, 'utf8')
    .digest('hex');
  return `${FORUM83_IMPORT_KEY_PREFIX}${digest}`;
}

function assertCandidateOrdinal(candidateOrdinal: number): void {
  if (!Number.isSafeInteger(candidateOrdinal) || candidateOrdinal < 1) {
    throw new RangeError('Candidate ordinal must be a positive safe integer');
  }
}
