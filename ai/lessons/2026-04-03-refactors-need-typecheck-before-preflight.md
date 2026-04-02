---
name: Refactors need typecheck before preflight
created: 2026-04-03
type: pattern
---

After a large extraction pass, run `npx tsc --noEmit` before relying on preflight. Complexity-only verification can miss callback type drift, helper return narrowing, and small unused-parameter regressions that only show up once TypeScript checks the whole tree.
