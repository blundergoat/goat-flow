# ADR-016: Cold-path truth maintenance

**Status:** Accepted
**Date:** 2026-04-15
**Updated:** 2026-05-18 - dead audit-doc reference and line-number citations converted to historical notes or semantic anchors.
**Updated:** 2026-05-27 - Tier 2 content-truth checks now live mainly in `src/cli/audit/check-factual-claims.ts` and `src/cli/audit/check-content-quality.ts`, not in preflight-only scanner-era machinery.

## Context

Eight independent critiques (3 Claude Code, 5 Codex) reviewed the goat-flow v1.1.0 setup on its own repo. All 8 confirmed structural integrity (tests pass, skills match, paths resolve). Five of 8 found systematic content-accuracy failures in cold-path surfaces that no automated check caught. Setup scores ranged from 58/100 to 90/100 - the range itself demonstrates the gap between structural soundness and content truth.

## Problem

The framework demands "real evidence only" and "MUST maintain cross-file consistency" but has no automated mechanism to verify these properties in cold-path documentation. The audit validates structure; preflight validates some counts; nothing validates content accuracy.

Verified drift found by the critiques:
- `docs/audit-and-critique.md` (retired) described checks that no longer existed in code
- `docs/coding-standards/conventions.md` claims zero runtime deps (false) and references a nonexistent file
- `.goat-flow/glossary.md` points two entries at the wrong canonical file
- `.goat-flow/code-map.md` lists a script under the wrong directory
- `.goat-flow/learning-loop/footguns/docs-and-crossrefs.md` cited a stale line number (346 vs actual 397)
- `.goat-flow/learning-loop/lessons/verification.md` cited a file-line reference past end of file (`commit.md`, line 12, file was 9 lines)
- `scripts/stop-lint.sh` exists despite ADR-015 saying it was removed
- `.goat-flow/plans/.gitignore` ignores all new files while `/goat-plan` claims durable shared state
- `src/cli/audit/check-agent-setup.ts` emits `rm -rf` howToFix that the deny hook blocks
- `src/cli/prompt/compose-critique.ts` ships a literal `<your-hooks-dir>` placeholder
- `.goat-flow/learning-loop/footguns/hooks.md` has an active item placed below the `## Resolved Entries` heading

## Decision

Accept that cold-path content requires automated truth-checking, not just manual maintenance. Implement in three tiers:

The older evidence-lifecycle convention now folds into this ADR as the state model for footguns and lessons:

- `ACTIVE` is the default for live warnings and lessons
- `MITIGATED` marks a partial fix and must cite the change that reduced the risk
- `RESOLVED` marks a fully fixed issue and should remain in place as historical evidence instead of being moved to a separate archive file

### Tier 1 - Immediate fixes (do now)
- Fix all verified stale evidence in footguns and lessons
- Delete `scripts/stop-lint.sh` (contradicts ADR-015)
- Fix `.goat-flow/plans/.gitignore` to track milestone files
- Fix `compose-critique.ts` placeholder
- Fix `check-agent-setup.ts` howToFix to not emit deny-hook-blocked commands
- Move active items above `## Resolved Entries` in all footgun files

### Tier 2 - Automated checks (next release)
- Add preflight check: footgun/lesson `file:line` references resolve and cited lines haven't moved beyond threshold
- Add preflight check: doc check descriptions match exported check names from code
- Add preflight check: convention claims (runtime deps, file existence) match reality
- Extend path-integrity to cover code-map, glossary canonical-file paths, and fenced code blocks
- Consider auto-generating `docs/harness-audit.md` from check code

### Tier 3 - Process changes
- Change Step 01 early-stop rule to require content-drift checks, not just structural audit pass
- Add cold-path truth verification step to release checklist
- Add `last_verified` or equivalent to active footgun entries (complementing automated staleness checks)

## Rationale

- Manual maintenance of cold-path docs has provably failed: 8 independent reviewers found 20+ content-accuracy issues that had accumulated since the v1.1.0 work
- The existing preflight validates some doc/code counts (build check totals) but not descriptions, claims, or cross-file consistency
- The Step 01 early-stop rule (`workflow/setup/01-system-overview.md` (search: `verify cold-path truth before stopping`)) guards against agents stopping when structural audit passes while cold-path content is stale
- The framework's credibility depends on the cold-path surfaces (footguns, lessons, docs) being trustworthy - if agents are told to consult footguns before acting, those footguns must be accurate

## Consequences

- Content-truth checks are treated as release-quality infrastructure, not optional cleanup.
- Footguns and lessons carry explicit lifecycle state so stale evidence can be preserved as history without being mistaken for active guidance.
- Verification gates now need to include real cross-reference and content checks when cold-path documentation changes.

## Risks

- Automated evidence checking could be fragile (line numbers shift on every edit). Use threshold-based drift detection, not exact-line matching.
- Over-validation of cold-path content could slow preflight/CI. Keep checks fast; validate structure + key claims, not prose quality.
- Some footgun entries describe behavioral patterns with cross-project evidence that will never have in-repo file:line. Allow these if explicitly marked as behavioral-pattern entries.
