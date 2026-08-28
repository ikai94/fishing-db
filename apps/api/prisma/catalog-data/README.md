# Catalog data provenance

The canonical files in this directory are deterministic, offline inputs for
`pnpm db:seed:catalog`.

## Authoritative inputs

- Fishing catalog scan date: `2026-08-13T08:46:38.858Z`
- Fishing catalog scan SHA-256:
  `1ec2fc36b042bececc4dec31bdd502b7862d28d9b39c15db1ebea4999fd5e307`
- Approved Base↔Fish workbook: `Klevalka-2026.xlsx`
- Approved Base↔Fish workbook SHA-256:
  `58c13109fe71e3c041f40d6e721b6c6cd0d0bbade43fe7dc1b0063dd8ba7eac3`
- Canonical Base↔Fish target SHA-256:
  `086f34ad8e6a4c283483c02ad80fe4e203c3d1bff8a37f9324809c035c8e48fc`
- Bait input SHA-256:
  `cbdf553bea27c9cf40aff6e4d6faeac3e30c4b8722db089ebfddff697329d033`

The canonical snapshot contains 77 FishingBase records, 853 Locations, 1,255
global Fish identities, 3,230 FishingBaseFish relationships, 68 BAIT entries,
181 LURE entries, and 249 Bait entries in total. The eight ScreenAnchor values
remain defined in the TypeScript seed loader.

## Transformation policy

`fishing-catalog.json` retains exact Base/Fish display identities and Location
numbers/names from the previous catalog snapshot. Its legacy nested Fish arrays
remain only as the 1,255-entry global Fish identity inventory; they are not a
Base↔Fish membership source. External IDs and URLs, scrape metadata, the duplicate
flat relationship list, and audit warnings/errors were intentionally discarded.
Source `(спиннинг)` markers were audited as subsets of ordinary Base-to-Fish
membership and discarded; they are not Fish identity or fishing-method data.

`fishing-base-fish.json` is the exclusive `bases[].fish` seed input. It contains
only existing canonical Base and Fish display names resolved from the approved
workbook, plus the workbook hash and sheet/column provenance. The raw workbook
stays under `apps/api/.local/catalog` and is excluded from Git. Catalog
normalization is used only for validation and identity; display names in the
canonical JSON remain authoritative.

## Safe updates

To update this snapshot, first audit a new source artifact offline: verify its
hash, schema version, policy flags, source IDs and URLs, counts, warnings/errors,
normalized identities, membership references, flat/nested relationship parity,
and spinning-marker subsets. Produce the minimal canonical JSON only after all
checks pass. Update the hashes and authoritative count assertions in the same
reviewed change. Bait names and types must come from an explicit authoritative
input and must never be inferred from naming patterns.

Neither the seed nor normal application startup contacts the source website.

## Fish catalog reconciliation audit

The following reviewed manifests must be tracked in Git. The Fish and BaseFish manifests are
apply-ready inputs but are not read by the seed or application runtime:

- `forum69-fish.json` — reviewed forum69 topic identities and canonical primary names;
- `fish-reconciliation.json` — current Fish ID preservation/rename/create/repoint plan;
- `fishing-base-fish-reconciliation.json` — workbook cell-to-topic membership projection;
- `list-fish-metadata.json` — targeted supplemental page/image metadata, without image binaries.

The first three are required inputs for a reproducible future Fish/BaseFish apply. The list-fish
manifest is not an apply input, but remains tracked because its reviewed supplemental identity
mapping cannot be reconstructed from runtime state.

Their JSON/CSV evidence is under `audits/fish-catalog`. Regenerate the baseline evidence from the
accepted local forum cache, catalog snapshot, and approved workbook with
`pnpm db:audit:fish-catalog`; verify it with `pnpm db:audit:fish-catalog:check`. These commands do not
replace an existing apply-ready manifest, apply database changes, re-import forum observations, or
download images. Excel raw names remain reconciliation provenance only and are never canonical Fish
display names.

Generated audit evidence under `audits/fish-catalog` is intentionally ignored by Git. The
separately reviewed human decisions are generated there under `manual-review`. Finalize the four
tracked manifests plus live read-only reference and recovery evidence with
`pnpm db:audit:fish-catalog:manual-review`; verify deterministic output with
`pnpm db:audit:fish-catalog:manual-review:check`. Terminal `DO_NOT_MAP`, `EXCLUDE_NON_FISH`, and
`EXCLUDE_NOISE` rows remain source evidence with no Fish or FishingBaseFish target.

Preview the apply-ready Fish/BaseFish/CatchReport poststate without writes with:

```bash
pnpm db:reconcile:fish-catalog:dry-run
```

After that reconciliation is accepted and applied, recover the frozen full forum69 staging only
from its existing local cache and the tracked reconciliation inputs with:

```bash
pnpm forum:recover-fish-catalog -- --all --dry-run
pnpm forum:recover-fish-catalog -- --all
```

Recovery requires strict byte-derived candidate identity-manifest equality, never rebases or
appends candidate identities, and never crawls. Exact current catalog matching is attempted first;
only a previously resolved Fish may fall back through its frozen Fish UUID and the accepted
reconciliation lineage. Recovered staging is written separately under
`outputs/all-parent-69/recovery/fish-catalog/staging`; the original staging remains unchanged.
Before any later import, select that directory explicitly and keep the importer in dry-run mode:

```bash
pnpm forum:import-complete -- --all --recovered-fish-catalog --dry-run
```

## Reconciliation

Audit the live pre-state with:

```bash
pnpm db:reconcile:fishing-base-fish --dry-run
```

The apply mode is deliberately separate and requires the exact fingerprint from
the reviewed dry-run:

```bash
pnpm db:reconcile:fishing-base-fish --apply --expected-fingerprint=<SHA-256>
```

Apply runs the approved membership additions, invalid CatchReport deletions,
obsolete membership removals, and final assertions in one transaction.
