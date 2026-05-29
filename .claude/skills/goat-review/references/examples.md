---
goat-flow-reference-version: "1.9.0"
---
# goat-review Reference Examples

Extended Excuse/Reality table, finding-format examples, and constraint rationale for `/goat-review`.

## Excuse/Reality Table (Full)

| Excuse | Reality |
|--------|---------|
| "Trusted author wrote it, Pass 2 will just refute everything - skip it" | In-group trust has historically produced the worst misses in auth/signing/rate-limit code. Open the files. |
| "CI is green, so boundary and signing edges are already covered" | CI tests what was thought of. Review looks for what wasn't. Green CI raises, not answers, the Pass-2 question. |
| "Tight window + demo tomorrow - MAY-only cosmetic pass is proportionate" | An incomplete review merged into a demo window is worse than a `coverage-degraded` conclusion returned on time. |
| "Findings would be zero anyway, so Review Integrity is paperwork" | Review Integrity IS the zero-findings signal. `files-not-opened` tells the reader you stopped early. |
| "The symbol is unique enough that grep is overkill" | Unique symbols still need external verification because the bug is in the consumer, not the emitter. |
| "Refuted suspicions are noise - logging them wastes tokens" | The ledger is the integrity surface. Without it, REFUTED is indistinguishable from "didn't bother to check." |
