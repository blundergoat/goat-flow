# Skill Preamble

All goat-* skills read this preamble on every invocation. For full-depth work,
also read `skill-conventions.md`.

---

## Execution Loop Integration

When a goat-* skill is active, the skill's Step 0 satisfies READ/SCOPE. Resume the loop at ACT.

## Severity Scale

SECURITY > CORRECTNESS > INTEGRATION > PERFORMANCE > STYLE

Order findings by severity, not by file or discovery order.

## Engineering Standards

- NEVER suppress linter warnings or bypass type systems (e.g., casts) unless explicitly instructed
- Analyze surrounding files to ensure surgical, idiomatic updates that match existing conventions

## Evidence Standard

- Every finding MUST include file evidence - either `file:line` when the specific line demonstrates the issue, or `file` when the trap is file-level. Path-only evidence is valid when a line number would be fabricated.
- MUST NOT fabricate file paths, function names, or artifact content
- Before presenting findings, re-read each cited `file:line` to confirm accuracy
- Tag evidence quality: **OBSERVED** (directly verified in code) vs **INFERRED** (deduced but not directly confirmed - state what direct evidence is missing)
- If you cannot re-read the cited evidence before responding, mark the claim **UNVERIFIED**
- Before citing a function or symbol name, verify it exists with a repo search
- Before citing a CLI flag, verify it with `--help` or the command's docs
- Before citing a config key, read the actual config file first
- On completion claims, the 5 hallucination red-flags in your instruction file's VERIFY section apply verbatim — do not restate, just comply.

## Proof Gate

Before any completion, fix, or "passing" claim:

1. **Identify** the proof — the exact command, reproduction, diff, or artifact that would demonstrate the claim.
2. **Run** it fresh in this session (not recalled, not from a prior turn, not paraphrased).
3. **Read** the full output, including exit code.
4. **Verify** the output demonstrates the specific claim, not an adjacent one.
5. **Cite** `file:line` for code claims, or the literal pass/fail summary line for command claims.

The red-flags name what NOT to claim; this gate names HOW to substantiate a claim. If you cannot run the proof in this session, mark the claim **UNVERIFIED** and state what evidence is missing. Never substitute "should work", "probably fine", "looks good", or a confidence score.

## Ceremony Level

Adapt ceremony to complexity. Do NOT run full ceremony on simple tasks.

| Complexity | Ceremony |
|------------|----------|
| Hotfix | Skip goat-plan - just implement directly. Skip goat-critique entirely. |
| Small Feature | goat-plan: 1-2 milestones, minimal ceremony. Skip goat-critique. |
| Standard | goat-plan: full milestone breakdown with testing gates. Use goat-critique if approach is genuinely uncertain. |
| System / Infrastructure | goat-plan: full milestones + cross-boundary verification + rollback planning. goat-critique strongly recommended. |

## Depth Choice

- **Quick:** compressed workflow, minimal ceremony, direct output
- **Full:** all phases, multi-perspective critique if planning, full output format
- If arriving from the dispatcher with depth already chosen, skip the depth question

## Routing

When invoked via /goat or when intent is ambiguous:

**Route by intent:**
- Bug, failure, investigation → /goat-debug
- Quality review, audit → /goat-review
- Multi-perspective critique → /goat-critique
- Security, compliance, dependency audit → /goat-security
- Testing gaps, coverage, verification planning → /goat-qa
- Feature planning, milestones → /goat-plan
- Simple implementation (rename, add log, move constant) → no skill, use execution loop directly
- Simple question → answer directly

**Depth-aware routing:** If the user asks for a plan, offer quick/full before routing.
**Clarification:** If ambiguous, ask ONE question.
**Override:** If the user names a skill explicitly, respect it.

| Input | Options |
|-------|---------|
| "check the auth code" | debug vs review vs security |
| "analyse/evaluate/critique this" | review vs critique vs plan (depends on artifact type) |
| "get a second opinion" | critique vs review |
| "assess the setup" | review vs security (depends on concern) |
| "refactor the tests" | plan vs qa |

## No-Skill Fast Path

For Hotfix complexity (1-2 files, obvious change), skip skills entirely.
Use direct execution: READ → SCOPE → ACT → VERIFY. Still check `.goat-flow/footguns/` for the target area before acting.

## Step 0 Budget

If Step 0 exceeds 5 file reads without producing output or asking a question, stop and present what you know so far. Checkpoint mid-Step-0 for complex projects rather than silently reading indefinitely.

## Footgun Fast-Path

- If Step 0 footgun check surfaces a direct match: surface it immediately and map to the documented mitigation.
- If the match has `hallucination-risk: high`, re-read the live file/config before trusting inferred behavior.
- Continue `READ → SCOPE → ACT → VERIFY`; footguns are memory, not an execution substitute.

## Learning Loop

After completing the skill, check if this run uncovered anything worth logging:
- Behavioural mistake → `## Lesson:` entry in `.goat-flow/lessons/` category bucket
- Successful repeatable approach → `## Pattern:` entry in `.goat-flow/patterns.md`
- Architectural trap with file evidence → `## Footgun:` entry in `.goat-flow/footguns/` category bucket

## Human Gates

- **BLOCKING GATE** - stop and wait for human decision. Used for: scope approval, phase transitions, final review.
- **CHECKPOINT** - present status and continue unless interrupted.
