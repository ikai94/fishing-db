# One-time historical forum comment recovery

This is a reconciliation of existing rows, with no import/create/delete path. The discovery
command remains **dry-run only**:

```sh
pnpm forum:recover-comments:dry-run
```

It reads the current database in a PostgreSQL `REPEATABLE READ`, `READ ONLY` transaction and
disconnects before parsing. It writes only local files under
`apps/api/.local/forum-import/rus-fishsoft/comment-recovery/dry-run/` (ignored by Git, mode `0600`):

- `report.json`: counts, exclusions, examples, source/code/catalog/database/plan fingerprints;
- `candidates.jsonl`: exact proposed `id` → `userNoteRaw` values and per-row precondition hashes;
- `cases.jsonl`: every matching/interpretation failure and current-parser structured disagreement;
- `source-without-reports.jsonl`: rediscovered observations without a current report, including
  frozen staging exclusions. None are candidates for creation.

`--output`, `--forum69-root`, and `--forum83-root` accept alternate local artifact directories.
There is no `--apply`/write option. Missing, corrupt, incomplete, changed, or unfrozen inputs fail
the run; they are not replaced with a fresh import or guessed matching.

The baseline is HEAD `025922176722`. Existing uncommitted application-parser changes define the
current comment semantics; the report fingerprints their exact code. The recovery does not change
those files. No schema, migration, generated-client or dependency change is needed.

Matching uses only the two accepted prefixes:

```text
external:rus-fishsoft:observation:v1:
external:rus-fishsoft:forum83:observation:v1:
```

The tool re-extracts all original cached topic pages through the frozen importers' HTML readers,
compares author/body/context against pinned technical posts, reruns the existing forum parsers,
and proves the entire candidate identity manifest unchanged. Forum83 uses its frozen catalog and
reviewed topic/staging artifacts for this proof. Forum69 uses the verified recovered-fish staging
bundle. Exact post ID + candidate ordinal regenerates the original importKey; content is never a
fallback identity. Repeated source text at different ordinals remains distinct and is counted.
The row must agree with frozen staging on contributor and every stored structured field. Duplicate
identities, missing matches, or field mismatches cannot produce a candidate.

For comment derivation, the tool feeds original physical game lines to the **current application
parser** with one snapshot of today's active catalog and anchors. Forum83's frozen source range
ended at its first sentence; recovery re-reads the remaining text on that same physical line,
bounded by the next frozen candidate. It never appends another physical line, invents inherited
game context, normalizes a comment, or reconstructs a source string from stored fields. Overlapping
ranges, multiple game cores and invalid parser input are held. The current parser copies the exact
suffix after the resolved Bait's period, trimming only its outer whitespace.

Every existing non-null comment, including an empty string, is preserved. A candidate requires a
valid non-empty comment and agreement between the current parser and stored fish, bait, location,
weight and method. Differences in optional hole/spot/condition/retrieve fields are recorded; only
the comment is proposed and the historical structure remains untouched. The local report's
`readyForWrite` checks the expected 69,403-row population and absence of matching conflicts. It
applies only to the generated candidate plan; held interpretation cases remain excluded.

Implemented write/checkpoint strategy:

1. Pin the reviewed `report.json` and `candidates.jsonl` SHA-256, parser/source fingerprints and
   plan row count. Read the plan in its deterministic report-ID order. Use a separate atomic local
   checkpoint containing the plan hash, next committed row index, and applied/preserved/conflict
   counters; never modify the frozen import artifacts or use an importer checkpoint.
2. Process at most 100 rows per short transaction, with bounded lock/statement/transaction timeouts
   (for example 2/5/10 seconds). Read and lock only those report IDs. Revalidate exact importKey,
   `rawSourceText IS NULL`. For still-null comments, verify the full row precondition hash in the
   same select/serialization order as dry-run. Handle non-null comments by the replay/preservation
   rule below before comparing a still-null baseline hash. Any changed/missing row is quarantined;
   never repair other fields.
3. Preserve every non-null `userNoteRaw`. A value already equal to the plan is treated as completed
   on replay. A different non-null value is preserved and reported. For a still-null row with an
   unchanged baseline, issue parameterized SQL with **only**
   `SET "userNoteRaw" = <planned comment>` and predicates on ID, exact importKey and null comment/raw
   source; check the affected row count. Never call Prisma `update`/`updateMany` here: `@updatedAt`
   would also change `updatedAt`. Raw SQL preserves that timestamp and every other stored field.
   The accepted fish-count update trigger has zero delta without fishId changes.
4. Commit the database transaction before atomically advancing the local checkpoint. A stop before
   commit rolls back the batch. A stop after commit but before checkpoint repeats that batch,
   safely recognizing already non-null values. A checkpoint must never advance before commit.
   Run only one writer per plan (a local exclusive lock); abort on a checkpoint/plan hash mismatch.
5. Stop gracefully between batches. At completion, compare the before/after population and a
   projection excluding only `userNoteRaw`, and verify each applied comment against the plan.
   Do not publish activity events, update catalog/count rows, or invoke online mutation services.

Focused verification: recovery unit tests plus the current application parser tests (36 tests),
API TypeScript check, lint on the three new TypeScript files, and formatting/diff checks. No broad
suite or acceptance pass is required for this dry-run task.

Completed dry-run results:

| Measure                                                                      |                                Count |
| ---------------------------------------------------------------------------- | -----------------------------------: |
| Historical forum reports / missing raw source                                |                      69,403 / 69,403 |
| Rediscovered source observations                                             |                               73,517 |
| Exact unique matches                                                         |                               69,403 |
| Ambiguous / missing matches / frozen-field mismatches / duplicate importKeys |                        0 / 0 / 0 / 0 |
| Null → comment candidates                                                    | 6,191 (forum69: 5,327; forum83: 864) |
| Existing comments preserved                                                  |                                  427 |
| Current-parser structured disagreements                                      |                                7,824 |
| Proposed comments with optional-field disagreements                          |                                3,779 |
| Comments held for current-parser core mismatches                             |                                1,375 |

Interpretation exclusions: 76 multiple-game-core ranges, 38 overlapping ranges, 10 invalid parser
source lines and 2 ranges without a game line. The original cache contains all 32,906 pinned posts.
Repeated identical candidate text occurs in 3,638 within-post groups (9,483 observations); distinct
post/ordinal keys disambiguate them. There are 4,114 source observations without current reports:
4,104 were excluded by frozen staging, while 10 frozen COMPLETE observations have no current row.
No missing row is recreated. The separately authorized writer accepts **these 6,191 candidates
only**, with all held cases excluded.

Representative recovered comments, preserving source spelling and punctuation:

- post `289884`: `Блесна большая, проводка средняя.Заброс 6.19 между рюкзаком и блокнотом. Опыта 1 лям без алкоголя.`
- post `369049`: `Ночь. Дно.`
- post `98331`: `яма 5.86 над блокнот дно`

For example, post `403130` historically stores `holeDepthCm = 623` and `spotPositionRaw = "ящик"`;
the current parser returns null for both. Its original comment is still proposed independently,
and neither stored field is changed. Every such disagreement is listed in `cases.jsonl`.

The write phase uses the separately named command:

```sh
pnpm forum:recover-comments:apply -- --check
pnpm forum:recover-comments:apply
```

The writer pins the exact candidate SHA-256
`dec6addb917a9d7e4aca4cb2bfc276d3e37e0df63f9ad18cf2aa4798edcf14b8`, report SHA-256
`0fbce6f96ad01be7edc07442627e7e6b48e95753f0ad0189c7bc0585754ad55c` and original DB snapshot
SHA-256 `8d7073e8b6a83d606ac6bf5cc9109234637920e28d1b58acd4243f425eaa931a`. Plan/output paths
cannot be overridden. It also verifies frozen source/code hashes and the held-case artifact.
Changed non-null comments cause an abort and are preserved; only an exact planned value with
unchanged historical fields permits replay.

The first write requires the complete current DB snapshot to match the dry-run hash. The writer
then saves that exact snapshot as `write/baseline.json` and creates `write/checkpoint.json` before
any DML. Kernel-managed `flock` enforces one writer and releases automatically after a crash. On
restart, the original snapshot remains hash-pinned, every out-of-plan row must remain identical,
and planned rows may differ only by an already approved comment. Plan/report/checkpoint drift is
checked again before each batch. SIGINT/SIGTERM stop between committed batches.

Verification compares all 69,403 rows, including 63,212 rows outside the plan, against the pinned
baseline and compares a separate complete projection excluding only `userNoteRaw`. Each run saves
an independent audit file in `write/runs/` and the latest result in `write/last-run.json`. Rerunning
the same command after completion verifies the entire result and performs no DML. The separate
792 rawSourceText recovery candidates are not included in this writer.

Focused PostgreSQL coverage checks 100-row comment-only updates, timestamps, fish-count/activity
preservation, whole-batch rollback on drift, non-null preservation, and restart after a committed
batch whose checkpoint save failed. It uses the repository separate-test-database guard and
removes only its own fixtures. Existing migration `20261001120000_add_fish_catch_counts` was
applied to the test database to bring its triggers to the accepted state; no development schema,
migration file or dependency change was needed.

Completed approved write:

- Planned / updated / skipped: **6,191 / 6,191 / 0**; no remaining candidates.
- **62 committed batches** (61 × 100, then 91); checkpoint `nextIndex = 6191` was advanced only
  after each committed transaction.
- All **427 existing comments preserved**; zero overwritten comments, zero changed held/out-of-plan
  rows, and zero changes to any non-`userNoteRaw` field across all 69,403 target rows.
- Independent read-only verification restored the planned comments to their original null values
  in memory and reproduced the exact original DB snapshot hash. No database rollback was performed.
- Completed rerun: **0 updates / 6,191 skips**; the database snapshot and checkpoint stayed identical.
  Both run audits remain under `write/runs/`; independent evidence is in
  `write/independent-verification.json`.
- Post-write snapshot SHA-256:
  `9d00bcb465a5cee5a4cdab088c1d37a65b7e0a7b4dbad4f6cdb170c364945acb`.
- **READY** for this completed comment recovery only. The 792 rawSourceText candidates remain
  untouched. No commit or broad suite was run.

Separate held-comment recovery (2026-10-03): the frozen 1,375 CORE_MISMATCH rows were independently
classified SAFE because exact source identity and the complete Bait/comment boundary do not depend
on accepting current structured parsing. Manifest SHA-256:
`08a88182c106ca7f237aa077c9e609922d739a59069af2c26961b494cf2c423a`.

The separate writer leaves the completed 6,191-row writer and its core-mismatch rejection unchanged:

```sh
# From apps/api; check has no DML, apply supports resume and completed verification.
node --import tsx src/forum-import/apply-held-comments.ts check 08a88182c106ca7f237aa077c9e609922d739a59069af2c26961b494cf2c423a
node --import tsx src/forum-import/apply-held-comments.ts apply 08a88182c106ca7f237aa077c9e609922d739a59069af2c26961b494cf2c423a
```

Only `userNoteRaw IS NULL` rows permit SQL updates; exact previously committed comments permit
zero-DML replay. Short transactions lock at most 100 exact IDs, check historical row/source hashes,
and preserve every other column, including `updatedAt`. Checkpoint advances only after COMMIT;
kernel `flock` excludes concurrent writers. Frozen metadata, source artifacts, code and baseline
hashes are checked before writing and on resume. No new parser interpretation or structured-field
correction is performed.

Audit artifacts are under the ignored `apps/api/.local/held-comment-analysis/write/`. Baseline
protects all 69,403 historical forum rows and the separate completed 792 reports with PostgreSQL
hashes of every non-comment column and exact original comments. The 7,180,258-row overall population,
Fish counters and activity are also checked; unrelated generated reports are not loaded into Node.
Completed write: **1,375 planned / 1,375 updated / 0 skipped**, in **14 batches** (13 × 100 + 75).
There were zero non-comment changes or changes to the completed 6,191/792 recoveries. Focused
PostgreSQL tests cover 100-row updates, full-batch drift aborts, non-null preservation and replay
after checkpoint persistence failure. No schema, migration or dependency change; no broad suite.
Completed rerun: **0 updated / 1,375 skipped** with the same manifest and checkpoint. Independent
read-only verification through a separate `pg` connection confirmed all 1,375 exact comments,
unchanged full-row guards for all 70,195 protected reports, unchanged Fish/activity and unchanged
completed-recovery artifacts. Evidence is in `write/independent-verification.json`.
