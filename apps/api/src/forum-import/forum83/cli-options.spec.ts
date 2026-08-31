import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Forum83CliArgumentError, parseForum83CliOptions } from './cli-options.js';

void describe('forum83 CLI options', () => {
  void it('keeps scan/stage/audit/review in the separate forum83 scope', () => {
    assert.deepEqual(
      parseForum83CliOptions([
        'scan',
        '--',
        '--topic-id=00357',
        '--limit-posts=25',
        '--delay-ms=1000',
      ]),
      {
        command: 'scan',
        scope: { mode: 'TOPIC', topicId: '357', limitPosts: 25 },
        delayMs: 1_000,
        dryRun: false,
        approvedAuditSha256: null,
      },
    );
    assert.deepEqual(parseForum83CliOptions(['audit', '--all']), {
      command: 'audit',
      scope: { mode: 'ALL', forumId: '83', limitPosts: null },
      delayMs: 2_000,
      dryRun: false,
      approvedAuditSha256: null,
    });
  });

  void it('allows only an explicit dry-run against the frozen full import scope', () => {
    assert.deepEqual(parseForum83CliOptions(['import-complete', '--dry-run', '--all']), {
      command: 'import-complete',
      scope: { mode: 'ALL', forumId: '83', limitPosts: null },
      delayMs: 2_000,
      dryRun: true,
      approvedAuditSha256: null,
    });
    for (const arguments_ of [
      ['import-complete', '--all'],
      ['import-complete', '--dry-run', '--topic-id=357'],
      ['import-complete', '--dry-run', '--all', '--limit-posts=25'],
    ]) {
      assert.throws(() => parseForum83CliOptions(arguments_), Forum83CliArgumentError);
    }
  });

  void it('requires a pinned approved audit SHA for the live full-scope import', () => {
    const approvedAudit = 'b9d69b59aa607ea18fdaa140d4ecfe685f6ef1f23b4fd33c80a94e7fb7842d8c';
    assert.deepEqual(
      parseForum83CliOptions([
        'import-complete',
        '--apply',
        `--approved-audit-sha256=${approvedAudit}`,
        '--all',
      ]),
      {
        command: 'import-complete',
        scope: { mode: 'ALL', forumId: '83', limitPosts: null },
        delayMs: 2_000,
        dryRun: false,
        approvedAuditSha256: approvedAudit,
      },
    );
    for (const arguments_ of [
      ['import-complete', '--apply', '--all'],
      ['import-complete', '--apply', '--dry-run', '--all'],
      ['import-complete', '--dry-run', `--approved-audit-sha256=${approvedAudit}`, '--all'],
      ['import-complete', '--apply', '--approved-audit-sha256=not-a-sha', '--all'],
      ['import-complete', '--apply', `--approved-audit-sha256=${'a'.repeat(64)}`, '--all'],
    ]) {
      assert.throws(() => parseForum83CliOptions(arguments_), Forum83CliArgumentError);
    }
  });

  void it('rejects unsupported import and forum69-only scan semantics', () => {
    for (const arguments_ of [
      ['import', '--all'],
      ['stage', '--all', '--delay-ms=1000'],
      ['scan', '--subforum-id=83'],
    ]) {
      assert.throws(() => parseForum83CliOptions(arguments_), Forum83CliArgumentError);
    }
  });
});
