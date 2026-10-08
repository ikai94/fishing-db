# Read-only FishingBaseFish weight reconciliation v1

The analyzer reads **every** FishingBaseFish, including inactive catalog entities. PostgreSQL
catalog, admin wrong-max metadata and official history are captured together under RepeatableRead
and `SET TRANSACTION READ ONLY`. It never reads CatchReport. There is no apply mode and no schema,
dependency, txt or catalog change.

Run from the repository root:

```sh
cd apps/api
node --import tsx src/prisma/reconcile-all-weights.ts
```

Outputs are separate ignored artifacts under `.local/weight-reconciliation-v1/`: `report.input.json`
(frozen evidence), `report.json` (full evidence and all pair assessments), and `report.md` (ranked
table). Evidence is also archived immutably at `evidence/<input-sha256>.json`; later fresh captures
retain earlier evidence and the first `report.input.json`. The latest report names its exact input.
Reproduce the first frozen analysis without any database connection:

```sh
cd apps/api
node --import tsx src/prisma/reconcile-all-weights.ts \
  --input .local/weight-reconciliation-v1/report.input.json
```

An optional locally available authenticated Klevalka release can be read with
`--klevalka-snapshots /absolute/release --review-manifest /absolute/review.json`. Checksums,
accepted source failures, parser row counts, exact Fish/Base/Location identity and explicit reviewed
Fish mappings are required. Unresolved mappings remain REVIEW. Generated txt weights are never
used as independent source evidence. The current workspace has the accepted XLSX workbook, but
no authenticated HTML release was located. A public check of
[Klevalka's Fish page](https://klevalka.org/fish/detail/18) exposed global comments and closed
Base/Location observation tables; those comments are not weight evidence for a pair.

XLSX cells and their accepted import identities are reread and checksummed. Workbook, current
catalog peers and grids share provenance: their agreement is not multiple independent sources.
Nine user-confirmed corrections and existing FishWrongMaxIssue metadata override inference.
FishWrongMaxIssue is Fish-scoped; an exact Base note or a single membership is required to make
a pair correction. The historical approved patch is an additional benchmark only.

Grids are discovered from integer greatest common divisors within each weight magnitude. No game
multiplier is preset. A step needs at least 20 pairs, 75% pair support and five distinct supporting
values. All supported candidate steps remain in JSON; the largest step is a provisional model
choice, not a universal game rule. Weekly refresh copies do not create independent evidence.
Repeated clusters allow 2 g absolute resolution or 1% width. Empirical saturation comes from
at least 20 three-week controls. Above-max ratio regimes reuse the existing data-driven official
ratio analyzer; matching regimes prohibit statistical normal-cap proposals. Absence of a matching
regime does not prove that a cluster is normal.

Before any manual override, exact inference is benchmarked against the nine review corrections,
40 current admin labels and the historical approved patch. All benchmark Fish are excluded from
training grids, saturation controls and mutant regimes. Historical/review pair maxima are restored
to their old values; peer catalog bounds are allowed as supporting evidence, so the benchmark is
conditional on the current same-Fish catalog being informative, not proof of independent accuracy.
Scoped admin notes are evaluated at that Base; other admin labels are evaluated as global maxima
and abstain if any membership has no prediction. Abstentions count as exact-match failures; report
coverage and precision among predictions separately. There is no benchmark for min because no
manually confirmed min labels were found. The statistical SAFE gate requires 95% exact accuracy and
80% coverage for all three benchmark groups, plus 95% accuracy on small admin labels. It failed on
the captured data; SAFE recommendations therefore have manual authority only.

Small weight means current or proposed max <=5,000 g. Every nonzero gram discrepancy is retained
with relative difference; percentages alone cannot suppress a one-gram anomaly. Lower official
weights can flag a suspicious minimum but cannot identify the true min. Every pair has a separate
min assessment, workbook comparison, discovered min grid and same-Fish peer values. Retaining a
min never independently confirms it. `CONFIRMED` refers to an explicitly confirmed **max**;
`minAssessment.independentlyConfirmed` remains false. Grid/peer differences alone do not declare
a minimum wrong. Reports rank small anomalies first, then SAFE corrections, with stable ID ties.

The versioned JSON decision manifest lives at
`apps/api/prisma/catalog-data/weight-corrections/2026-10-04.v1.json`. It contains fixed identities,
old/proposed bounds, statuses, confidence, per-bound actions, source evidence, notes and three
initially false application flags. Review entries are explicit HOLD decisions, not commands to
apply hypotheses. Missing proposals mean no exact decision. Min is retained unconfirmed unless a
future review establishes its exact replacement. Original txt mapping is still pending; stable
Fish/Base IDs and names must be resolved conservatively when editing those sources later.

To create a **new** decision version after reviewing a new report, add
`--create-manifest prisma/catalog-data/weight-corrections/<new-version>.json`. File creation is
exclusive: an existing manifest cannot be overwritten. Ordinary analysis never writes a manifest
or changes application flags. Archive the referenced frozen input beside operational evidence;
the committed manifest also embeds relevant admin/manual values, official observations and peer
bounds so decisions survive loss of temporary reports. Before future txt/catalog/catch work,
revalidate IDs and old bounds, honor HOLD/CONFLICT, preserve each application flag independently,
and use the reviewed manifest rather than recomputing corrections from report rankings.

Focused verification:

```sh
cd apps/api
node --import tsx --test src/prisma/weight-reconciliation.spec.ts
node_modules/.bin/tsc --noEmit
node_modules/.bin/eslint src/prisma/weight-reconciliation.ts \
  src/prisma/reconcile-all-weights.ts src/prisma/weight-reconciliation.spec.ts
```
