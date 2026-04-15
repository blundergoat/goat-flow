---
category: auditor
---

## Footgun: Audit validates hook file content but not hook runtime behavior

**Status:** active | **Created:** 2026-04-05 | **Evidence:** ACTUAL_MEASURED

The audit checks that hook files exist and pass `bash -n` syntax check, but never verifies hooks actually execute. A hook with correct syntax but wrong permissions, missing dependencies (jq not installed), or broken JSON field paths passes the audit at 100% while providing zero enforcement at runtime.

**Evidence:**
- 4+ sessions across 112 (Claude Insights data) derailed by sub-agent permission failures hitting hooks that the audit had already validated
- `deny-dangerous.sh` sed fallback truncates commands with escaped quotes - audit checks syntax, not correctness

**Impact:** Users may trust a passing harness audit as "hooks are working" when it means "hooks exist and have valid bash syntax." The gap between file validation and runtime behavior is invisible.

**Prevention:**
1. Add a setup completion smoke test: pipe a known-blocked command through the deny hook and verify exit code 2
2. Audit should verify hook registration matches hook files (file exists → must be registered, registered → file must exist)
3. Consider a `goat-flow verify` command that does runtime checks vs the current `goat-flow audit` which does static checks

---

## Resolved Entries

> Historical record. These entries are no longer active traps.

- **Scanner AP2 penalizes project-specific skills** (resolved 2026-04-01) — Removed AP2 check and `ap-fix-skill-names` fragment; scanner now only validates goat-flow's own skills.
- **Audit passes when configured agent's instruction file is missing** (resolved 2026-04-13) — Added `configured-agent-present` and `agent-artifacts-consistent` checks to cross-reference config.yaml against detected agents.
- **ask_first structural sync check generates false positives via glob-unaware comparison** (resolved 2026-04-13) — Added `normalizePath()` to strip glob suffixes before comparing config paths against instruction file content.
- **Scanner reports enforcement features it didn't detect** (resolved 2026-04-13) — Scanner removed in v1.1.0; hook facts now read from actual file content via `enrichDenyFromExecpolicy()`.
- **Scanner gives 100% while generated files are broken** (resolved 2026-04-13) — Scanner/rubric engine removed in v1.1.0; replaced with structural build checks plus pass/fail harness completeness checks.
- **Setup reports scanner metrics as audit results** (resolved 2026-04-13) — Scanner removed; `cli.ts` now calls `runAudit()` and reports actual hook file counts.
