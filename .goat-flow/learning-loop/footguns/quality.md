---
category: quality
last_reviewed: 2026-05-27
---

## Footgun: Quality reviews disappear when the agent skips the final JSON write

**Status:** active | **Created:** 2026-04-19 | **Evidence:** ACTUAL_MEASURED

**Symptoms:** A quality review ran end-to-end, but `goat-flow quality history` reports no saved runs and `goat-flow quality diff` has nothing to compare. No file appears under `.goat-flow/logs/quality/`.

**Why it happens:** `goat-flow quality . --agent <id>` composes a prompt that instructs the agent to write its final JSON report directly to `.goat-flow/logs/quality/<YYYY-MM-DD>-<HHMM>-<agent>-<rand5>.json`. The write is the agent's responsibility, not the CLI's. If the agent emits the JSON inline as a fenced code block, or forgets the save step, or writes to a different path, nothing persists. The target directory is gitignored, so there is no git-side hint that the save was skipped.

**Evidence:**
- `src/cli/prompt/compose-quality-agent-report.ts` (search: `Write it as a file to`) - the prompt ends with an explicit instruction to write the file rather than emit a fenced JSON block.
- `src/cli/prompt/compose-quality-agent-report.ts` (search: `Wrote quality report to`) - the prompt requires a single-line confirmation that references the saved filename.
- `src/cli/quality/history-render.ts` (search: `No saved quality history`) - `history` and `diff` only read files that were actually written to disk.

**Prevention:**
1. After any `/quality` run, verify the save landed: `ls .goat-flow/logs/quality/*.json | tail -3`. If the latest mtime is older than the review you just ran, the agent skipped the write.
2. If the agent replied with a fenced JSON block instead of writing a file, ask it to save the block to the expected path using its filesystem tool before closing the session.
3. Only after the file exists on disk is `quality history` / `quality diff` meaningful - both silently return empty when nothing is saved, so a missing save looks identical to "no prior runs."

See `.goat-flow/learning-loop/patterns/refactoring.md` (search: `Put prompt side effects on the CLI side`) for the durable boundary rule that came out of this incident.

---

## Footgun: Audit score tempering fields must survive every renderer

**Status:** active | **Created:** 2026-05-19 | **Evidence:** ACTUAL_MEASURED

**Symptoms:** A harness concern can truthfully pass while still needing a visible caveat, such as "Verification has no post-turn hook evidence" or "Constraints only prove known deny patterns; broad file read/write enforcement remains unknown." If a new renderer, dashboard reader, or prompt summary drops `AuditConcern.limits`, the UI can regress to a clean-looking PASS/100 even though the JSON contract contains the caveat.

**Why it happens:** Audit output fans out through several parallel consumers: `AuditConcern` JSON, text/Markdown renderers, dashboard readers/types, Home/Quality/Setup scoring views, and quality-prompt summaries. A field that tempers a score is load-bearing even though it is non-gating, so forgetting one consumer recreates the old "green but over-marketed" failure mode.

**Evidence:**
- `src/cli/audit/types.ts` (search: `limits: string[]`) - `limits` is part of the public concern contract.
- `src/cli/audit/render.ts` (search: `Limit:`) - terminal and Markdown output preserve the caveat.
- `src/dashboard/dashboard-readers.ts` (search: `limits: readStringArray`) - dashboard payload readers preserve the field.
- `src/cli/prompt/compose-quality-common.ts` (search: `limits: ${concern.limits.join`) - quality prompts include limits beside score and metric counts.

**Prevention:** When adding or changing a non-gating audit caveat, update every audit consumer in the same patch: core type, JSON reader types, text/Markdown renderer, dashboard reader, prompt summary, and at least one unit test that fails if the caveat disappears from a human-facing surface.


## Footgun: Structural validation passes while content is still unanswerable

**Status:** active | **Created:** 2026-05-26 | **Evidence:** ACTUAL_MEASURED

**Symptoms:** An audit reports PASS — every required section is present, every heading matches, every structural check is green — but the artifact still has unresolved open questions, unanswered specification ambiguities, or placeholder values that prevent downstream work. A fresh agent or maintainer reads the artifact and can't proceed; the audit signal was true but unhelpful. The gap between "structurally valid" and "implementation-ready" is invisible to the structural checks because they don't read inside the sections.

**Why it happens:** Structural checks (does the section exist? does the heading match? does the file have N required H2s?) are cheap to write and easy to make deterministic, so they accumulate first. Content-level checks (does each open question have an answer? is each placeholder resolved? is each decision recorded?) require parsing inside sections and detecting domain-specific markers. Skipping the content-level layer leaves a gap that nothing in the build-mode audit fills. The baseline already names this as pain point #2 ("Scanner compliance vs quality divergence"), but goat-flow's response to date routes it to inferential critique rather than to a deterministic content check.

**Evidence:**
- External: `kennyjpowers/claude-flow` PR #6 ("Feat: spec open questions workflow", MERGED 2025-11-22, 5,502 additions). The motivating statement is in the external PR's specs/spec-open-questions-workflow/02-specification.md file (search: `only checks structural completeness (18 required sections), not whether open questions have been answered. There's a gap between "structurally valid" and "implementation-ready."`). The PR added an entire workflow command whose only job is to detect unresolved `?` questions inside an otherwise valid spec — re-parse on each run, detect already-resolved entries by `Answer:` keyword presence, prompt only for unresolved.
- Goat-flow committed direction: `src/cli/audit/check-content-quality.ts` (search: `runContentQualityChecks`) is the deterministic content-quality layer that should own unresolved-content markers instead of relying on structural setup checks alone.
- Related committed pattern: `.goat-flow/learning-loop/patterns/verification.md` (search: `Non-gating audit gaps belong in explicit limits`) maps over-interpreted audit evidence to explicit caveats; extend the same deterministic-content path before treating a green structural audit as implementation-ready.
- Goat-flow surfaces at risk: `src/cli/audit/check-goat-flow.ts` (search: `16 setup-scope checks`) currently asserts structural presence of `.goat-flow/architecture.md`, `code-map.md`, etc. — but does not inspect their content for unresolved questions. Same applies to milestone files in `.goat-flow/plans/**`.

**Prevention:**
1. For any audit that gates "ready" status on an artifact (spec, plan, critique report, ADR draft, milestone file), pick one content marker (`?`, `TBD`, `Answer:`, `Resolved:`) and add a check that counts unresolved instances separately from structural integrity.
2. Don't conflate "structural pass" with "ready to ship." A structurally valid spec with five unanswered questions should not block on the structural check; it should surface as a distinct `unresolved-content: 5` finding alongside the green structural result.
3. Treat content markers as deliberate: pick the marker word once, enforce it in the audit, so re-running detects the same resolved items every time and the workflow becomes resumable. This is the kennyjpowers PR #6 mechanism — `Answer:` is the load-bearing keyword.
4. When goat-flow's own audit reports green but a downstream agent still can't proceed, capture the specific missing content check as a new harness concern or a new build-mode check before treating the failure as "user error."

Applies to: any goat-flow audit that gates progress on artifact completeness — `src/cli/audit/check-goat-flow.ts` for setup artifacts, `src/cli/audit/harness/check-*.ts` for harness concerns, and future content-level checks proposed by M14. Cross-reference: existing footgun "Audit score tempering fields must survive every renderer" (above) for the parallel concern about caveats; this footgun is about caveats that should *exist* in the first place, not about preserving caveats already present.

## Footgun: Audit checks must not prescribe machine-specific shared content

**Status:** active | **Created:** 2026-05-27 | **Evidence:** ACTUAL_MEASURED

**Symptoms:** A deterministic audit check can be technically satisfiable but push users toward committed content that is wrong for other developers, machines, or checkouts.

**Why it happens:** Checks that validate "presence of guidance" sometimes encode remediation examples too concretely. The original workspace-boundary guidance encouraged hardcoded absolute paths in version-controlled instruction files, which made the files stale anywhere except the author's checkout.

**Evidence:** `.goat-flow/learning-loop/decisions/ADR-026-keep-workspace-boundary-path-agnostic.md` (search: `path-agnostic`) records the current contract: the boundary concept stays, but remediation must be portable and current paths belong in runtime prompts.

**Prevention:** Before adding an audit check, ask whether the user can satisfy it with content that remains true across machines and checkouts. If not, redesign the check or the remediation wording before shipping.

## Footgun: Advisory warnings without enforcement train users to ignore output

**Status:** active | **Created:** 2026-05-27 | **Evidence:** ACTUAL_MEASURED

**Symptoms:** A command emits the same wall of warnings on every run, but the warnings never fail the gate and have no migration path. Users and agents learn to scroll past them, including warnings that might matter later.

**Why it happens:** Advisory metadata checks are easy to add, but if the existing corpus is not backfilled and no deadline is set, the warning stream becomes permanent noise.

**Evidence:** `stats --check` previously emitted decision-metadata warnings for every ADR missing optional Author(s) and Ticket/Context fields. The current stats warning pipeline is anchored at `src/cli/stats/stats.ts` (search: `Collect advisory learning-loop warnings`), and `.goat-flow/learning-loop/decisions/README.md` (search: `Author(s):`) still recommends the metadata without forcing unavoidable warnings.

**Prevention:** Advisory warnings must have an enforcement timeline, a migration path, or be removed. A warning that fires on 100% of the corpus is not a safety net.

## Footgun: YAML heredocs can break tooling before shell execution

**Status:** active | **Created:** 2026-05-27 | **Evidence:** ACTUAL_MEASURED

**Symptoms:** A GitHub Actions workflow looks valid as shell, but YAML-aware tools such as Knip fail after an unindented heredoc is embedded inside a `run: |` block.

**Why it happens:** The heredoc delimiter must satisfy both YAML indentation and shell parsing. Shell-focused review can miss that the workflow document itself is malformed or tool-hostile.

**Evidence:** `.github/workflows/ci.yml` (search: `run: |`) and `.github/actions/goat-flow-audit/action.yml` (search: `run: |`) are the current YAML `run` block surfaces where heredoc edits would need YAML-aware validation. `scripts/preflight-checks.sh` (search: `Knip`) is the tooling gate that previously exposed workflow-shape drift.

**Prevention:** For generated multi-line files inside workflow `run: |` blocks, prefer `printf '%s\n' ... > file` unless the heredoc indentation has been validated against both the YAML parser and the shell.

## Resolved Entries

---

## Footgun: Metric checks inflated harness concern scores to 100% even when the capability was absent

**Status:** resolved | **Created:** 2026-04-30 | **Resolved:** 2026-04-30 | **Evidence:** ACTUAL_MEASURED

**Symptoms:** `audit --harness` reported Verification score 100 and Recovery score 100 while its own findings said "no structured toolchain.test configured" and "26 milestone files at 0%." All four quality assessment agents (Claude, Codex, Copilot, Gemini) independently identified this as the top structural flaw across 16 quality reports.

**Root cause:** `computeHarness` in `src/cli/audit/audit.ts` (search: `counts[check.concern].total++`) counted every harness check the same way, so metric-type degraded evidence could be hidden or over-marketed. The `AuditConcern` type contract (search: `metrics: number`) distinguishes metric counts from status-gating integrity/advisory checks, and `applyCheckToConcern` skips metrics for status. But the score and scope calculations also need their own explicit metric/impact handling.

**Fix:** Three layers of the same bug, fixed separately:
1. `computeHarness` in `src/cli/audit/audit.ts` (search: `counts[check.concern].total++`) - handles metric-type degraded evidence as score-only rather than status-gating. Fixed concern scores that previously implied full readiness.
2. `agentScore()` in `home.html`, `quality.html`, and `setup.html` - includes score-only metric failures in dashboard maturity percentages while keeping them out of audit status. A later audit found the earlier `c.type !== 'metric'` filter made the dashboard say 100% / "All checks passing" while verification evidence was missing, so the dashboard now scores all non-skipped checks and labels score-only failures as warnings.
3. `buildScope` in `src/cli/audit/audit.ts` (search: `impact === "scope-fail"`) - excludes score-only failures from the scope failure filter. A metric returning `fail` was previously included in the scope's `failures` array, causing `harness.status = "fail"` and `overall.status = "fail"` even though all concerns were PASS. This made every project without optional runtime verification evidence fail the `--harness` gate.

**Prevention:** The metric contract has three enforcement points, not one: concern score calculation, dashboard maturity display, and scope status. Metrics must lower concern/dashboard scores when they fail, but never create a scope failure. When adding new harness checks, verify the check type and impact are intentional. The contract: `integrity` gates status, `advisory` gates status unless acknowledged, `metric` can lower scores but never creates a scope failure.
