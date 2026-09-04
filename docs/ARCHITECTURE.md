# Fishing DB — Architecture Map

## Request flow

```text
Browser
  → Next.js (`apps/web`)
  → REST `/api/v1`
  → NestJS (`apps/api`)
  → Prisma
  → PostgreSQL 17
```

- Next.js owns routes, interactive state, forms, strict response decoding, and presentation.
- The web app calls the API directly through `apps/web/src/lib/api-client.ts`; browser auth uses
  the HttpOnly session cookie and credentialed requests.
- NestJS owns authentication/authorization, validation, domain rules, public/private projections,
  parsing, and REST orchestration. `apps/api/src/app.setup.ts` installs the `/api/v1` prefix.
- Prisma provides typed persistence access and transaction support; domain services define
  transaction boundaries. PostgreSQL is the source of truth, accessed through
  `PrismaModule`/`PrismaService`.

## Backend module map

| Domain           | Path                                                    | Responsibility                                          |
| ---------------- | ------------------------------------------------------- | ------------------------------------------------------- |
| Composition      | `apps/api/src/app.module.ts`                            | Wires modules and the global origin guard               |
| HTTP setup       | `apps/api/src/app.setup.ts`                             | Prefix, cookies, validation, CORS, shutdown             |
| Activity         | `apps/api/src/activity`                                 | Append-only writes, public projection, cursor feed      |
| Auth             | `apps/api/src/auth`                                     | Register/login/logout, sessions, roles, ban guards      |
| Catalog          | `apps/api/src/catalog`                                  | Public queries and guarded ADMIN catalog changes        |
| CatchReports     | `apps/api/src/catch-reports`                            | Feed/detail/archive, mutations, projections, pagination |
| Parser           | `apps/api/src/catch-reports/parser`                     | Notebook text to non-persistent editable Draft          |
| Hole statistics  | `apps/api/src/catch-reports/hole-statistics.service.ts` | Conservative grouping and counts                        |
| Database         | `apps/api/src/prisma`                                   | Prisma lifecycle, adapter, seeds, and audit command     |
| Schema           | `apps/api/prisma/schema.prisma`                         | PostgreSQL models, relations, enums, indexes            |
| Health           | `apps/api/src/health`                                   | Application/database health response                    |
| Request security | `apps/api/src/security/origin.guard.ts`                 | Origin/Referer checks for unsafe methods                |

Controller entry points:

- `activity/activity.controller.ts` — anonymous `/api/v1/activity` cursor feed.
- `auth/auth.controller.ts` — `/api/v1/auth`.
- `catalog/catalog.controller.ts` — `/api/v1/catalog` public reads.
- `catalog/admin-catalog.controller.ts` — `/api/v1/admin/catalog`.
- `catch-reports/catch-reports.controller.ts` — public reads, statistics, parser, mutations.
- `catch-reports/my-catch-reports.controller.ts` — owner reads under `/api/v1/me`.
- `health/health.controller.ts` — `/api/v1/health`.

## Frontend route/module map

| Area            | Route path                           | Look first in                                           |
| --------------- | ------------------------------------ | ------------------------------------------------------- |
| Home/activity   | `/`                                  | `src/app/_components/home-dashboard.tsx`                |
| Auth/account    | `/login`, `/register`, `/account`    | matching `src/app/*/page.tsx`, `src/lib/auth-api.ts`    |
| Bases           | `/bases`, `/bases/[id]`              | `src/app/bases`, `src/lib/catalog-api.ts`               |
| Locations       | `/locations/[id]`                    | `src/app/locations/[id]`                                |
| Fish            | `/fish`, `/fish/[id]`                | `src/app/fish`, Fish Explorer `_components`             |
| Baits           | `/baits`                             | `src/app/baits/page.tsx`                                |
| Public catches  | `/catches`, `/catches/[id]`          | `src/app/catches`, `src/lib/catch-reports-api.ts`       |
| Catch entry     | `/catches/new`, `/catches/[id]/edit` | catch form/notebook components                          |
| Private archive | `/my/catches`                        | `src/app/my/catches/page.tsx`                           |
| ADMIN catalog   | `/admin/catalog/**`                  | `src/app/admin/catalog`, `src/lib/admin-catalog-api.ts` |

Shared frontend navigation points:

- `src/lib/api-client.ts` — timeout, cookie credentials, no-store transport, API errors.
- `src/lib/activity-api.ts` — strict public activity union and cursor-page decoder.
- `src/lib/catalog-api.ts` — public catalog requests and strict decoders.
- `src/lib/catch-reports-api.ts` — public/owner projections and CatchReport commands.
- `src/lib/hole-statistics-api.ts` — common-hole request and response decoder.
- `src/lib/fish-base-selection.ts` — URL-backed Fish Explorer Base scope.
- `src/lib/use-api-resource.ts`, `src/lib/use-required-user.ts` — resource/auth hooks.

## CatchReport request flow

Concrete Fish Explorer feed flow:

1. `apps/web/src/app/fish/[id]/page.tsx` loads Fish detail through `getFish`.
2. `_components/fish-explorer.tsx` reads the URL-backed Base selection.
3. `listCatchReports` in `apps/web/src/lib/catch-reports-api.ts` sends Fish/Base filters through
   `apiRequest` in `apps/web/src/lib/api-client.ts`.
4. `GET /api/v1/catch-reports` enters
   `apps/api/src/catch-reports/catch-reports.controller.ts`.
5. The controller DTO validates pagination/filter scope; `CatchReportsService.listPublic`
   validates the cursor, builds the query, and produces the public projection.
6. `PrismaService` executes that query against PostgreSQL.
7. The web decoder rejects owner-only fields, then Fish Explorer renders
   `_components/public-fish-catch-table.tsx`; cursor loads preserve the selected scope.
8. The same explorer separately calls the holes endpoint; `HoleStatisticsService` returns grouped
   results rendered by `_components/common-hole-table.tsx`.

Create/edit/archive flows reuse the same API client and CatchReport service, with Auth and
NotBanned guards applied by the relevant controller route.

## Catalog request flow

`/bases`, `/locations/[id]`, or `/fish/[id]` → `src/lib/catalog-api.ts` →
`CatalogController` → `CatalogQueryService` → `PrismaService` → PostgreSQL → strict web decoder →
React route rendering. ADMIN screens instead use `admin-catalog-api.ts`, `AdminCatalogController`,
and `CatalogAdminService` behind server-side Auth/Admin/ban checks.

## ActivityEvent request and write flow

`ActivityEvent` is owned by `apps/api/src/activity`. `ActivityEventWriter` accepts only the typed v1
event union and never opens a transaction: the CatchReport or catalog domain service passes its
existing `Prisma.TransactionClient`. The event append is the final database operation in that
transaction. Before insertion, the writer resolves the authenticated actor snapshot and takes the
shared PostgreSQL advisory transaction lock; the lock remains held through commit, so descending
bigint event IDs provide commit-consistent feed ordering. A failed mutation or failed event append
rolls back both sides.

CatchReport create, aggregate batch-create, actual update, and delete publish activity. ADMIN Base,
Location, Fish, and Bait create/actual update plus Base–Fish membership add/actual weight
update/remove also publish. Effective no-op updates are suppressed. Auth, parser preview,
ScreenAnchor, offline import, seed, and reconciliation paths do not depend on the writer and do not
publish events. The migration creates an empty store without historical backfill and installs a
PostgreSQL trigger that rejects every `UPDATE` or `DELETE` of an event.

Anonymous `GET /api/v1/activity` validates `limit` and a versioned opaque cursor, selects only the
stored columns needed for projection, orders by `id DESC`, and continues with `id < beforeId`.
`ActivityQueryService` fails closed unless the payload version, exact keys, event/subject pair, and
snapshot values match the v1 contract. The response exposes string event IDs, occurrence time, and
public-safe immutable data. Angler events use the stored nickname snapshot; catalog events expose
only `{ kind: "ADMINISTRATION" }`. Internal actor IDs, contributor/import keys, and private raw
source text never enter the projection. The homepage requests `limit=10`, strictly decodes the
response in `activity-api.ts`, and renders independent loading, error/retry, empty, and populated
states.

## Where tests live

- API unit tests: colocated `apps/api/src/**/*.spec.ts`; run by the API `test` script.
- Web unit/component tests: colocated `apps/web/src/**/*.spec.ts(x)` with Vitest/jsdom.
- PostgreSQL e2e: `apps/api/test/*.e2e-spec.ts`, serialized against the isolated test database.
- Database safety/migration semantics: `apps/api/test/database.spec.ts` and
  `apps/api/test/migrations.semantic.spec.ts`.
- Root commands: `pnpm test` for API/web tests and `pnpm test:e2e` for PostgreSQL e2e.

## Change impact guide

| Change                         | Inspect/test first                                                |
| ------------------------------ | ----------------------------------------------------------------- |
| React Fish UI or Base scope    | Fish route/components, selection helper, web component tests      |
| CatchReport request/projection | web API decoder, controller/service, API unit and PG e2e          |
| Common-hole query              | statistics DTO/service, table/decoder, focused unit and PG e2e    |
| Prisma schema                  | schema, migrations, semantic migration tests, full PG e2e         |
| Catalog query                  | catalog controller/query service, route tests, catalog e2e        |
| ADMIN catalog mutation         | ADMIN UI client, admin controller/service, auth and catalog tests |
| Activity event or public feed  | activity module/decoder/UI, activity e2e, migration semantics     |
| Parser behavior                | parser services, notebook/form components, parser-focused tests   |
| Pure formatter/normalizer      | owning helper and its colocated unit tests                        |
| Auth/session/security          | auth/security modules, unit tests, auth e2e                       |

This table is a starting point; expand verification when a change crosses an invariant boundary.
