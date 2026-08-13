# Phase 5 maintenance rollout

Phase 5 deliberately uses a compatibility migration followed by a separately audited steady-state
constraint. A database known to contain no Phase 4 `CatchReport` rows can use the normal command:

```powershell
pnpm db:migrate:deploy
```

For an existing database whose historical rows have not yet been audited, use this maintenance
sequence. Stop application writes first and take the normal database backup.

## 1. Apply only the two compatibility migrations

Run each SQL file and then record that exact migration through Prisma. Do not run the final
invariant migration yet.

```powershell
pnpm --filter @fishing-db/api exec prisma db execute --file prisma/migrations/20260809144907_replace_location_fish_with_fishing_base_fish/migration.sql
pnpm --filter @fishing-db/api exec prisma migrate resolve --applied 20260809144907_replace_location_fish_with_fishing_base_fish

pnpm --filter @fishing-db/api exec prisma db execute --file prisma/migrations/20260809145137_add_catch_report_v2_compatibility/migration.sql
pnpm --filter @fishing-db/api exec prisma migrate resolve --applied 20260809145137_add_catch_report_v2_compatibility
```

These commands are a one-time path from the applied Phase 4 migration. Do not execute a migration
SQL file that Prisma already reports as applied. Both SQL files are transactional and contain their
own preflight/postcondition checks.

## 2. Run the read-only legacy audit

```powershell
pnpm db:audit:catch-reports
```

The command prints JSON and exits nonzero when any historical row lacks its method-specific v2
observations. It never updates or deletes a report.

- If `incompatibleCount` is nonzero, stop. Keep the compatibility schema and the Phase 5
  application: those rows remain readable and unrelated edits remain possible. Resolve the listed
  rows explicitly; never invent observations.
- If `incompatibleCount` is zero, continue.

## 3. Apply the final invariant

```powershell
pnpm db:migrate:deploy
pnpm --filter @fishing-db/api exec prisma migrate status
```

The final migration repeats the audit condition inside its transaction before adding and validating
`CatchReport_method_observations_check`. It therefore fails closed if rows changed after the
read-only audit.

Do not start the new application version until the intended migration stage is complete. This is a
coordinated maintenance rollout; there is no dual-write or rolling-version compatibility layer.
