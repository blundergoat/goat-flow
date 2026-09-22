---
goat-flow-reference-version: "1.17.0"
---
# Skill Preamble

Every invocation reads this preamble; Full also reads `skill-conventions.md`.

---

## Execution Loop Integration

Goat-* Step 0 replaces READ and selects depth. SCOPE gates writes by mode or approval. `/goat-plan` File-Write may create gitignored milestones; `/goat-debug` D3 needs fix approval. Resume at ACT.

## Report-Only Skill Contract

`/goat-critique`, `/goat-review`, `/goat-qa`, and `/goat-security` are report-only by default: findings and required gitignored artifacts. They MUST NOT mutate the target artifact or committed files without a separate apply, edit, update, fix, or implement instruction.

## Durable Local Text Redaction

Narrative records: session, handoff, critique, review, quality, security, or export text. Require `goat-flow --version` matching `goat-flow-reference-version`; treat missing or mismatched CLIs as unavailable. Source CLI requires matching package/entry/version. Send the in-memory draft through stdin to `goat-flow redact --output <destination>` or source equivalent, using a fresh `.goat-flow/logs/` path. Redact before disk, not after: only redacted output reaches disk, never stage raw text; existing destinations are refused. Otherwise write nothing and report `persist-skipped: redactor-unavailable`.

The hash-only `redactEvidenceText` API is not a readable scrubber. Redaction reduces leakage; it is neither DLP nor secret review.

Bounded temporary machine diagnostics retain schema until sanitized extraction; they are neither durable narrative nor proof. Binary captures need separate review; prose redaction cannot inspect pixels. Source, code, and configuration use scoped editing/validation, not prose redaction.

## Severity Scale

SECURITY > CORRECTNESS > INTEGRATION > PERFORMANCE > STYLE

Order by severity, not discovery order.

## Engineering Standards

- NEVER suppress linter warnings or bypass types without a same-line `-- rationale` naming the load-bearing reason
- Read surrounding files; keep edits surgical, idiomatic, and convention-aligned
- Before editing a budgeted file (`line_target`, `line-limits`), state its count/threshold; if over, name the gap before adding content
- Human-read reports, `ISSUE.md`, milestone and testing-plan narrative, decisions, learning entries, releases, and changelog text follow `.goat-flow/skill-docs/playbooks/writing-human-facing-prose.md`; fixed schema fields, exact paths, commands, approved requirements and acceptance/proof/verification/exit criteria, task/proof checklists, tables, catalogues, and deliberate control repetition stay exempt

## Evidence Standard

- Live findings and durable learning artifacts MUST cite `file` plus a grep-friendly semantic anchor (`(search: "pattern")`, function, or unique string); line numbers only navigate.
- For URL, local HTML, localhost, screenshot, rendered UI, or browser-visible work, read `.goat-flow/skill-docs/playbooks/browser-use.md` and run `command -v browser-use || command -v browser-use-python` before declaring automation unavailable.
- Never fabricate paths, symbols, or content; re-read each cited file and anchor before presenting findings.
- Tag evidence quality: **OBSERVED** (verified) | **INFERRED** (name missing proof) | **UNVERIFIED** (cannot re-read) | **HUMAN-PENDING: \<what needs checking\>**.
- Cross-skill codes (e.g. S-03, Q2, A.F3) include the source path on first use.
- Verify symbols/flags/config keys through repo search, `--help`, or live config.
- Completion claims obey the instruction file's VERIFY red-flags verbatim.

Claim controls set minimum evidence without changing proof classes:

| Claim type | Minimum evidence | Reject |
|---|---|---|
| Exact count | Run the exact, untruncated command over the declared scope; retain its raw total. | Truncated output, sampled scopes, and totals inferred from presence listings. |
| Absence | The host runs an exact zero-result search over the scope or reads the exact region. | Subagent negatives, broad-pattern hits, truncated output, or searches outside the claimed scope. |
| Command or check status | Run in the foreground; retain the process exit code and parse every per-check result row. | Success text without status, a clean exit paired with any failing row, or background/partial logs. |
| Performance | Use **RUNTIME** evidence with a falsifiable hypothesis and declared cache state; run 5+ iterations, report median plus spread, and prove byte-identical correctness. | One timing, undeclared or mixed cache states, a mean without spread, and timings from changed outputs. |

## Proof Classification

Tag every finding/claim with one proof class:

- **RUNTIME** - current-session execution
- **CONTRACT-GREP** - caller/consumer/reference search
- **STATIC** - code inspection without execution
- **NOT-REPRODUCED** - attempted but not reproduced

## Proof Gate

Mid-implementation proof MUST name a command or smoke check.

Before completion/fix/"passing" claims:

1. **Identify** the exact command, reproduction, diff, or artifact.
2. **Run** it fresh this session, never from recall or a prior turn.
3. **Read** all output, the process exit code, and every parsed result row.
4. **Verify** it proves this claim, not an adjacent one.
5. **Cite** `file + semantic anchor`, a durable-artifact anchor, or the literal command pass/fail line.
6. **Report** each requested outcome's evidence and gaps.

Unavailable proof: **UNVERIFIED**, naming missing evidence.

### Rationalisations to reject (Excuse / Reality)

Run proof or mark `UNVERIFIED`; new rows need committed evidence.

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

Examples: `.goat-flow/skill-docs/skill-quality-testing/deployment.md` under `Verification claim evidence`.

## Ceremony Level

Use complexity only for pre-invocation routing; an invoked skill runs its full protocol.

| Complexity | Ceremony |
|------------|----------|
| Hotfix | Skip goat-plan and goat-critique. |
| Small Feature | goat-plan: 1-2 milestones; skip goat-critique. |
| Standard | goat-plan: full milestones with claim-based Proof; don't auto-chain critique. |
| System / Infrastructure | goat-plan: full milestones, cross-boundary proof, rollback; don't auto-chain critique. |

## Depth Choice

- **Quick:** compressed workflow/output
- **Full:** full selected protocol; critique on request
- Destination Step 0 selects unspecified depth; explicit user requests remain subject to destination rules

Before optional orchestration, load `skill-conventions.md` → Orchestration Admission.

## Routing Boundary

`/goat` owns dispatch; direct planning goes to `/goat-plan`, which owns active-plan lookup and milestone modes; a bare or ambiguous task path is context, not a direct planning request; a task path alone must not update `.active`, milestone status, checkboxes, or code. Respect named skills.

## No-Skill Fast Path

Hotfix (1-2 files, obvious change): skip skills; run READ → SCOPE → ACT → VERIFY after retrieval.

## Step 0 Budget

After five Step 0 reads, checkpoint. Planning/interview questions: load `skill-conventions.md` → Adaptive Step 0.

## Learning-Loop Retrieval

- Derive 2-4 target/symptom terms.
- Cap search output across all four INDEXes at 13 rows; never load one wholesale. Row 13 requires refinement; inspect at most 12 matches.
- Open footgun/lesson hits at `Prevention` or `Decision changed` first; ≤2 hops. Grep buckets only after INDEX or a known miss.
- Zero hits: reword once; record miss without broad-loading.
- Functional Step 0 MUST emit `Relevant prior learnings: <matches or none found>`. After `none found`, emit `Terms searched: <terms>`. Emit on continuation. If stale, emit `index-stale`; reporting-only/read-only/no-write/no-implementation modes defer regeneration. Otherwise run `goat-flow index` only with user authorization.

## Availability Check

Before external tools, check installation/authentication with `command -v <tool>`, `gh auth status`, browser diagnostics, or the relevant audit.

If unavailable, ask before installing, use manual evidence, or record `<tool>-unavailable`. Never claim uncaptured output.

## External Context Sources

For GitHub issues, PRs, alerts, or CI, prefer authenticated `gh`: `issue view`, `pr view/diff/checks`, `run view --log-failed`, or `api`.

Fetched evidence: summarize faithfully and cite; use a short exact quote only when wording matters. Distinguish fact from inference. Without `gh`, ask for pasted content; never invent bodies.

## Footgun Fast-Path

- Surface direct Step 0 matches with their mitigation.
- For `hallucination-risk: high`, re-read live file/config.

## Learning Loop

Write durable learning after VERIFY failure/course correction or user request: mistakes → `lessons/`, reusable approaches → `patterns/`, architecture traps → `footguns/`.

Before writing, read `skill-conventions.md` → Learning Loop - Entry Formats.

**Routing rule:** "Add a footgun/lesson" means a doc entry after its directory README, never runtime code. Routine success and gitignored artifacts need no durable write.

## Human Gates

- **BLOCKING GATE** - stop for human scope, transition, or final-review decisions.
- **CHECKPOINT** - report and continue unless interrupted.
- **Never self-destruct** - outputs MUST NOT include self-delete instructions; humans own cleanup.
