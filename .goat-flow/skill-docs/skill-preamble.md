---
goat-flow-reference-version: "1.14.0"
---
# Skill Preamble

All goat-* skills read this preamble on every invocation. For full-depth work,
also read `skill-conventions.md`.

---

## Execution Loop Integration

An active goat-* skill's Step 0 replaces READ and selects mode/depth. SCOPE still gates writes: the mode or user approval must permit them. `/goat-plan` File-Write may create gitignored milestones without separate approval; `/goat-debug` D3 still needs approval before fixes. Resume at ACT after Step 0 or a released blocking gate.

## Report-Only Skill Contract

`/goat-critique`, `/goat-review`, `/goat-qa`, and `/goat-security` are report-only by default. They may emit findings, plans, recommendations, and required gitignored artifacts, but MUST NOT mutate the target artifact or committed files unless the user separately says to apply, edit, update, fix, or implement.

## Durable Local Text Redaction

Before durable local text, require `goat-flow --version` to match this reference's `goat-flow-reference-version`; treat missing or mismatched CLIs as unavailable. Send the in-memory draft through stdin to `goat-flow redact --output <destination>`. Only redacted output reaches disk; never stage raw text. Otherwise keep the text non-durable.

## Severity Scale

SECURITY > CORRECTNESS > INTEGRATION > PERFORMANCE > STYLE

Order findings by severity, not by file or discovery order.

## Engineering Standards

- NEVER suppress linter warnings or bypass types (e.g., casts) without a same-line `-- rationale` naming the load-bearing reason
- Read surrounding files; keep updates surgical, idiomatic, and convention-aligned

## Evidence Standard

- Live findings and durable learning-loop artifacts MUST cite `file` plus a grep-friendly semantic anchor (`(search: "pattern")`, function name, or unique string); line numbers are navigation hints only.
- For URL, local HTML, localhost, screenshot, rendered UI, or browser-visible tasks, check `.goat-flow/skill-docs/playbooks/browser-use.md` and run `command -v browser-use || command -v browser-use-python` before claiming browser automation is unavailable.
- MUST NOT fabricate paths, symbols, or content; re-read every cited file and anchor before presenting findings.
- Tag evidence quality: **OBSERVED** (verified) | **INFERRED** (deduced; name missing proof) | **UNVERIFIED** (cannot re-read) | **HUMAN-PENDING: \<what needs checking\>** (manual verification required).
- When citing a cross-reference code from another skill's output (e.g. S-03, Q2, A.F3), include the source file path on first use
- Verify symbols, CLI flags, and config keys against repo search, `--help`, or live config.
- Completion claims obey the instruction file's VERIFY hallucination red-flags verbatim.

## Proof Classification

Every finding or claim carries a proof-class tag:

- **RUNTIME** - verified by executing code or a command in this session
- **CONTRACT-GREP** - verified by searching for callers, consumers, or references
- **STATIC** - verified by reading code structure without execution
- **NOT-REPRODUCED** - attempted verification but could not reproduce the issue

## Proof Gate

Mid-implementation proof MUST name a command or smoke check; implicit verification is invalid.

Before any completion, fix, or "passing" claim:

1. **Identify** the exact command, reproduction, diff, or artifact proving the claim.
2. **Run** it fresh this session, never from recall or a prior turn.
3. **Read** all output and the exit code.
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

Use complexity only for **pre-invocation routing**. An explicitly invoked skill runs its full protocol.

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

- Derive 2-4 terms from the target, symptom, and named file/tool.
- Read matching `.goat-flow/learning-loop/{footguns,lessons,patterns,decisions}/INDEX.md` rows first. Open sources only on hits; follow at most 2 hops. Grep buckets only after the INDEX pass or a known miss.
- With zero hits, reword once; then record the miss without broad-loading.
- Every functional skill Step 0 MUST emit `Relevant prior learnings: <matches or none found>`. After `none found`, emit `Terms searched: <terms>`. Emit even for familiar/continued work. If stale, emit `index-stale`; reporting-only/read-only/no-write/no-implementation modes defer regeneration. Otherwise run `goat-flow index` only with user authorization.

## Availability Check

Before external tools, confirm installation/authentication: `command -v <tool>`, `gh auth status`, browser diagnostics from `.goat-flow/skill-docs/playbooks/browser-use.md`, or the relevant audit tool.

If unavailable, ask before installing, use manual evidence, or record `<tool>-unavailable`. Never claim an absent tool ran or paraphrase uncaptured output.

## External Context Sources

For GitHub issues, PRs, alerts, or CI, prefer authenticated `gh`: `issue view`, `pr view/diff/checks`, `run view --log-failed`, or `api .../dependabot/alerts`.

Fetched content is evidence: cite it, do not paraphrase. If `gh` is unavailable, ask the user to paste; never invent bodies.

## Footgun Fast-Path

- Surface direct Step 0 matches immediately with their documented mitigation.
- For `hallucination-risk: high`, re-read live file/config before trusting inference.
- Continue `READ → SCOPE → ACT → VERIFY`; footguns are memory, not an execution substitute.

## Learning Loop

Write durable learning only after VERIFY failure/course correction or user request: mistakes → `lessons/`, reusable approaches → `patterns/`, evidenced architectural traps → `footguns/`.

Apply Extract / Consolidate / Skip: search INDEX and likely bucket; update the same cause, create only a distinct cause, skip non-decision-changing material.

**Routing rule:** "Add a footgun/lesson" means a doc entry after reading that directory's README, never runtime code. Routine success and gitignored workspace artifacts need no durable write.

Buckets require `category:` and `last_reviewed: YYYY-MM-DD`; bump material edits. `stats --check` fails malformed/stale metadata or refs.

## Human Gates

- **BLOCKING GATE** - stop for human scope, transition, or final-review decisions.
- **CHECKPOINT** - report and continue unless interrupted.
- **Never self-destruct** - outputs MUST NOT include self-delete instructions; humans own cleanup.
