# Web-specific instructions

These rules apply to `apps/web/**`. Inherit repository-wide rules from `/AGENTS.md`. Use
`docs/PROJECT_STATE.md` for accepted behavior and `docs/ARCHITECTURE.md` for navigation instead of
copying their route and feature inventories here.

## Structure and boundaries

- Keep the current Next.js App Router, React, and TypeScript structure: routes and route-local
  components under `src/app`, reusable UI under `src/components`, and REST clients, decoders, hooks,
  and pure helpers under `src/lib`.
- Preserve the browser-facing flow to NestJS REST `/api/v1`. Do not add a parallel Next.js backend,
  route-handler API, or alternate transport unless the task requires it.
- Route domain requests through `src/lib/api-client.ts`; preserve credentialed cookies, `no-store`,
  timeouts, cancellation, and structured API errors.
- Treat REST payloads as `unknown` and decode them strictly in the owning `src/lib/*-api.ts` client
  before rendering.
- Client validation improves feedback only. The backend remains authoritative for authentication,
  authorization, and security/domain validation.
- Preserve public/owner field boundaries. Public decoders and UI must reject or omit
  `rawSourceText`; only owner-specific flows may receive or render it.

## Async state, selection, and search

- Keep Fish/Base selection URL-backed and reuse `src/lib/fish-base-selection.ts`; do not reimplement
  its absent/all, explicit-empty/none, stale-ID, or canonical-query semantics in route components.
- Reuse `src/lib/catalog-search.ts` and `src/components/searchable-combobox.tsx` for matching catalog
  sorting, filtering, and searchable selection behavior.
- Propagate `AbortSignal`. On scope changes or pagination, cancel superseded requests and guard
  updates by request identity, revision, or scope so stale responses cannot replace current data.
- Reuse `use-api-resource.ts` and `use-required-user.ts` for matching simple loading/auth flows.

## UX and styling

- Keep catalog, statistics, and reference screens dense and desktop-first. Prefer compact tables,
  lists, and controls over unnecessary cards, oversized typography, or excessive whitespace, while
  retaining a usable responsive fallback.
- Use semantic HTML, associated labels, keyboard-accessible controls, visible focus, live
  loading/error states, and accessible overflow for wide tables.
- Prefer CSS Modules. Inspect all consumers before changing a shared module selector. Change
  `globals.css` only for genuinely global behavior and check other routes for regressions.
- Do not turn an isolated task into a mobile-first redesign, PWA/offline feature, or map UI unless
  explicitly requested.

## Verification

- Keep Vitest/jsdom tests colocated as `*.spec.ts(x)` and cover affected helpers/components,
  accessibility, response boundaries, and stale-request races when relevant.
- Iterate with the closest affected specs, then proportionate web lint/typecheck/build checks.
- Full repository acceptance belongs to the final acceptance workflow, not every frontend edit.
