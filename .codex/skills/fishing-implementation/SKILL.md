---
name: fishing-implementation
description: Implement an already approved fishing-db design or scoped change. Use when Codex should edit the repository, verify affected modules, and report only the approved implementation delta.
---

# Fishing DB Implementation

## Preconditions

- Start from an approved design or a task whose implementation delta is already explicit.
- If behavior or product mechanics still need design, use `fishing-design` first.
- Implement only the approved delta; do not add future phases or unrelated cleanup.
- Do not commit.

## Workflow

1. Run `pnpm verify:state` and note baseline discrepancies.
2. Read the approved design and current task context.
3. Read `AGENTS.md` and `docs/PROJECT_STATE.md`.
4. Determine which directories the task actually affects and read only their scoped instructions:
   - `apps/api/AGENTS.md` for API work;
   - `apps/web/AGENTS.md` for web work;
   - both for a cross-stack change.
5. Read `docs/ARCHITECTURE.md` only when module location is unclear, request flow needs tracing, the
   task crosses layers/modules, or the map would materially reduce searching. Skip it when affected
   files are already known.
6. Inspect `git status`, staged/unstaged diffs, and relevant untracked files before editing.
   Preserve unrelated user changes.
7. Inspect the owning modules and nearby tests, then implement the smallest coherent change.
8. Add or update focused tests for changed behavior and important domain logic.
9. Run the closest affected tests during iteration.
10. Run targeted typecheck and lint where useful for the touched area.
11. Inspect the resulting diff for scope, privacy, schema, migration, generated-file, and dependency
    impact.

Do not automatically run full repository acceptance after every edit. Leave the single full pass to
`fishing-acceptance` once the implementation is stable.

If implementation exposes a product/domain ambiguity not covered by the approved design, stop and
report it instead of inventing mechanics.

## Implementation report

Report only:

- files changed;
- behavior implemented;
- focused tests and checks run;
- schema, migration, generated-client, and dependency impact;
- blockers or unresolved approved work;
- `git status --short`.
