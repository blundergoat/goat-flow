---
category: verification
last_reviewed: 2026-05-02
---

## Pattern: Verification scope must match change scope
**Context:** Any change that touches more than just code.
**Approach:** When the change is code-only, running tests is sufficient. When the change touches docs, setup prompts, or workflow templates, verification must read those files too. When building on existing files, audit them first - errors in source files propagate to everything built on top.

## Pattern: Complexity refactors need file-level lint before closeout
**Context:** Reducing complexity in a specific function.
**Approach:** Lint the whole file before declaring the pass complete. A single extracted function can still leave sibling offenders, and helper rewrites can introduce small follow-up mistakes. Treat the file, not the original function, as the verification unit.

## Pattern: Refactors need typecheck before preflight
**Context:** After a large extraction or restructuring pass.
**Approach:** Run `npx tsc --noEmit` before relying on preflight. Complexity-only verification can miss callback type drift, helper return narrowing, and small unused-parameter regressions that only show up once TypeScript checks the whole tree.
