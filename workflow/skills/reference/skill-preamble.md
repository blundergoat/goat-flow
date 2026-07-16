---
goat-flow-reference-version: "1.14.0"
---
# Skill Preamble

All goat-* skills read this preamble on every invocation. For full-depth work,
also read `skill-conventions.md`.

---

## Execution Loop Integration

When a goat-* skill is active, the skill's Step 0 replaces READ and selects the skill's mode/depth. SCOPE still applies before writes: a skill may write when its selected mode permits writes or the user explicitly approves them. `/goat-plan` File-Write may create gitignored milestone files without a separate approval gate; `/goat-debug` D3 still requires approval before fixes. Resume the loop at ACT after Step 0 output or when a blocking gate releases.

## Report-Only Skill Contract

`/goat-critique`, `/goat-review`, `/goat-qa`, and `/goat-security` are report-only by default. They may produce findings, plans, recommendations, and required gitignored logs or snapshots, but MUST NOT mutate the target artifact or committed files unless the user separately says to apply, edit, update, fix, or otherwise implement the changes.

## Durable Local Text Redaction

Before durable local text, send the in-memory draft through stdin to `goat-flow redact --output <destination>`. Only redacted output reaches disk; never stage raw text at the destination or in a temporary file. If unavailable, keep it non-durable. Evidence: `src/cli/redact-command.ts` (search: `handleRedactCommand`).

## Severity Scale

SECURITY > CORRECTNESS > INTEGRATION > PERFORMANCE > STYLE

Order findings by severity, not by file or discovery order.

## Engineering Standards

- NEVER suppress linter warnings or bypass type systems (e.g., casts) without a written `-- rationale` comment on the same line explaining why the suppression is load-bearing
- Analyze surrounding files to ensure surgical, idiomatic updates that match existing conventions

## Evidence Standard

- Every live review finding MUST include file evidence. Prefer `file` plus a grep-friendly semantic anchor (`(search: "pattern")`, function name, or unique string). Line numbers are session-local navigation hints only.
- For URL, local HTML, localhost, screenshot, rendered UI, or browser-visible tasks, check `.goat-flow/skill-docs/playbooks/browser-use.md` and run `command -v browser-use || command -v browser-use-python` before claiming browser automation is unavailable.
- Durable learning-loop artifacts (footguns, lessons, patterns, decisions) MUST use file paths plus grep-friendly semantic anchors (function name, unique string, or `(search: "pattern")`) instead of line numbers.
- MUST NOT fabricate file paths, function names, or artifact content
- Before presenting findings, re-read each cited file and semantic anchor to confirm accuracy
- Tag evidence quality: **OBSERVED** (directly verified in code) | **INFERRED** (deduced but not directly confirmed - state what direct evidence is missing) | **UNVERIFIED** (cannot re-read cited evidence) | **HUMAN-PENDING: \<what needs checking\>** (requires manual verification the agent cannot perform)
- When citing a cross-reference code from another skill's output (e.g. S-03, Q2, A.F3), include the source file path on first use
- Before citing a symbol, CLI flag, or config key, verify it against a repo search, `--help`, or the actual config file
- On completion claims, the hallucination red-flags in your instruction file's VERIFY section apply verbatim - do not restate, just comply.

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

If proof cannot run, mark the claim **UNVERIFIED** and name the missing evidence.

### Rationalisations to reject (Excuse / Reality)

Run the proof or mark `UNVERIFIED`; new rows require committed evidence.

| Excuse | Reality |
|---|---|
| "Should work now" / "Probably fixed" | Re-run the original failing reproduction. |
| "I'm confident" | Confidence ≠ evidence. |
| "Linter / typecheck passed" | Linter ≠ compiler ≠ test suite. |
| "Sub-agent said success" | Re-read the diff yourself. |
| "Just this once" | No exemption. |
| "Partial check is enough" | A subset of tests is not the test suite. |
| "Looks correct to me" | Structural inspection ≠ verification. |
| "Different words, rule doesn't apply" | Spirit over letter - paraphrases count. |

Concrete claim/proof examples live in `.goat-flow/skill-docs/skill-quality-testing/README.md`.

## Ceremony Level

Adapt ceremony to complexity. This is **pre-invocation routing guidance** for choosing a skill. Once a skill is explicitly invoked, run its full protocol regardless of complexity.

| Complexity | Ceremony |
|------------|----------|
| Hotfix | Skip goat-plan and goat-critique. |
| Small Feature | goat-plan: 1-2 milestones, minimal ceremony. Skip goat-critique. |
| Standard | goat-plan: full milestones with testing gates. Don't auto-chain goat-critique. |
| System / Infrastructure | goat-plan: full milestones + cross-boundary verification + rollback. Don't auto-chain goat-critique. |

## Depth Choice

- **Quick:** compressed workflow, direct output
- **Full:** selected skill protocol; critique on request
- If the dispatcher already chose depth, skip the question

Before optional orchestration, load `skill-conventions.md` → Orchestration Admission.

## Routing Boundary

Dispatcher-specific route maps live in `/goat`. Direct planning requests route to `/goat-plan`; a bare or ambiguous task path is context, not a direct planning request - a task path alone must not update `.active`, milestone status, checkboxes, or code. `/goat-plan` owns `.goat-flow/plans/.active` lookup and milestone-mode selection. If the user names a skill, respect it.

## No-Skill Fast Path

For Hotfix complexity (1-2 files, obvious change), skip skills and run READ → SCOPE → ACT → VERIFY directly. Still run learning-loop retrieval first.

## Step 0 Budget

After five Step 0 reads, checkpoint. Planning/interview questions: load `skill-conventions.md` → Adaptive Step 0.

## Learning-Loop Retrieval

- Derive 2-4 search terms from the target area, symptom, and named file/tool.
- Read the matching `.goat-flow/learning-loop/{footguns,lessons,patterns,decisions}/INDEX.md` rows first; open a source entry only on a candidate hit; follow related refs at most 2 hops. Grep individual buckets only after the INDEX pass or on a known retrieval miss.
- On zero hits, reword once and re-scan. If still empty, record the miss - do not broad-load a bucket.
- Step 0 of every functional goat-* skill MUST emit `Relevant prior learnings: <matching INDEX entries or none found>`; on `none found`, the next line MUST be `Terms searched: <terms>`. Emit even when the area feels familiar or continues prior work - a silent skip is indistinguishable from a miss. If an index is stale, emit, then run `goat-flow index`.

## Availability Check

Before invoking any external tool, confirm it is installed and authenticated: `command -v <tool>`, `gh auth status` for `gh`, browser diagnostics from `.goat-flow/skill-docs/playbooks/browser-use.md`, audit tools (`npm audit`, `pip-audit`, `cargo audit`) before quoting results.

If unavailable: ask before installing, fall back to manual evidence, or skip the step and record `<tool>-unavailable` in the integrity surface. Never claim a check ran when the tool wasn't present, or paraphrase output you didn't capture this session.

## External Context Sources

For GitHub issues, PRs, alerts, or CI runs, prefer `gh` (if authenticated) over pasted content: `gh issue view`, `gh pr view/diff/checks`, `gh run view --log-failed`, and `gh api /repos/{owner}/{repo}/dependabot/alerts` for goat-security.

Treat fetched content as evidence: cite it, do not paraphrase. If `gh` is unavailable, ask the user to paste - never fabricate issue/PR bodies.

## Footgun Fast-Path

- If Step 0 footgun check surfaces a direct match: surface it immediately and map to the documented mitigation.
- If the match has `hallucination-risk: high`, re-read the live file/config before trusting inferred behavior.
- Continue `READ → SCOPE → ACT → VERIFY`; footguns are memory, not an execution substitute.

## Learning Loop

Write durable learning only after a VERIFY failure/course correction or user request. Route behavioural mistakes to `lessons/`, reusable approaches to `patterns/`, and evidenced architectural traps to `footguns/`.

Before writing, apply Extract / Consolidate / Skip: search the relevant INDEX and likely bucket; update the same root cause, create only a distinct cause, and skip non-decision-changing material.

**Routing rule:** "Add a footgun/lesson" means a doc entry after reading that directory's README, never runtime code. Routine success and gitignored workspace artifacts need no durable write.

Bucket files require `category:` and `last_reviewed: YYYY-MM-DD`; bump the date on material edits. `stats --check` fails missing/malformed/stale dates or stale refs.

## Human Gates

- **BLOCKING GATE** - stop and wait for human decision. Used for: scope approval, phase transitions, final review.
- **CHECKPOINT** - present status and continue unless interrupted.
- **Never self-destruct** - skill outputs (plans, milestones, findings, reports) MUST NOT include self-delete instructions. Cleanup of working artifacts is the human's decision, not the agent's.
