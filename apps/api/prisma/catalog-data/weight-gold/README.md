# MANUAL GOLD for weight inference

`2026-10-05.v1.json` contains the nine user-confirmed Fish/Base maxima. This is benchmark
truth, separate from the correction manifest. It neither authorizes corrections nor changes
application flags. Min and note are nullable; all seeded minima and notes are null.

Run commands from the repository root. Validation uses exact IDs and names from a frozen
catalog snapshot's `pairs[]`, including membership. It does not query or write the DB.
Existence is verified as of that snapshot; supply a newer read-only capture when needed.

Validate the seed:

```sh
node --import ./apps/api/node_modules/tsx/dist/loader.mjs \
  apps/api/src/prisma/manual-weight-gold-cli.ts validate \
  --catalog apps/api/.local/klevalka-normal-max-2026-10-05/catalog-rr3-manual.input.json
```

To add a confirmation, create an entry JSON file, for example `/tmp/gold-entry.json`:

```json
{
  "fishId": "<existing Fish UUID>",
  "fishingBaseId": "<existing Base UUID>",
  "confirmedMaxWeightGrams": 12345,
  "confirmedMinWeightGrams": null,
  "note": null
}
```

Append to a **new** version. Names are filled from the exact catalog membership and source is
`MANUAL`. Optional min/note default to null. Positive safe integer grams, min <= max, exact
identity, and pair uniqueness are checked before writing. Duplicate pairs are rejected, even
if the new weight differs. Existing output files cannot be overwritten.

```sh
node --import ./apps/api/node_modules/tsx/dist/loader.mjs \
  apps/api/src/prisma/manual-weight-gold-cli.ts append \
  --gold apps/api/prisma/catalog-data/weight-gold/2026-10-05.v1.json \
  --catalog apps/api/.local/klevalka-normal-max-2026-10-05/catalog-rr3-manual.input.json \
  --entry /tmp/gold-entry.json \
  --output apps/api/prisma/catalog-data/weight-gold/2026-10-05.v2.json
```

Benchmark **already generated blind predictions**; this command only scores them. It does not
invoke inference or give GOLD values to any predictor. The current fusion artifact has 859
predicted/abstained pair rows, including all nine seeds. Added pairs absent from that artifact
count as abstentions. Generate a separate fresh blind prediction artifact to evaluate additional
pairs; do not pass this dataset to inference or use it to learn grids/peers.

```sh
node --import ./apps/api/node_modules/tsx/dist/loader.mjs \
  apps/api/src/prisma/manual-weight-gold-cli.ts benchmark \
  --gold apps/api/prisma/catalog-data/weight-gold/2026-10-05.v1.json \
  --catalog apps/api/.local/klevalka-normal-max-2026-10-05/catalog-rr3-manual.input.json \
  --predictions apps/api/.local/klevalka-fusion-2026-10-05/benchmark-report.json
```

Output reports exact accuracy including abstentions, precision among non-abstained predictions,
abstentions, missing predictions, range hits, per-pair evidence and input SHA-256 hashes.
Minimum inference is not evaluated. A standalone prediction artifact uses `rows[]` with
`fishId`, `fishingBaseId`, `predictedMaxWeightGrams` (positive integer or null), and
`rangeGrams` (`[lower, upper]` integer grams or null). Fusion `rows[]`/`diagnosticRows[]`
with `fusion.candidate` and `fusion.rangeGrams` are also supported. Unknown truth/evidence fields
are not used as predictions.

For subsequent versions, always pass `--gold <version.json>` explicitly; the default remains
v1, so an existing benchmark never silently switches its truth dataset.

## Batch CSV

Copy `batch.sample.csv` to `/tmp/manual-gold.csv` and replace its rows with additional manually
confirmed values. Its two sample pairs are already in v1, so validating the unchanged sample
intentionally reports 0 accepted / 2 rejected duplicates. These examples are not new confirmations.

Exact header and format:

```csv
fishName,baseName,confirmedMaxWeightGrams,confirmedMinWeightGrams,note
Сейвал,Лофотенские острова,51700000,,
Гребнистый крокодил,Большой Барьерный Риф,2530000,,
```

Names must match the catalog byte-for-byte: no trimming, case folding, aliases or е/ё mapping.
Ambiguous names resolving to multiple stable pairs are rejected. Max is required positive integer
grams; min may be empty, otherwise positive integer grams <= max. Empty note becomes null.
CSV supports UTF-8 BOM, CRLF, quoted commas, doubled quotes and multiline quoted notes.
Errors identify the physical starting line of a record; the header is line 1. Duplicate pairs
already in GOLD are rejected. Both occurrences of a within-batch duplicate are rejected.

Run from `apps/api`. Validate without writing:

```sh
node --import tsx src/prisma/manual-weight-gold-cli.ts validate-batch \
  --gold prisma/catalog-data/weight-gold/2026-10-05.v1.json \
  --catalog .local/klevalka-normal-max-2026-10-05/catalog-rr3-manual.input.json \
  --csv /tmp/manual-gold.csv
```

Create the next version only when **every row** is valid:

```sh
node --import tsx src/prisma/manual-weight-gold-cli.ts append-batch \
  --gold prisma/catalog-data/weight-gold/2026-10-05.v1.json \
  --catalog .local/klevalka-normal-max-2026-10-05/catalog-rr3-manual.input.json \
  --csv /tmp/manual-gold.csv \
  --output prisma/catalog-data/weight-gold/2026-10-05.v2.json
```

Both commands report `accepted`, `rejected`, `errors[{row,message}]` and `written`. Rejected
validation exits nonzero. Accepted means the row passed validation; no accepted rows are written
if any row fails. Existing version files are never overwritten. No DB access or inference is
performed, and the batch remains benchmark-only GOLD.

## User-confirmed expansion v2

`2026-10-05.v2.json` preserves all nine v1 entries and adds 143 uniquely resolved confirmations
from the user-supplied 149-row batch: **152 unique Fish/Base pairs**. Every min remains null,
source remains MANUAL, and no correction manifest/application flag was changed.

The original rows are retained in `2026-10-05.v2.manual-input.csv`. Exact IDs/names, allowed
normalization decisions, six rejected rows and suggested catalog candidates are preserved in
`2026-10-05.v2.resolution.json`. This one-time resolution allowed only case, whitespace/NBSP
and ё/е changes; misspellings and different names were not accepted. Suggestions are review
candidates, not approved mappings. The strict generic CSV workflow above is unchanged; provide
canonical names to that validator.

Blind predictions were generated for all 3,603 pairs before reading v2 GOLD, using the unchanged
Klevalka v3 wall and fusion modules. Predictions and ranges for all 859 previously analyzed pairs
match their frozen outputs. From `apps/api`, reproduce scoring:

```sh
node --import tsx src/prisma/manual-weight-gold-cli.ts benchmark \
  --gold prisma/catalog-data/weight-gold/2026-10-05.v2.json \
  --catalog .local/klevalka-normal-max-2026-10-05/catalog-rr3-manual.input.json \
  --predictions .local/manual-gold-expansion-2026-10-05/predictions.json
```

The ignored run artifacts include `predict.py` (no GOLD reads), `predictions.json`,
`benchmark.json` and `benchmark-summary.json`. Exact accuracy is 80/152 (52.63%), precision
80/118 (67.80%), abstentions 34, and range hits 84/152 (55.26%). All original nine remain exact.
