---
name: fishing-acceptance
description: Perform the final verification pass for stable, completed fishing-db changes. Use when Codex should validate readiness, run the applicable full acceptance once, inspect the final diff, and return READY or NOT READY.
---

# Fishing DB Acceptance

## Boundaries

- Verify a stable implementation; do not continue feature development.
- Change code only when a verification result demonstrates a defect, and keep any correction
  limited to that defect.
- Do not commit.

## Prepare

1. Run `pnpm verify:state` and verify Node/pnpm against current repository declarations.
2. Read `AGENTS.md` and `docs/PROJECT_STATE.md`.
3. Inspect `git status`, staged/unstaged diffs, relevant untracked files, and the changed tests.
4. From the actual diff, read `apps/api/AGENTS.md` only for API changes, `apps/web/AGENTS.md` only
   for web changes, and both only when both scopes are affected.
5. Read `docs/ARCHITECTURE.md` only when module location is unclear, request flow needs tracing, the
   change crosses layers/modules, or the map would materially reduce searching. Skip it when
   affected files are already known.
6. Read current root and affected-package scripts from `package.json`; do not rely on copied command
   inventories that may be obsolete.
7. Decide whether PostgreSQL e2e and Prisma validation/generation apply to the changed behavior.

## Verify once

1. Run any focused critical tests needed to establish that the implementation is stable.
2. Run the current full repository acceptance once after focused failures are resolved.
3. Run PostgreSQL e2e when behavior depends on PostgreSQL queries, constraints, transactions,
   migrations, or persistence semantics.
4. Run Prisma validate/generate when the schema, migrations, Prisma configuration, or generated
   client surface is affected.
5. Cover format, lint, typecheck, test, build/check, and diff integrity through current scripts.
   Do not repeat checks already covered by an aggregate script unless later changes invalidate them.
6. If a check exposes a defect and a correction is made, rerun the focused failure and every
   acceptance result invalidated by that correction.
7. Finish by inspecting `git diff --check`, `git status --short`, and the final diff/stat.

If the full acceptance already ran after the final code change and nothing has changed since, reuse
that evidence rather than rerunning it merely for repetition.

## Acceptance report

Report concisely:

- actual Node and pnpm runtime;
- checks/tests run with exact pass/fail counts available from their output;
- corrections made during acceptance;
- schema and migration impact;
- final git status and diff scope;
- blockers;
- final `READY` or `NOT READY`.

Never infer passing checks from hashes or old documentation; report only evidence from this pass or
still-valid evidence produced after the final change.
