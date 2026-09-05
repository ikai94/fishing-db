# Fishing Database Project

## Scope and canonical sources

This file owns permanent repository-wide engineering and domain rules.

- Use `docs/PROJECT_STATE.md` for the accepted functional/product state.
- Use `docs/ARCHITECTURE.md` for repository navigation and change-impact guidance.
- Treat accepted source code, Prisma schema, and committed migrations as implementation truth.
- Use `pnpm verify:state` as the authority for current Git HEAD, worktree, and runtime state. Report
  discrepancies instead of silently reconciling docs, code, or mechanics.
- Treat the unchanged HEAD it reports as the trusted code baseline. Inspect the affected delta; do
  not re-audit unrelated accepted phases.
- When touching `apps/api`, read and obey `apps/api/AGENTS.md`.
- When touching `apps/web`, read and obey `apps/web/AGENTS.md`.
- Cross-stack work may require both scoped files. Do not load both for an isolated task without need.
- Use the relevant workflow under `.codex/skills` for design, implementation, or final acceptance;
  procedural checklists belong there rather than in this file.

## Product and architecture boundary

- The product combines a public collaborative fishing database with a strictly private archive for
  each registered user.
- The game catalog is public and administrator-maintained. Normal users cannot modify it.
- Keep the TypeScript/pnpm monorepo split between the Next.js web app and NestJS REST API, with
  Prisma and PostgreSQL as the persistence layer.
- PostgreSQL is the runtime data source of truth. The API remains a modular monolith.
- Do not introduce microservices, Kafka, RabbitMQ, Kubernetes, GraphQL, Elasticsearch, Redis, or
  comparable infrastructure unless the task explicitly requires it.
- Work incrementally and implement only the requested or approved delta. Do not add future phases,
  rewrite unrelated code, or silently redesign approved mechanics.
- Inspect existing behavior before proposing a mechanic. Stop and ask when a genuine product or
  game-domain ambiguity would otherwise require invention.

## Catalog invariants

- `FishingBase` owns `Location` rows.
- Fish membership belongs to a Base through `FishingBaseFish`; never recreate `LocationFish` or
  infer per-Location membership. A Base fish is potentially available at all its Locations.
- Catalog activation and membership describe current availability. They must not rewrite the
  meaning of historical catches.
- Preserve public catalog/admin ownership boundaries and accepted active/inactive lifecycle rules.

## CatchReport invariants

- Every `CatchReport` belongs to exactly one `User` and records its Location, Fish, and Bait.
- Keep ownership (`userId`) separate from the immutable internal contributor identity used for
  distinct-angler statistics. Native reports derive one contributor identity per authenticated
  User. Imported reports may use a deterministic opaque key derived from a stable external member
  identity, never a display nickname; do not store external nickname or profile metadata on
  `CatchReport`.
- The nullable unique `importKey` identifies one stable external source observation/candidate for
  idempotent import. It is not a Fish/Location/depth/spot content fingerprint.
- A saved report is historical. Catalog deactivation, `FishingBaseFish` unlinking, or author ban
  must not by itself hide or reinterpret it in reads or statistics.
- Preserve stored historical classifications. In particular, do not derive a persisted fishing
  method from today's catalog during reads.
- Store fish weight as a positive integer number of grams, never floating-point kilograms.
- Store parsed hole depth as a positive integer number of centimeters when present, never
  floating-point meters. For example, `6,00 m` becomes `600` and `7,63 m` becomes `763`.

Keep these concepts separate; never collapse them into a generic `hint` field:

- `holeDepthCm` — parsed depth;
- `spotPositionRaw` — player-entered position or landmark;
- `fishingNote` — fishing condition or presentation;
- `userNoteRaw` — player comment;
- `rawSourceText` — original notebook/source text.

Preserve accepted raw inputs exactly: derived parsing or grouping must not overwrite
`rawSourceText`, `spotPositionRaw`, or `userNoteRaw`. A phrase such as `вполводы` is a fishing
condition, not a location landmark.

## Common-hole invariants

- Distinguish `reportsCount` from `uniqueUsersCount`; the latter counts immutable contributor
  identities, so repeated reports by one contributor are not independent confirmations even when
  imported reports share an ADMIN owner.
- Hole identity uses the accepted Location, exact centimeter depth, and conservatively normalized
  `spotPositionRaw` semantics.
- Never include fishing conditions such as `вполводы` in hole identity.
- Do not aggressively merge punctuation, `е/ё`, aliases, directions, or otherwise uncertain spots.

## Privacy, roles, and bans

- Maintain explicit public and owner response boundaries. Private archive data must never be
  exposed through another user's request.
- Never expose `contributorKey` or `importKey` through public or owner API projections.
- `rawSourceText` is owner-only and must never enter a public projection. Do not infer privacy from
  field names: preserve the accepted visibility of every other field from `PROJECT_STATE.md`.
- Initial roles remain `USER` and `ADMIN`; catalog administration is ADMIN-only.
- Only email domains ending in `.ru` are accepted, and passwords must never be stored in plaintext.
- Self-registration must remain unverified and sessionless until single-use email verification;
  unverified Users must not log in or pass authenticated guards. Password reset revokes all User
  sessions.
- Persist only auth-token hashes and authenticated encrypted outbox payloads, never raw auth
  tokens. Keep successful consumption separate from invalidation/superseding, and atomically
  invalidate the active token before issuing its replacement.
- Banned users may authenticate, read their archive, and preview parser output, but cannot create,
  update, or delete public reports. Banned ADMIN users cannot use ADMIN catalog routes.
- Do not invent an ADMIN user-management or ban endpoint unless a task explicitly adds one.

## Change and verification discipline

- Preserve unrelated user changes and inspect the current diff before editing.
- Do not commit unless the user explicitly requests it.
- Every Prisma schema change requires a checked-in migration. Never use a silent reset or
  `prisma db push` as the normal schema-change path.
- Never destroy or replace development data without explicit authorization.
- Add focused tests for important domain logic and for regressions introduced by the change.
- Use repository scripts and verification proportional to the affected area. Reserve one full
  repository acceptance pass for a stable implementation.
- Report the delta, verification evidence, schema/migration/dependency impact, blockers, and final
  worktree state; do not restate the whole accepted architecture.
