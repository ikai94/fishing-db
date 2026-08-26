# Fishing DB — Accepted Project State

## Accepted functional state

- Last accepted application milestone: `57b435e6579c00d7f852de991c1fc5fb767864de`
  (`add common hole statistics`).
- This historical milestone is NOT the current repository HEAD.
- Snapshot date: 2026-08-20 (Europe/Moscow).

This file records the accepted functional/product state; Git history records commit history.

Use `pnpm verify:state` for the current Git baseline.

## Runtime

Exact accepted declarations and dependency pins:

| Runtime/library     | Version     | Source                  |
| ------------------- | ----------- | ----------------------- |
| Node.js             | `24.19.0`   | `.node-version`         |
| pnpm                | `11.20.0`   | root `packageManager`   |
| PostgreSQL          | `17-alpine` | `compose.yaml`          |
| Next.js             | `16.2.12`   | `apps/web/package.json` |
| React / React DOM   | `19.2.8`    | `apps/web/package.json` |
| NestJS              | `11.1.28`   | `apps/api/package.json` |
| Prisma CLI / Client | `7.9.1`     | `apps/api/package.json` |

Root engines allow Node `>=24.0.0 <25` and pnpm `>=11.0.0 <12`.

## Repository layout

- `apps/web` — Next.js App Router frontend and Vitest tests.
- `apps/web/src/app` — route pages and route-local components.
- `apps/web/src/lib` — REST clients, response decoders, form helpers, and hooks.
- `apps/api` — NestJS modular monolith and Node test runner suites.
- `apps/api/src` — auth, catalog, CatchReport, health, security, and Prisma modules.
- `apps/api/prisma/schema.prisma` — current PostgreSQL domain schema.
- `apps/api/prisma/migrations` — eight accepted migrations, from auth through relaxed optional
  CatchReport observations.
- `apps/api/test` — PostgreSQL e2e, database-safety, and migration-semantic tests.
- `apps/api/prisma/catalog-data` — deterministic offline catalog inputs and provenance.
- `docs/phase5-rollout.md` — CatchReport v2 migration and audit procedure.
- `docs/ARCHITECTURE.md` — compact code-navigation map.
- `AGENTS.md` — permanent project and workflow rules.

The workspace currently includes only `apps/*`; there is no accepted `packages/shared` package.

## Accepted domain model

- `FishingBase` owns many `Location` rows.
- Fish membership belongs to a Base through `FishingBaseFish` (`FishingBase ↔ Fish`).
- There is no `LocationFish` relation; a Base fish is potentially available at all its Locations.
- `Bait` has historical input type `BAIT` or `LURE`; catalog entities use active/inactive lifecycle.
- `ScreenAnchor` is parser/catalog assistance. It is not referenced by `CatchReport`.
- `CatchReport` belongs to one `User` and stores `locationId`, `fishId`, and `baitId` directly.
- `CatchReport.userId` remains local ownership/authorship. Its immutable internal `contributorKey`
  is used only for distinct-angler aggregation: native reports derive `local-user:<userId>`, while
  imported reports may use a deterministic opaque key derived from a stable external member
  identity, never a display nickname. No external nickname or profile metadata is stored.
- The immutable nullable unique `importKey` identifies a stable external source
  observation/candidate for idempotency; it is not an observation-content fingerprint. Both
  internal keys are excluded from public and owner APIs.
- A valid CatchReport requires Fish, positive `weightGrams`, Location and its derived Base,
  Bait/Lure, and current `FishingBaseFish` membership at write/import validation time.
- Parsed hole depth is a positive integer in `holeDepthCm` when present. `holeDepthCm`,
  `spotPositionRaw`, `fishingNote`, `spinningSize`, `spinningSpeed`, and `userNoteRaw` are optional
  observations.
- `fishingMethod` is stored as historical `BAIT_FISHING` or `SPINNING`, derived from Bait type
  on create and only rederived when the report's Bait reference actually changes.
- Bait fishing cannot carry spinning size or speed. Spinning may omit size, speed, and depth.
- `spotPositionRaw` preserves player position text conservatively. `fishingNote` stores a
  presentation/condition enum and is not position identity; `userNoteRaw` is a separate comment.
- `rawSourceText` preserves raw notebook/source text supplied at creation. It is owner-only, omitted
  from public list/detail and owner list, and cannot be patched.
- `userNoteRaw` and `spotPositionRaw` are part of the current public CatchReport projection.
- Common-hole grouping uses exact `locationId`, `holeDepthCm`, and conservatively normalized
  `spotPositionRaw`; it reports both `reportsCount` and contributor-distinct
  `uniqueUsersCount`.
- Common-hole output excludes author identity, `fishingNote`, `userNoteRaw`, and `rawSourceText`.
- Roles are `USER` and `ADMIN`. ADMIN catalog access is enforced by backend guards.
- Banned users may authenticate, read their archive, and preview parser output, but cannot create,
  update, or delete public reports. Banned ADMIN users cannot use ADMIN catalog routes.
- There is no accepted ADMIN user-management or ban HTTP endpoint yet.

## Accepted product capabilities

- Docker Compose PostgreSQL development/test infrastructure and health endpoint.
- Email/password/nickname authentication, PostgreSQL sessions, `.ru` email rule, HttpOnly cookie,
  origin protection, `USER`/`ADMIN` roles, and ban guards.
- Public active-only catalog browsing and guarded ADMIN catalog maintenance.
- Base-to-Fish membership without per-Location fish duplication.
- Public CatchReport feed/detail, owner archive/detail, create/edit/delete, and cursor pagination.
- Server-side CatchReport v2 validation with historical fishing method and distinct observation
  fields.
- Authenticated notebook-line parser with editable preview, warnings, and blocking issues.
- Deterministic, additive, idempotent full-catalog seed, guarded Base↔Fish reconciliation, and
  read-only CatchReport audit commands.
- Public Base/Location/Fish/Bait navigation, Fish alphabet/search, and searchable Base fish lists.
- Fish Explorer with URL-backed Base selection and a dense, paginated CatchReport table.
- Common-hole statistics with multi-contributor confirmations separated from repeated
  observations by one contributor, including ADMIN-owned external observations.

## Public routes

Important frontend routes:

- `/` — health/navigation; `/login`, `/register`, `/account` — authentication and account.
- `/bases`, `/bases/:id`, `/locations/:id` — public Base and Location catalog.
- `/fish`, `/fish/:id`, `/baits` — Fish search/explorer and bait catalog.
- `/catches`, `/catches/:id` — public report feed and detail.
- `/catches/new`, `/catches/:id/edit`, `/my/catches` — authenticated entry and archive.
- `/admin/catalog/**` — guarded Base, Location, Fish, Bait, ScreenAnchor, and membership UI.

Important REST families, all below `/api/v1`:

- `/health` — application/database health.
- `/auth` — register, login, logout, and current session.
- `/catalog` — public Bases, Locations, Fish, Baits, and ScreenAnchors.
- `/admin/catalog` — ADMIN catalog reads/mutations and Base–Fish membership.
- `/catch-reports` — public feed/detail/statistics, parser preview, and guarded mutations.
- `/me/catch-reports` — authenticated owner list/detail.

## Important accepted decisions

- Fish membership is Base-scoped, not Location-scoped. Do not recreate `LocationFish`.
- Existing reports are historical records. Catalog deactivation, Base–Fish unlinking, or author ban
  does not hide them from public reads or statistics.
- Common-hole, Bait, and Fishing Conditions statistics count reports normally and use immutable
  contributor identity for `uniqueUsersCount`; multiple imported contributors remain independent
  even when all reports are owned and displayed as authored by the local ADMIN.
- Persisted `fishingMethod` is not rederived during reads or unchanged-Bait updates.
- Position normalization is deliberately conservative: NFKC, trim, whitespace collapse, and
  lowercase. It does not merge punctuation, `е/ё`, aliases, or directional meaning.
- `ScreenAnchor` may help recognize input but is neither CatchReport identity nor a foreign key.
- There is no current `Spot` entity; do not assume one when changing report or statistics code.
- On Fish detail, no Base selection parameters means all active memberships; explicit empty scope
  means none. Stale IDs are ignored and selection remains URL-addressable.
- Public projections include historical inactive names while links/UI activation depend on current
  catalog state. Owner-only `rawSourceText` must never enter a public projection.

## Verification baseline

No committed acceptance transcript or trustworthy pass counts exist. Full acceptance is expressed
by these commands; do not infer green tests from this document or from matching hashes:

```text
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm test:e2e
pnpm build
pnpm check
pnpm --filter @fishing-db/api exec prisma validate
pnpm db:generate
git diff --check
```

`pnpm check` runs lint, typecheck, unit/component tests, and build; it does not include formatting
or PostgreSQL e2e. E2e uses the isolated test PostgreSQL service, which defaults to host port 5433.

## Current known scale

The committed canonical offline seed asserts:

- 77 FishingBases and 853 Locations;
- 1,255 global Fish identities and 3,230 canonical FishingBaseFish memberships;
- 249 Baits: 68 `BAIT` and 181 `LURE`;
- 8 ScreenAnchors.

These are canonical seed counts, not authoritative totals for a development database, which may
also contain preserved tutorial or custom rows.

## Future-task protocol

Future Codex tasks should:

1. read `AGENTS.md`;
2. read `docs/PROJECT_STATE.md`;
3. verify the current HEAD and worktree with `pnpm verify:state`;
4. inspect only modules affected by the task;
5. treat the accepted functional state as trusted without re-auditing unrelated phases;
6. report discrepancies instead of re-auditing accepted phases.

Token-efficient workflow:

- **DESIGN:** verify the baseline, inspect affected modules only, and skip the full suite.
- **IMPLEMENTATION:** implement the delta and run focused affected tests.
- **REVIEW FIX:** run only tests affected by the fix.
- **FINAL ACCEPTANCE:** run the full repository acceptance once.
- **COMMIT:** if code did not change after acceptance, do not rerun the full suite unnecessarily.

Future reports should describe the delta instead of restating the entire architecture.
