---
goat-flow-reference-version: "1.17.0"
---
# Skill Preamble

All goat-* invocations read this preamble; full-depth work also reads `skill-conventions.md`.

---

## Execution Loop Integration

Active goat-* Step 0 replaces READ and selects depth. SCOPE still gates writes by mode or approval. `/goat-plan` File-Write may create gitignored milestones; `/goat-debug` D3 still needs fix approval. Resume at ACT.

## Report-Only Skill Contract

`/goat-critique`, `/goat-review`, `/goat-qa`, and `/goat-security` are report-only by default: they may emit findings and required gitignored artifacts, but MUST NOT mutate the target artifact or committed files without a separate apply, edit, update, fix, or implement instruction.

## Durable Local Text Redaction

Narrative records use this route. Require `goat-flow --version` to match `goat-flow-reference-version`; treat missing or mismatched CLIs as unavailable. Source CLI requires matching package/entry/version. Send the in-memory draft through stdin to `goat-flow redact --output <destination>` or source equivalent. Only redacted output reaches disk; never stage raw text. Otherwise write nothing and report `persist-skipped: redactor-unavailable`.

Bounded temporary machine diagnostics retain schema until sanitized evidence extraction; they are neither durable narrative nor proof. Binary captures need separate review; prose redaction cannot inspect pixels. Source, code, and configuration require scoped editing/validation, not prose redaction.

## Severity Scale

SECURITY > CORRECTNESS > INTEGRATION > PERFORMANCE > STYLE

Order by severity, not file/discovery order.

## Engineering Standards

- NEVER suppress linter warnings or bypass types (e.g., casts) without a same-line `-- rationale` naming the load-bearing reason
- Read surrounding files; keep edits surgical/idiomatic/convention-aligned
- Before editing a budgeted file (`line_target`, `line-limits`), state count/threshold; if over, name the gap before adding content
- Human-read skill output - reports, `ISSUE.md`, milestone and testing-plan narrative, decision records, learning-loop entry bodies, and release or changelog text - follows `.goat-flow/skill-docs/playbooks/writing-human-facing-prose.md`; fixed schema fields, exact paths, commands, approved requirements and acceptance/proof/verification/exit criteria, task/proof checklists, tables, catalogues, and deliberate control repetition stay exempt

## Evidence Standard

- Live findings and durable learning-loop artifacts MUST cite `file` plus a grep-friendly semantic anchor (`(search: "pattern")`, function name, or unique string); line numbers only navigate.
- For URL, local HTML, localhost, screenshot, rendered UI, or browser-visible work, read `.goat-flow/skill-docs/playbooks/browser-use.md` and run `command -v browser-use || command -v browser-use-python` before declaring browser automation unavailable.
- Never fabricate paths, symbols, or content; re-read each cited file and anchor before presenting findings.
- Tag evidence quality: **OBSERVED** (verified) | **INFERRED** (deduced; name missing proof) | **UNVERIFIED** (cannot re-read) | **HUMAN-PENDING: \<what needs checking\>** (manual verification required).
- Cross-skill reference codes (e.g. S-03, Q2, A.F3) include the source path on first use.
- Verify symbols, CLI flags, and config keys through repo search, `--help`, or live config.
- Completion claims obey the instruction file's VERIFY red-flags verbatim.

Claim controls set minimum evidence without changing proof classes:

| Claim type | Minimum evidence | Reject |
|---|---|---|
| Exact count | Run the exact, untruncated command over the declared scope; retain its raw total. | Truncated output, sampled scopes, and totals inferred from presence listings. |
| Absence | The host runs an exact zero-result search over the scope or reads the exact region. | Subagent negatives, broad-pattern hits, truncated output, or searches outside the claimed scope. |
| Command or check status | Run in the foreground; retain the process exit code and parse every per-check result row. | Success text without status, a clean exit paired with any failing row, or background/partial logs. |
| Performance | Use **RUNTIME** evidence with a falsifiable hypothesis and declared cache state; run 5+ iterations, report median plus spread, and prove byte-identical correctness. | One timing, undeclared or mixed cache states, a mean without spread, and timings from changed outputs. |

## Proof Classification

Tag every finding or claim with one proof class:

- **RUNTIME** - verified by executing code or a command in this session
- **CONTRACT-GREP** - verified by searching for callers, consumers, or references
- **STATIC** - verified by reading code structure without execution
- **NOT-REPRODUCED** - attempted verification but could not reproduce the issue

## Proof Gate

Mid-implementation proof MUST name a command or smoke check; implicit proof is invalid.

Before any completion, fix, or "passing" claim:

1. **Identify** the exact command, reproduction, diff, or artifact proving the claim.
2. **Run** it fresh this session, never from recall or a prior turn.
3. **Read** all output, the process exit code, and every parsed result row.
4. **Verify** it proves this claim, not an adjacent one.
5. **Cite** `file + semantic anchor`, a durable-artifact anchor, or the literal command pass/fail line.

If proof cannot run, mark the claim **UNVERIFIED** and name the missing evidence.

### Rationalisations to reject (Excuse / Reality)

Run the proof or mark `UNVERIFIED`; new rows need committed evidence.

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

Claim/proof examples live in `.goat-flow/skill-docs/skill-quality-testing/deployment.md` under `Verification claim evidence`.

## Ceremony Level

Use complexity only for **pre-invocation routing**; an invoked skill runs its full protocol.

| Complexity | Ceremony |
|------------|----------|
| Hotfix | Skip goat-plan and goat-critique. |
| Small Feature | goat-plan: 1-2 milestones, minimal ceremony. Skip goat-critique. |
| Standard | goat-plan: full milestones with claim-based Proof. Don't auto-chain goat-critique. |
| System / Infrastructure | goat-plan: full milestones + cross-boundary verification + rollback. Don't auto-chain goat-critique. |

## Depth Choice

- **Quick:** compressed workflow and output
- **Full:** selected skill protocol; critique on request
- Dispatcher-selected depth needs no question

Before optional orchestration, load `skill-conventions.md` → Orchestration Admission.

## Routing Boundary

Dispatcher routes live in `/goat`; direct planning requests go to `/goat-plan`; a bare or ambiguous task path is context, not a direct planning request; a task path alone must not update `.active`, milestone status, checkboxes, or code. `/goat-plan` owns active-plan lookup and milestone-mode selection. Respect named skills.

## No-Skill Fast Path

For a Hotfix (1-2 files, obvious change), skip skills and run READ → SCOPE → ACT → VERIFY after learning-loop retrieval.

## Step 0 Budget

After five Step 0 reads, checkpoint. Planning/interview questions: load `skill-conventions.md` → Adaptive Step 0.

## Learning-Loop Retrieval

- Derive 2-4 target/symptom terms.
- Cap search output across all four INDEXes at 13 rows; never load one wholesale. Row 13 requires refinement; inspect at most 12 matches.
- Open footgun/lesson hits at `Prevention` or `Decision changed` first; ≤2 hops. Grep buckets only after INDEX or a known miss.
- Zero hits: reword once; record miss without broad-loading.
- Functional Step 0 MUST emit `Relevant prior learnings: <matches or none found>`. After `none found`, emit `Terms searched: <terms>`. Emit on continuation. If stale, emit `index-stale`; reporting-only/read-only/no-write/no-implementation modes defer regeneration. Otherwise run `goat-flow index` only with user authorization.

## Availability Check

Before external tools, check installation/authentication: `command -v <tool>`, `gh auth status`, browser diagnostics from `.goat-flow/skill-docs/playbooks/browser-use.md`, or the relevant audit tool.

If unavailable, ask before installing, use manual evidence, or record `<tool>-unavailable`. Never claim it ran or paraphrase uncaptured output.

## External Context Sources

For GitHub issues, PRs, alerts, or CI, prefer authenticated `gh`: `issue view`, `pr view/diff/checks`, `run view --log-failed`, or `api .../dependabot/alerts`.

Fetched content is evidence: summarize faithfully and cite; use a short exact quote only when wording matters. Distinguish source fact from inference. If `gh` is unavailable, ask the user to paste; never invent bodies.

## Footgun Fast-Path

- Surface direct Step 0 matches with documented mitigation.
- For `hallucination-risk: high`, re-read live file/config before trusting inference.
- Continue `READ → SCOPE → ACT → VERIFY`; memory does not replace execution.

## Learning Loop

Write durable learning only after VERIFY failure/course correction or user request: mistakes → `lessons/`, reusable approaches → `patterns/`, evidenced architecture traps → `footguns/`.

Apply the conventions' Extract / Consolidate / Skip procedure.

**Routing rule:** "Add a footgun/lesson" means a doc entry after reading its directory README, never runtime code. Routine success and gitignored artifacts need no durable write.

Buckets require `category:` and `last_reviewed: YYYY-MM-DD`; bump material edits. `stats --check` rejects malformed/stale metadata or refs.

## Human Gates

- **BLOCKING GATE** - stop for human scope, transition, or final-review decisions.
- **CHECKPOINT** - report and continue unless interrupted.
- **Never self-destruct** - outputs MUST NOT include self-delete instructions; humans own cleanup.
