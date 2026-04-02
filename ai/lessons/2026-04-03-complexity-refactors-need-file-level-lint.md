---
name: Complexity refactors need file-level lint before closeout
created: 2026-04-03
type: pattern
---

When reducing a specific complexity hotspot, lint the whole file before declaring the pass complete. A single extracted function can still leave sibling offenders in the same file, and helper rewrites can introduce small follow-up mistakes that only show up once the file is re-linted. Treat the file, not the original function, as the verification unit for complexity work.
