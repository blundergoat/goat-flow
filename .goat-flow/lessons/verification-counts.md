---
category: verification-counts
last_reviewed: 2026-05-16
---

## Lesson: New harness checks need count locks and provenance date proof

**Status:** active | **Created:** 2026-05-16

**What happened:** While adding the `evidence-before-claims` harness metric, focused check tests passed, but full `npm test` still failed because `test/unit/provenance-types.test.ts` (search: `registered build and harness checks satisfy the schema`) expected 35 registered checks after the build+harness total moved to 36. The self-audit JSON also showed the new check using the old default `verified_on: 2026-04-18` until the check explicitly passed its own ship date into `verificationProvenance`.

**Root cause:** I updated the visible harness-count docs and audit-command type distribution tests, but missed a provenance-schema count lock and did not inspect the new check's JSON provenance before the first audit run. Type/distribution tests prove classification, not provenance freshness.

**Fix:** Update provenance count locks alongside harness count docs, then parse the audit JSON for the new check's `id`, `type`, `impact`, and `provenance.verified_on` before closing the milestone.

**Prevention:** After adding or removing any audit check, grep for `registered build and harness checks`, `HARNESS_CHECKS.length`, the old total count, and the new check id across `test/` and `docs/`. Then run a JSON audit parse that prints the new check's provenance date; do not rely on helper defaults for new evidence.
