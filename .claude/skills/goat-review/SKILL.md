---
name: goat-review
description: "Structured code review and quality audit with RFC 2119 severity, diff-aware analysis, footgun matching, negative verification, and simplify mode for readability."
goat-flow-skill-version: "0.9.4"
---
# /goat-review

## Shared Conventions

- **Severity:** SECURITY > CORRECTNESS > INTEGRATION > PERFORMANCE > STYLE
- **Evidence:** Every finding needs `file:line`. Tag as OBSERVED (verified) or INFERRED (state what's missing). MUST NOT fabricate.
- **Gates:** BLOCKING GATE = must stop for human. CHECKPOINT = report status, continue unless interrupted.
- **Adaptive Step 0:** If context already provided, confirm it - don't re-ask. Bare invocation with no arguments = zero context = ask structural questions and WAIT. Auto-detect pre-fills - it does not replace confirmation.
- **Stuck:** 3 reads with no signal → present what you have, ask to redirect.
- **Flush:** 10+ tool calls without a gate/checkpoint → write 3-sentence status to `.goat-flow/tasks/handoff.md`, ask to continue/compact/redirect.
- **Learning Loop:** Behavioural mistake → create a new markdown entry in `ai/lessons/` or `.goat-flow/lessons/`. Architectural trap → create a new markdown entry in `docs/footguns/` or `.goat-flow/footguns/`.
- **Closing:** FIRST: if `.goat-flow/logs/sessions/` exists, write session summary there (date, skill, complexity, turns, incidents). THEN: if incomplete → write `.goat-flow/tasks/handoff.md`. Check learning loop. Suggest next skill.

## When to Use

Use when reviewing code, auditing quality, checking instruction files, or improving readability.

**NOT this skill:**
- Diagnosing a specific bug → /goat-debug
- Threat-model security assessment → /goat-security
- Planning implementation → /goat-plan
- Generating test instructions → /goat-test

## Step 0 - Gather Context

**Structural questions (always ask or confirm):**
1. What should I review? (PR, commits, files, area, instruction files, readability)
2. Any specific concerns? (performance, security, tricky area, instruction drift)

**Mode routing:**
- Target is a **PR/diff/commits** → Standard mode (Phases 0-4)
- Target is a **codebase area** (not a specific diff) → Audit mode (Phases A1-A3)
- Target is **instruction files** (CLAUDE.md, AGENTS.md, ai/coding-standards/) → Instruction mode (Phases 1i-3i)
- Goal is **readability/naming/cleanup** → Simplify mode (Phases S1-S4)

If `ai/coding-standards/code-review.md` exists, load and apply project-specific standards.

**Footgun check:** If `docs/footguns/` or `.goat-flow/footguns/` exists, read entries mentioning the target area from both locations. If a match is found, present it: "This area has a known issue: [footgun]. Relevant?"

**Before proceeding:** present scope, mode, and concerns. Wait for confirmation.

---

## Standard Mode (Phases 0-4)

### Phase 0 - Spec Compliance (conditional)
If `requirements-{feature}.md` or `TODO_*_prime.md` exists, check acceptance criteria. Skip if no spec.

### Phase 1 - Scope Confirmation
**CHECKPOINT:** "I'll review [N] files about [area]. Focus on [concern]?"

### Phase 2 - Review
Review the DIFF for issues. Read FULL FILES for context. Do not flag pre-existing issues.

**Severity-ordered scan:**
1. Security: injection, auth bypass, secret exposure
2. Correctness: logic errors, edge cases, null handling
3. Integration: API contract changes, cross-boundary effects
4. Performance: O(n²) in hot paths, unbounded queries
5. Style: naming, formatting, convention violations

**Cross-cutting checks:**
- Autonomy tier violations: crosses Ask First boundary?
- Footgun matching: check each finding against `docs/footguns/` and `.goat-flow/footguns/`. Output: `MATCH: [entry]` or `CLEAR`
- Pattern drift: new code uses different pattern than existing? Ask: "Intentional?"
- Test execution gaps: tests exist but don't exercise changed path

### Phase 3 - Present Findings
Use severity-ordered output format. Include: Pre-existing Issues, Breaking Changes, Test Gaps, What's Good.

**BLOCKING GATE:** Present findings. Offer: (a) drill in, (b) review related area, (c) check coverage, (d) something else

### Phase 4 - DoD Gate Check
Verify Definition of Done against this change.

---

## Audit Mode (Phases A1-A3)

Activated when target is a codebase area, not a specific diff.

### Phase A1 - Scan
Scan categories weighted by audit purpose (security/consistency/general). Log: category, `file:line`, description, severity.

**Recurrence check:** Search `docs/footguns/` and `.goat-flow/footguns/` for entries in the scanned area.

### Phase A2 - Verify & Self-Check
**Negative verification:** For each finding, attempt to DISPROVE it. Re-read `file:line`. Look for contradicting evidence. Remove genuine false positives.

**Fabrication self-check:** Re-verify every `file:line` reference.

**Self-diagnostic ratios:** >50% removed = initial scan too noisy. >20% by fabrication check = confabulating.

### Phase A3 - Rank & Rollup
Rank by severity. **Pattern rollup:** 3+ findings with same root cause → group as systemic pattern.

**Anti-fix discipline:** Report problems, don't propose fixes.

**BLOCKING GATE:** Present findings. Offer: (a) drill in, (b) expand area, (c) deeper category, (d) close

---

## Instruction Review Mode (Phases 1i-3i)

Activated when target is instruction files.

### Phase 1i - Friction Signal Scan
- `git log --oneline -20` for recent activity
- Read `ai/lessons/` and `.goat-flow/lessons/` for entries since last update
- Read `docs/footguns/` and `.goat-flow/footguns/` for entries in governed areas
- Check `ai/evals/` for recurring failures

### Phase 2i - Instruction Audit
For each file, check: missing rules, misleading rules, stale rules, outdated rules.

### Phase 3i - Propose Edits
Present in diff-like format. MUST NOT auto-edit instruction files.

---

## Simplify Mode (Phases S1-S4)

Activated when goal is readability improvement. **MUST NOT change behavior.**

**Quick path:** For a single function or ≤50 lines: skip S1 scope confirmation.

### Phase S1 - Read & Assess
**Footgun check:** Read `docs/footguns/` and `.goat-flow/footguns/` for target area.

Read target files. Assess: Can a new reader understand without context? Are names self-explanatory? Do comments add value? Is control flow easy to follow?

### Phase S2 - Identify Opportunities
Scan by impact:

| Category | What to look for | Impact |
|----------|-----------------|--------|
| Naming | Cryptic names, abbreviations, misleading names | High |
| Self-documentation | Code that requires comments to explain intent | High |
| Comment quality | Commented-out code, outdated comments, comments restating code | Medium |
| Complexity | Deep nesting (>3 levels), long functions (>40 lines) | Medium |
| Constants | Magic numbers, hardcoded strings | Medium |
| Dead code | Unused imports, unreachable branches | Low |

**The naming test:** "Would a new reader understand this name without reading the implementation?"

**Refactor boundary:** If a rename crosses file boundaries or changes a public API → redirect to /goat-plan (refactor mode).

**Intentional complexity:** Crypto, parsers, performance-critical paths → flag as "complex by design."

### Phase S3 - Self-Check & Present
Re-read each `file:line`. Is the suggested rename safe? Remove findings where evidence doesn't hold.

Present ordered by impact. **BLOCKING GATE:** (a) implement all, (b) implement selectively, (c) drill in, (d) close

### Phase S4 - Implement (if approved)
Apply one file at a time. After each:
1. Grep for old names — zero remaining
2. Check doc cross-references
3. Run tests/linter — behavior unchanged

If tests fail → revert that change, note as unsafe, continue with rest.

---

## Constraints

- MUST review the diff, read full files for context (standard mode)
- MUST NOT flag pre-existing issues as part of this change (standard mode)
- MUST check each finding against `docs/footguns/` and `.goat-flow/footguns/` (MATCH/CLEAR)
- MUST order findings by severity, not by file or discovery order
- MUST attempt to disprove each finding in audit mode (negative verification)
- MUST NOT propose fixes in audit mode
- MUST NOT auto-edit instruction files
- MUST NOT change behavior in simplify mode
- MUST NOT rename public/exported APIs without explicit approval (simplify mode)
- MUST group 3+ related audit findings as systemic patterns
- MUST re-verify file:line references before presenting
- MUST NOT fabricate file paths or function names
- Conversational: present findings by severity tier, pause between tiers.

## Output Format

See mode-specific phases above for output structure. All modes produce findings with `file:line` evidence tagged OBSERVED/INFERRED.

## Chains With

- /goat-debug - review finds a specific bug → diagnosis needed
- /goat-plan - review reveals missing requirements → planning needed
- /goat-test - review finds coverage gaps → test plan needed
- /goat-security - review finds security concern → deeper assessment

**Handoff shape:** `{scope, mode, findings_by_severity, breaking_changes, coverage_gaps, patterns}`
