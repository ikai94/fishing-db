# Catalog data provenance

The canonical files in this directory are deterministic, offline inputs for
`pnpm db:seed:catalog`.

## Authoritative inputs

- Fishing catalog scan date: `2026-08-13T08:46:38.858Z`
- Fishing catalog scan SHA-256:
  `1ec2fc36b042bececc4dec31bdd502b7862d28d9b39c15db1ebea4999fd5e307`
- Bait input SHA-256:
  `cbdf553bea27c9cf40aff6e4d6faeac3e30c4b8722db089ebfddff697329d033`

The canonical snapshot contains 77 FishingBase records, 853 Locations, 1,255
global Fish identities, 5,369 FishingBaseFish relationships, 68 BAIT entries,
181 LURE entries, and 249 Bait entries in total. The eight ScreenAnchor values
remain defined in the TypeScript seed loader.

## Transformation policy

`fishing-catalog.json` retains only exact display names, Location numbers, and
Base-to-Fish membership. External IDs and URLs, scrape metadata, the duplicate
flat relationship list, and audit warnings/errors were intentionally discarded.
Source `(спиннинг)` markers were audited as subsets of ordinary Base-to-Fish
membership and discarded; they are not Fish identity or fishing-method data.

Global Fish are derived deterministically from the Base membership lists at
load time. Catalog normalization is used only for validation and identity;
display names in the JSON remain authoritative.

## Safe updates

To update this snapshot, first audit a new source artifact offline: verify its
hash, schema version, policy flags, source IDs and URLs, counts, warnings/errors,
normalized identities, membership references, flat/nested relationship parity,
and spinning-marker subsets. Produce the minimal canonical JSON only after all
checks pass. Update the hashes and authoritative count assertions in the same
reviewed change. Bait names and types must come from an explicit authoritative
input and must never be inferred from naming patterns.

Neither the seed nor normal application startup contacts the source website.
