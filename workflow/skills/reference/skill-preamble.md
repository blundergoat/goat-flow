---
goat-flow-reference-version: "1.5.0"
---
# Skill Preamble

All goat-* skills read this preamble on every invocation. For full-depth work,
also read `skill-conventions.md`.

---

## Execution Loop Integration

When a goat-* skill is active, the skill's Step 0 replaces READ and selects the skill's mode/depth. SCOPE still applies before writes: a skill may write when its selected mode permits writes or the user explicitly approves them. `/goat-plan` File-Write may create gitignored milestone files without a separate approval gate; `/goat-debug` D3 still requires approval before fixes. Resume the loop at ACT after Step 0 output or when a blocking gate releases.

## Report-Only Skill Contract

`/goat-critique`, `/goat-review`, `/goat-qa`, and `/goat-security` are report-only by default. They may produce findings, plans, recommendations, and required gitignored logs or snapshots, but MUST NOT mutate the target artifact or committed files unless the user separately says to apply, edit, update, fix, or otherwise implement the changes.

## Severity Scale

SECURITY > CORRECTNESS > INTEGRATION > PERFORMANCE > STYLE

Order findings by severity, not by file or discovery order.

## Engineering Standards

- NEVER suppress linter warnings or bypass type systems (e.g., casts) without a written `-- rationale` comment on the same line explaining why the suppression is load-bearing
- Analyze surrounding files to ensure surgical, idiomatic updates that match existing conventions

## Evidence Standard

- Every live review finding MUST include file evidence. Prefer `file` plus a grep-friendly semantic anchor (`(search: "pattern")`, function name, or unique string). Line numbers are session-local navigation hints only.
- For URL, local HTML, localhost, screenshot, rendered UI, or browser-visible tasks, check `.goat-flow/skill-reference/browser-use.md` and run `command -v browser-use && browser-use doctor` before claiming browser automation is unavailable.
- Durable learning-loop artifacts (footguns, lessons, patterns, decisions) MUST use file paths plus grep-friendly semantic anchors (function name, unique string, or `(search: "pattern")`) instead of line numbers.
- MUST NOT fabricate file paths, function names, or artifact content
- Before presenting findings, re-read each cited file and semantic anchor to confirm accuracy
- Tag evidence quality: **OBSERVED** (directly verified in code) | **INFERRED** (deduced but not directly confirmed - state what direct evidence is missing) | **UNVERIFIED** (cannot re-read cited evidence) | **HUMAN-PENDING: \<what needs checking\>** (requires manual verification the agent cannot perform)
- When citing a cross-reference code from another skill's output (e.g. S-03, Q2, A.F3), include the source file path on first use
- Before citing a function or symbol name, verify it exists with a repo search
- Before citing a CLI flag, verify it with `--help` or the command's docs
- Before citing a config key, read the actual config file first
- On completion claims, the 5 hallucination red-flags in your instruction file's VERIFY section apply verbatim - do not restate, just comply.

## Proof Classification

Every finding or claim carries a proof-class tag:

- **RUNTIME** - verified by executing code or a command in this session
- **CONTRACT-GREP** - verified by searching for callers, consumers, or references
- **STATIC** - verified by reading code structure without execution
- **NOT-REPRODUCED** - attempted verification but could not reproduce the issue

## Proof Gate

Mid-implementation proof MUST name a specific command or smoke check. "Verified implicitly" or "completed implicitly" is not valid proof.

Before any completion, fix, or "passing" claim:

1. **Identify** the proof - the exact command, reproduction, diff, or artifact that would demonstrate the claim.
2. **Run** it fresh in this session (not recalled, not from a prior turn, not paraphrased).
3. **Read** the full output, including exit code.
4. **Verify** the output demonstrates the specific claim, not an adjacent one.
5. **Cite** `file + semantic anchor` for live code claims, semantic anchors for durable learning-loop artifacts, or the literal pass/fail summary line for command claims.

The red-flags name what NOT to claim; this gate names HOW to substantiate a claim. If you cannot run the proof in this session, mark the claim **UNVERIFIED** and state what evidence is missing. Never substitute "should work", "probably fine", "looks good", or a confidence score.

## Ceremony Level

Adapt ceremony to complexity. Do NOT run full ceremony on simple tasks. This table is **pre-invocation routing guidance** - use it when deciding which skill to invoke. Once the user explicitly invokes a skill, run its full protocol regardless of complexity.

| Complexity | Ceremony |
|------------|----------|
| Hotfix | Skip goat-plan - just implement directly. Skip goat-critique entirely. |
| Small Feature | goat-plan: 1-2 milestones, minimal ceremony. Skip goat-critique. |
| Standard | goat-plan: full milestone breakdown with testing gates. Do not chain goat-critique automatically. |
| System / Infrastructure | goat-plan: full milestones + cross-boundary verification + rollback planning. Do not chain goat-critique automatically; the user can invoke it separately. |

## Depth Choice

- **Quick:** compressed workflow, minimal ceremony, direct output
- **Full:** all phases, multi-perspective critique if planning, full output format
- If arriving from the dispatcher with depth already chosen, skip the depth question

## Routing Boundary

Dispatcher-specific route maps live in `/goat`, not in this shared preamble. Direct planning requests route to `/goat-plan`; a bare or ambiguous task path is context, not a direct planning request. `/goat-plan` owns `.goat-flow/tasks/.active` lookup, existing-plan discovery, and milestone-mode selection, but a task path alone must not update `.active`, milestone status, checkboxes, or code. If the user names a skill explicitly, respect it.

## No-Skill Fast Path

For Hotfix complexity (1-2 files, obvious change), skip skills entirely.
Use direct execution: READ → SCOPE → ACT → VERIFY. Still run the grep-first learning-loop retrieval for the target area before acting.

## Step 0 Budget

If Step 0 exceeds 5 file reads without producing output or asking a question, checkpoint with what you know so far. Continue only when the task genuinely needs broader coverage. Checkpoint mid-Step-0 for complex projects rather than silently reading indefinitely.

## Learning-Loop Retrieval

- Derive 2-4 search terms from the target area, symptom, and named file/tool.
- Search first with `rg -n -i -S '<term1>|<term2>|<term3>' .goat-flow/footguns .goat-flow/lessons .goat-flow/patterns .goat-flow/decisions` (fall back to `grep -rniE '<term1>|<term2>|<term3>' .goat-flow/footguns .goat-flow/lessons .goat-flow/patterns .goat-flow/decisions` if `rg` is not available in the agent's environment)
- Open only matching entries first. Follow related references only when they look relevant, with a maximum depth of 2 hops.
- If the first search returns nothing useful, reword once and search again.
- If the second search still misses, record a retrieval miss in your output or working notes. Do not broad-load a whole bucket "just in case".

## External Context Sources

When the task references GitHub issues, PRs, alerts, or CI runs, check whether `gh` is installed and authenticated (`command -v gh && gh auth status`). If so, prefer it over asking the user to paste content:

- Issues: `gh issue view <n>`, `gh issue list --search '<query>'`
- PRs: `gh pr view <n>`, `gh pr diff <n>`, `gh pr checks <n>`
- Dependabot alerts: `gh api /repos/{owner}/{repo}/dependabot/alerts` (goat-security)
- Actions / CI: `gh run list`, `gh run view <id> --log-failed`

Treat fetched content as evidence like any other file: cite it, do not paraphrase silently. If `gh` is missing or unauthenticated, ask the user to paste the relevant content rather than guessing - never fabricate issue/PR bodies.

## Footgun Fast-Path

- If Step 0 footgun check surfaces a direct match: surface it immediately and map to the documented mitigation.
- If the match has `hallucination-risk: high`, re-read the live file/config before trusting inferred behavior.
- Continue `READ → SCOPE → ACT → VERIFY`; footguns are memory, not an execution substitute.

## Learning Loop

After completing the skill, check if this run uncovered anything worth logging:
- Behavioural mistake → `## Lesson:` entry in `.goat-flow/lessons/` category bucket
- Successful repeatable approach → `## Pattern:` entry in `.goat-flow/patterns/` category bucket
- Architectural trap with file evidence → `## Footgun:` entry in `.goat-flow/footguns/` category bucket

**Routing rule:** When the user asks to "add a footgun" or "add a lesson", create a documentation entry in the correct `.goat-flow/` directory. Do not implement runtime code, logging, UI warnings, or test assertions - those are code changes, not artifact creation. Read the target directory's `README.md` before editing.

**Bucket file frontmatter.** Every footgun / lesson bucket file starts with:

```yaml
---
category: <bucket-name>
last_reviewed: YYYY-MM-DD
---
```

When you add an entry or materially edit the body of a bucket file, bump `last_reviewed` to today's date. Cosmetic edits (typos, whitespace, link formatting) do not require a bump. `goat-flow stats --check` fails when `last_reviewed` is missing, not `YYYY-MM-DD`, older than the newest `**Created:**` / `**Updated:**` / `**Resolved:**` date in the bucket, or when the bucket contains stale file refs or out-of-bounds line refs.

## Human Gates

- **BLOCKING GATE** - stop and wait for human decision. Used for: scope approval, phase transitions, final review.
- **CHECKPOINT** - present status and continue unless interrupted.
- **Never self-destruct** - skill outputs (plans, milestones, findings, reports) MUST NOT include instructions to delete themselves. Plan and milestone files are verification artifacts the human needs to review. Cleanup of working artifacts is the human's decision, not the agent's.
