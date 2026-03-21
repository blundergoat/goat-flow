# M2 Fixes: Bugs + Improvements from Multi-Agent Review

Consolidated from 3 independent agent reviews of CLI output. Prioritized by impact.

---

## Critical (breaks output — fix first)

### 1. Setup emits contradictory create + fix instructions

**File:** `src/cli/prompt/compose-setup.ts:26-42`
**Symptom:** Fresh project setup prompt includes both "Create CLAUDE.md" AND "Compress CLAUDE.md". Also: "Create docs/lessons.md" then "entries are missing", "Fix invalid settings.json" for a file that doesn't exist yet.
**Root cause:** `compose-setup.ts` includes ALL fragments for each phase with no filtering. Fix mode correctly filters by failed checks via `recommendationKey`, but setup dumps everything unconditionally.
**Fix:** Tag fragments as `create` vs `fix`. Setup mode emits only `create` fragments. Alternatively, setup should run a scan against the target and only include fragments whose check failed (like fix does).

### 2. Literal `none` in generated shell scripts

**Files:** `src/cli/prompt/variables.ts:23-26`, `src/cli/prompt/fragments/standard.ts:134-138`, `src/cli/prompt/fragments/foundation.ts:141`
**Symptom:** When a project has no lint/test/format command, `extractVariables` sets them to the string `"none"`. Template substitution produces broken bash:
```bash
none || { echo "FAIL: lint"; exit 1; }    # bash: none: command not found
none "$1" 2>/dev/null || true              # bash: none: command not found
```
Also in VERIFY step: "MUST run `none` on changes".
**Fix:** Use conditional logic in fragments — skip the step entirely when command is null. For variables, use empty string instead of `"none"`, and guard in templates with `{{#if lintCommand}}` or equivalent.

---

## High (misleading UX)

### 3. `--format markdown` silently returns JSON

**File:** `src/cli/cli.ts:198-200`
**Symptom:** CLI advertises `markdown` as a valid format, but silently returns JSON with no warning.
**Fix:** Remove `markdown` from valid formats list until M4 implements it. Print error: "Markdown format not yet implemented."

### 4. Line count off-by-one

**File:** `src/cli/facts/agent.ts:109`
**Symptom:** `content.split('\n').length` counts trailing newline as an extra line. Reports 121 lines for a file `wc -l` says is 120. Files at exactly the 120-line target get incorrectly penalized.
**Fix:** `content.split('\n').length - (content.endsWith('\n') ? 1 : 0)`

---

## Medium — Scanner false-fails (6 pts lost)

### 5. Ask First section not found (1.3.2 — 3 pts, all agents)

**File:** `src/cli/rubric/foundation.ts:250`
**Symptom:** `No Ask First section found` despite `**Ask First**` existing as bold text under `## Autonomy Tiers`.
**Root cause:** `findSection()` searches `agentFacts.instruction.sections` heading keys for `"ask first"`. The content is body text under `## Autonomy Tiers`, not its own heading.
**Fix:** Search the full instruction file content for the `Ask First` pattern (bold or heading), not just parsed section headings.

### 6. Preflight script not found (2.2.5 — 1 pt, all agents)

**File:** `src/cli/evaluate/evaluators.ts:329`
**Symptom:** `scripts/preflight-checks.sh not found` but file exists on disk.
**Root cause:** `checkSharedPath()` has a hardcoded whitelist. `scripts/preflight-checks.sh` is not in it.
**Fix:** Add to `SharedFacts` in `src/cli/facts/shared.ts` and wire into `checkSharedPath()`.

### 7. CHANGELOG.md not found (3.5.3 — 1 pt, all agents)

**File:** `src/cli/evaluate/evaluators.ts:329`
**Symptom:** Composite check (grep instruction file OR file_exists CHANGELOG.md) fails because `CHANGELOG.md` isn't in `checkSharedPath()`.
**Fix:** Add `CHANGELOG.md` to shared facts and `checkSharedPath()`.

### 8. Codex log-update gate too narrow (1.4.4 — 1 pt, Codex only)

**File:** `src/cli/rubric/foundation.ts:161`
**Symptom:** Pattern `/logs? updated|lessons.*updated|footguns.*updated/` doesn't match AGENTS.md:71's actual wording.
**Fix:** Broaden the grep pattern to also match `"update.*log"` or similar.

---

## Medium — Design issues

### 9. `topoSort` is a no-op

**File:** `src/cli/prompt/compose-fix.ts:120-123`
**Symptom:** Fragments declare `dependsOn` but ordering is never applied. Could produce "Add READ step to CLAUDE.md" before "Create CLAUDE.md". Works by accident because insertion order matches dependency order.
**Fix:** Implement topological sort, or remove `dependsOn` fields to avoid false promise.

### 10. Full-tier checks hardcoded to pass

**File:** `src/cli/rubric/full.ts`
**Symptom:** Checks 3.4.1 (No DoD overlap), 3.4.2 (No execution loop overlap), 3.4.4 (Clean separation) return `pass` unconditionally with `confidence: 'low'`. Real overlaps wouldn't be caught.
**Status:** Accepted limitation — these require cross-file semantic comparison that's out of scope for v1. The `confidence: 'low'` label is the mitigation. No fix needed unless v2 adds cross-file analysis.

### 11. Codex post-turn hook penalty unclear

**Symptom:** `setup-codex.md:165` says Codex has no hook system, but scanner penalizes missing `scripts/stop-lint.sh` (check 2.2.2).
**Status:** The scanner's `agent.ts:158-168` does check `scripts/stop-lint.sh` for Codex as a script-based equivalent. The penalty is intentional — Codex should have a post-turn verification script. The setup docs should be updated to clarify this.

---

## Low (polish)

### 12. Template regex won't match hyphenated variables

**File:** `src/cli/prompt/variables.ts:62`
**Symptom:** `/\{\{(\w+)\}\}/g` only matches `[a-zA-Z0-9_]`. Variables like `{{skill-name}}` wouldn't substitute.
**Status:** Not currently broken (all vars are camelCase). Latent only. Fix if hyphenated vars are ever added.

### 13. Unresolved placeholders left silently

**File:** `src/cli/prompt/variables.ts:65`
**Symptom:** Unresolved `{{var}}` left as-is with no warning. User sees raw template syntax.
**Fix:** Log a warning to stderr for unresolved placeholders, or add a `[UNFILLED]` marker.

### 14. Recommendations truncated at 10 with no indicator

**File:** `src/cli/render/text.ts`
**Symptom:** Only top 10 recommendations shown. No "N more" message. Critical items ranked 11+ silently hidden.
**Fix:** Add `... and N more` line when truncating, or show all.

### 15. `test-all` can report false passes

**File:** `scripts/run-cli.sh:74`
**Symptom:** Any non-empty output counts as success. A command that fails noisily (error to stdout) passes.
**Fix:** Check exit code AND output, or at minimum validate that output doesn't start with "Fatal error" / "Error:".

### 16. Version was hardcoded in two places ~~(FIXED)~~

**Files:** `src/cli/cli.ts:7`, `src/cli/rubric/version.ts`
**Status:** Fixed — `cli.ts` now imports from `version.ts`. Preflight checks verify consistency between `package.json` and `version.ts`, and that `cli.ts` doesn't hardcode.

---

## Tasks

### Priority 1 — Critical (fix first)
- [ ] Tag fragments as `create`/`fix`, filter in setup mode (Bug 1)
- [ ] Replace `"none"` fallback with conditional skip in fragments (Bug 2)
- [ ] Remove `markdown` from valid formats or add warning (Bug 3)

### Priority 2 — Scanner accuracy (6 pts)
- [ ] Fix line count off-by-one in `facts/agent.ts` (Bug 4)
- [ ] Fix Ask First detection to search body content (Bug 5 — 3 pts)
- [ ] Add `scripts/preflight-checks.sh` to shared facts (Bug 6 — 1 pt)
- [ ] Add `CHANGELOG.md` to shared facts (Bug 7 — 1 pt)
- [ ] Broaden Codex log-gate pattern (Bug 8 — 1 pt)

### Priority 3 — Design
- [ ] Implement `topoSort` or remove `dependsOn` (Bug 9)

### Priority 4 — Polish
- [ ] Add `[UNFILLED]` marker for unresolved template vars (Bug 13)
- [ ] Add "N more" indicator to recommendation truncation (Bug 14)
- [ ] Improve `test-all` pass/fail logic (Bug 15)

### Won't fix (accepted)
- Bug 10: Full-tier hardcoded pass — `confidence: 'low'` is the mitigation
- Bug 11: Codex hook penalty — intentional, docs should clarify
- Bug 12: Hyphenated template vars — latent, no current vars use hyphens
- Bug 16: Version hardcoding — already fixed

## Expected Score After Fixes

| Agent | Current | After P1+P2 fixes | After all |
|-------|---------|-------------------|-----------|
| Claude | B (87%) | A (95%+) | A (97%+) |
| Codex | B (86%) | A (93%+) | A (95%+) |
| Gemini | A (91%) | A (97%+) | A (98%+) |
