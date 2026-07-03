---
category: agent-settings
last_reviewed: 2026-07-03
---

## Footgun: Settings-layer deny globs match guarded phrases quoted inside benign read-only commands

**Status:** active | **Created:** 2026-07-03 | **Evidence:** ACTUAL_MEASURED
**hallucination-risk:** high

**Symptoms:** Read-only Bash calls are denied with `Permission to use Bash with command ... has been denied` and no `BLOCKED:` policy output: a `sed` whose address quoted a footgun title containing a push phrase and a `grep` whose pattern quoted a wrapper-prefixed push example were both denied (2026-07-03 quality assessment). `deny-dangerous.sh` never ran - the agent-settings permission layer denied the call first - so the block is easy to misattribute to the hook.

**Why it happens:** Settings deny globs match as substrings across the whole command string, quoted arguments included: `.claude/settings.json` and the template `workflow/hooks/agent-config/claude.json` (search: `Bash(*git push*)`, search: `Bash(*sudo *)`) deny any command whose text merely mentions a guarded phrase. The hardest layer of the enforcement gradient is the least grammar-aware. The deny-dangerous hook layer does NOT share this trap: piping the same command text as a `tool_input.command` JSON payload into `.goat-flow/hooks/deny-dangerous.sh` (search: `tool_input.command`) exits 0 for both denied shapes (verified 2026-07-03), and the hook self-test keeps read-only allow canaries in `workflow/hooks/deny-dangerous/deny-dangerous-self-test.sh` (search: `expect_allow`) - see the resolved entry "Deny hook blocks read-only commands with dangerous string literals" in `deny-dangerous.md`. Only the settings globs over-match, and per `.goat-flow/learning-loop/decisions/ADR-025-block-all-git-push.md` their bluntness is deliberate.

**Evidence:**
- `.claude/settings.json` (search: `Bash(*git push*)`) and `workflow/hooks/agent-config/claude.json` (search: `Bash(*sudo *)`) - the substring deny globs shipped to every Claude install.
- 2026-07-03 session: two denials of read-only evidence commands quoting deny-dangerous bucket entries; stdin probes of the identical command text through the hook returned exit 0.

**Prevention:**
1. Keep guarded phrases out of the Bash command string when investigating deny/push content: use file-read/search tools instead of shell `grep`/`echo`/`sed`, or grep a fragment that omits the guarded token. Prefer new footgun/lesson titles that avoid guarded literals so future title-greps do not trip the globs.
2. Do not weaken the settings globs to fix this (ADR-025), and do not probe with split-variable reconstructions of guarded phrases - the guard rightly refuses evasion-shaped commands.
3. To test hook-layer classification legitimately, pipe a JSON payload file into `.goat-flow/hooks/deny-dangerous.sh` or run its sanctioned `--self-test` modes; command-line reconstruction of guarded strings is indistinguishable from evasion.
