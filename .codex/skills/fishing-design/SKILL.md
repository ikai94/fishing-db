---
name: fishing-design
description: Produce a design-only, implementation-ready delta for a fishing-db change. Use when Codex must plan behavior, data flow, affected files, tests, or migration impact without editing files.
---

# Fishing DB Design

## Boundaries

- Work in design-only mode. Do not edit files, create migrations, change dependencies, or commit.
- Treat the accepted HEAD as trusted baseline; do not re-audit unrelated completed phases.
- Inspect only enough code and tests to design the requested delta.
- Do not run the full test suite during design.

## Workflow

1. Run `pnpm verify:state` before relying on repository context.
2. Read `AGENTS.md` and `docs/PROJECT_STATE.md`.
3. Determine which directories the task actually affects.
4. Read only their scoped instructions:
   - `apps/api/AGENTS.md` for API work;
   - `apps/web/AGENTS.md` for web work;
   - both only for a cross-stack change.
5. Read `docs/ARCHITECTURE.md` only when module location is unclear, request flow needs tracing, the
   task crosses layers/modules, or the map would materially reduce searching. Skip it when affected
   files are already known.
6. Inspect `git status`, staged/unstaged diffs, relevant untracked files, and only the affected
   modules and nearby tests.
7. Trace the proposed behavior and data flow across the actual owning files.
8. Identify validation, privacy, history, and concurrency boundaries touched by the delta.
9. Determine focused tests and the minimum final-acceptance scope.
10. Determine whether schema, migration, generated-client, or dependency changes are required.
11. Stop and surface any product/domain choice that cannot be resolved from accepted mechanics.

## Design output

Return a concise delta-only design containing:

- relevant repository facts;
- proposed behavior and data flow;
- affected files;
- tests required;
- schema and migration impact;
- risks or open questions;
- safe implementation order.

State briefly when there is no genuine ambiguity. Do not produce a fixed multi-section audit or
restate the accepted architecture.
