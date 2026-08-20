# API-specific instructions

These rules apply to `apps/api/**`. Inherit repository-wide rules from `/AGENTS.md`. Use
`docs/PROJECT_STATE.md` for accepted behavior and `docs/ARCHITECTURE.md` for navigation instead of
copying their inventories here.

## Architecture and HTTP boundary

- Keep the NestJS API a modular monolith. Extend the owning module rather than creating a service
  split, cache, Redis, Kafka, or other infrastructure unless the task explicitly requires it.
- Keep the browser contract REST under the global `/api/v1` prefix. Put cross-cutting HTTP setup in
  `src/app.setup.ts`.
- The backend owns authoritative request, security, and domain validation. Use DTOs and the existing
  validation pipe, then enforce authentication, authorization, ownership, ban state, catalog
  relations, and domain invariants in guards/services or transactions.
- Keep PostgreSQL access behind `PrismaModule`/`PrismaService`; domain services own transaction
  boundaries.
- Preserve NodeNext ESM conventions, including `.js` specifiers in relative TypeScript imports.

## Prisma and PostgreSQL

- Preserve the Prisma 7 arrangement: `prisma.config.ts` owns datasource/migration configuration,
  `@prisma/adapter-pg` is wired through `PrismaService`, and the ESM client is generated under
  `src/generated/prisma`. Never hand-edit generated client files.
- Every schema change requires a migration under `prisma/migrations`. Do not use `prisma db push` or
  automatic reset as the normal change path.
- Prefer Prisma APIs. When raw SQL is necessary, parameterize external values with tagged
  `$queryRaw`, `Prisma.sql`, and `Prisma.join`; never concatenate user input into SQL. Unsafe raw
  execution is acceptable only for fixed statements with no externally controlled data.
- Validate and calculate weights and depths as exact integers in grams and centimeters. Convert
  PostgreSQL aggregate `bigint` values only with safe-range checks.

## Responses and CatchReport history

- Build public and owner responses from explicit Prisma `select` allowlists and response mappers;
  never expose persistence records wholesale.
- Omit `rawSourceText` from public list/detail/statistics and owner list. Expose it only through
  owner detail, never add it to PATCH, and keep parser preview non-persistent.
- Derive `userId` from the authenticated actor, Base from Location, and `fishingMethod` from active
  Bait type. Do not accept derived ownership or classification fields from mutation payloads.
- Derive `fishingMethod` on create and only rederive it when `baitId` actually changes. Never
  recompute the stored method on reads or unchanged-Bait updates.
- Validate Fish availability through `Location.fishingBaseId` and `FishingBaseFish`; never recreate
  or query `LocationFish`.
- Treat saved reports as historical: do not add current catalog, membership, or author-ban filters
  to reads or statistics. On update, revalidate current catalog state only for references that
  actually change.

## Verification

- Keep API unit tests colocated as `src/**/*.spec.ts`; use `apps/api/test` for isolated PostgreSQL
  e2e, database-safety, and migration-semantic coverage.
- Behavior depending on PostgreSQL SQL, constraints, transactions, or migrations requires
  PostgreSQL-backed coverage with the existing separate-test-database safety guard.
- During implementation, run the closest affected tests and targeted lint/typecheck as useful.
  Run full repository acceptance once after the implementation is stable.
- Use current scripts from the root and API `package.json`; do not duplicate mutable command lists.
