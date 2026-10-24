---
category: shell-fixtures
last_reviewed: 2026-10-24
---

## Footgun: Shell startup can put real commands ahead of fixture mocks

**Status:** active | **Created:** 2026-10-24 | **Evidence:** ACTUAL_MEASURED
**Decision changed:** Establish mock precedence inside the launched shell and assert that the intended mock handled the request.
**Trigger phase:** ACT
**Caught at:** VERIFY

**Prevention:** Prepend the fixture directory after shell startup, using quoted arguments to preserve paths. Verify mock calls in both success and failure cases; the parent's PATH alone does not establish which executable the child uses.

**Symptoms:** The landing-only deployment contract reached its readback check, then failed with `live landing page does not match tracked source after cache invalidation` on native Windows.

**Why it happens:** In the observed Windows environment, Bash startup put `/ucrt64/bin` before the fixture directory. AWS still resolved to its mock, but `curl` resolved to a real binary and read the live page. The comparison therefore used unrelated bytes instead of the fixture's copy of the tracked page.

**Evidence:** `test/contract/command-phrases.test.ts` (search: `keeps landing-only deployment bounded and proof-backed`) reproduced the failure on native Node 20.12.0. Reasserting the mock directory inside Bash made the unchanged success probe return zero. The repaired contract records `mock-curl` calls in both branches; its native Windows suite reported 110 passes, zero failures and zero skips on 2026-10-24. `scripts/deploy-landing.sh` (search: `verify_live_landing`) owns the byte comparison and was unchanged.

The source of this host's startup PATH reordering was not traced. Selecting native Git Bash did not itself guarantee mock precedence.
