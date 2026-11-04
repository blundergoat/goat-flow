---
category: shell-fixtures
last_reviewed: 2026-11-03
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

## Footgun: Native Windows paths need absolute checks and shell-safe fixture tokens

**Status:** active | **Created:** 2026-10-20 | **Evidence:** ACTUAL_MEASURED
**Decision changed:** Use the host path API for absolute Git paths; normalize only fixture tokens entering shell command text.
**Trigger phase:** ACT
**Caught at:** VERIFY

**Prevention:** Test drive-qualified directories on native Windows after changing Git context or bulk pathspec handling. Keep filesystem and environment values native; render injected command-token paths with forward slashes before shell tokenization. Run the complete candidate corpus in both locales and retain safe-command controls beside denied writes.

**Symptoms:** M14 native Windows parity on Node 20.12.0 found eleven differences per locale on 2026-10-20: six bulk restores were allowed, three safe commands were refused, and two denials named the wrong reason. WSL parity had zero differences for the same source set.

**Why it happens:** Three slash-prefix checks treated drive-qualified absolute paths as relative. Separately, corpus materialization inserted native backslashes into command text, where the shell tokenizer consumed them as escapes. Normalizing filesystem or environment values would conflate these two boundaries.

**Evidence:** `src/hooks/policy-segments.mts` (search: "trackPolicyGitShellDirectory"), `src/hooks/deny-dangerous/git-command.mts` (search: "selectGitDirectory") and `src/hooks/deny-dangerous/patterns-writes.mts` (search: "isBulkResolvedGitPathspec") own directory and pathspec classification. `src/hooks/policy-corpus.mts` (search: "commandTokens") separates command substitution from cwd/environment substitution. M14's local `evidence/m14-windows-divergences.json` retains all twenty-two observations; `evidence/m14-native-path-probes.json` retains the measured path and token probes under `.goat-flow/plans/1.19.0/`.
