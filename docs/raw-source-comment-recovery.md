# Raw-source comment backfill

This separate operation restores only `userNoteRaw` on the 792 existing reports whose stored
`rawSourceText` contains a nonempty comment resolved by the current application parser. It does
not invoke forum import/recovery or online mutation services. Historical structured fields remain
unchanged, including the four Fish-resolution disagreements already observed during discovery.

The unavailable previous audit was replaced, as explicitly authorized, with a fresh deterministic
baseline. Two independent read-only DB/parser passes produced the same 792 IDs and manifest bytes.
All comments were NULL, with zero conflicts and zero historical forum candidates.

Manifest SHA-256:
`9cdb1c457157487a95660f290488fd99db7a93ddaaa38f4597c946b8f6457e9f`.

Runtime artifacts reside under `apps/api/.local/raw-source-comment-recovery/frozen/`, ignored by
Git: `manifest.json`, `baseline.json`, `independent-pass.json`, `checkpoint.json`, `runs/`, and
`last-run.json`. JSON files are written atomically with mode `0600`; the directory uses `0700`.
The manifest pins exact IDs, UTF-8 SHA-256 of raw source, proposed comments, complete non-comment
row hashes, parser/recovery code, catalog, active anchors, schema and lockfile. Baseline also pins
all 26,466 prefilter rows, all 69,403 historical forum reports (including the 1,375 held cases),
the held-case artifact, Fish rows/counters, and append-only activity count/max ID.

Commands, from `apps/api`:

```sh
node --import tsx src/forum-import/recover-raw-source-comments.ts freeze
node --import tsx src/forum-import/recover-raw-source-comments.ts check SHA256
node --import tsx src/forum-import/recover-raw-source-comments.ts apply SHA256
```

Do not freeze again after completion: freeze refuses replacement and check expects the original
NULL comments. Reuse `apply` with the pinned manifest hash for resume or completed verification.
Kernel `flock` permits one operation at a time. Batches contain at most 100 locked IDs, use bounded
timeouts, and validate every precondition before DML. SQL sets only `userNoteRaw` and predicates
on ID, exact raw-source hash, full non-comment row hash, and `userNoteRaw IS NULL`. It bypasses
Prisma `@updatedAt`. Any drift aborts the batch. Exact previously committed values permit replay;
different non-NULL comments are preserved and cause an abort. Checkpoint advances after COMMIT.

Completed write: **792 planned / 792 updated / 0 skipped**, in **8 batches**. Non-comment fields,
including `updatedAt`, raw text, and structured history, were unchanged. Forum/held reports, Fish
counters and activity were unchanged. Focused coverage verifies PostgreSQL hashes, comment-only
100-row writes/replay, whole-batch rollback on drift, and explicit historical forum exclusion.
Completed rerun: **0 updated / 792 skipped** with the same manifest and checkpoint. Separate
read-only verification confirmed all 792 exact comments/source hashes, zero non-comment changes,
and the unchanged complete forum snapshot; evidence is in `independent-verification.json`.
No schema, migration, generated-client or dependency changes; no broad suite or commit.
