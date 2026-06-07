---
category: refactoring
last_reviewed: 2026-05-27
---

## Pattern: Canary-first contract changes (one consumer before all consumers)

**Context:** Changing a contract that has N consumers (every env class, every audit check, every renderer, every agent config) — the change must propagate to every consumer to land. The naive shape is "change all N consumers in one PR" and ship. When a real-world edge case reveals the new contract is wrong, the revert costs the same N-file surface.

**Approach:** Apply the contract change to exactly ONE consumer first as a canary. Land it. Run it through one full work cycle (a real session, a CI run, a benchmark). Only after the canary survives, propagate to the remaining N-1 consumers in a follow-up PR. The canary cost is one extra PR + one cycle's worth of delay; the saved cost is the breadth-first revert if the new contract turns out to be wrong.

**Evidence (external — mini-swe-agent):** PR #683 (merged 2026-01-05) changed the submit-marker position from first-line to last-line across all 5 environment classes + 4 benchmark configs + 6+ test files in one PR. The PR was well-reasoned (addressed a real bug in issue #659: agent could submit when the command failed). On 2026-01-12, direct commit `1ce8e917` reverted the position swap across the same 15 files. The revert commit message gives no reason; the verifiable lesson is that the breadth-first change cost a breadth-first revert. The complementary fix from the same issue (explicit `returncode == 0` check) landed months later in tangentially-related PR #747.

A canary path — apply to `LocalEnvironment` only first, run mini against a real task for a week, then propagate to `DockerEnvironment` / `SingularityEnvironment` / `BubblewrapEnvironment` / configs / tests — would have surfaced the failure mode against a 1-file revert surface instead of 15.

**Goat-flow application:**
- Cross-file contracts that share this shape: `CheckResult` / `HarnessCheckResult` in `src/cli/audit/types.ts`, manifest schema in `workflow/manifest.json`, skill composition contract in `src/cli/audit/check-drift.ts`, hook event naming (per `.goat-flow/plans/1.40.0/M01-hook-programme-foundation.md`).
- "Smallest canary" usually means: one audit check (not all of them), one environment-style class (not all), one skill (not all six), one agent harness config (not all four).
- The canary's PR description must name *why* this consumer is representative. If the canary doesn't share the failure mode with peers, it's not a canary — it's just a smaller change.
- Reverting a breadth-first contract change is structurally expensive even when the per-file revert is trivial — the diff is wide, parity has to be re-proven across the same surface, and reviewers can't tell which file's symptom motivated the revert. The canary caps that downside.

**When NOT to use:** For pure renames (no semantic change) the canary doesn't help — a rename either works or doesn't, and there's no edge case that only some consumers will expose. Use the canary specifically for *semantic* contract changes where the consumer's behaviour depends on the new contract being correct.

---

## Pattern: Verify structural renames with a repo-wide grep
**Context:** Renaming setup files, moving shared references, or changing canonical doc paths.
**Approach:** Update the replacement file first, grep the old path across active docs/code, fix every live reference, then rerun validation (`bash scripts/preflight-checks.sh` plus the relevant `goat-flow audit` command) before closing the task.

## Pattern: Skill consolidation requires a full grep after every merge
**Context:** Renaming, merging, or deleting skills.
**Approach:** After any skill rename/merge/delete: (1) grep entire repo for every old name, (2) check every installed skill root listed in `workflow/manifest.json` (search: `"skills_dir"`), (3) check constants + types + test fixtures, (4) run the full test suite + audit. Don't trust "it builds and tests pass" - read the changed files.

---

## Pattern: Put prompt side effects on the CLI side of the boundary
**Context:** A prompt contract forbids tracked-file writes or unrestricted I/O, but a new feature needs persistence, capture, or report history.
**Approach:** Keep the prompt read-only or single-path-limited and move extraction, path validation, suffix numbering, schema validation, and writes into CLI code whenever possible. If the prompt must write, pin the path to a gitignored local-state directory and make the exception explicit. Evidence anchor: `src/cli/prompt/compose-quality.ts` (search: `No tracked-file writes`).

---

## Pattern: Sandwich-layer refactor for behavior-preserving migration of load-bearing seams

**Context:** Changing a load-bearing boundary type with many call sites on both sides — a request/response envelope, a check-result schema, a manifest shape, an evidence envelope. The naive shape is "introduce the new type, migrate every call site, delete the old type" in one PR. Blast radius is large; subtle behaviour changes (defaulting, field ordering, validation timing) leak during the migration; a partial revert leaves the seam in an undefined state. Canary-first (above) helps when one *consumer* can validate the change — but doesn't help when the *boundary itself* is what's changing and every consumer needs to keep working immediately.

**Approach:** Introduce the new normalized type as a *middle layer* that round-trips back to the legacy shape on **both sides** of the boundary. The new type sits between producers and consumers, but every producer and consumer keeps seeing the legacy shape — the sandwich layer converts in both directions. Existing parsers, validators, postprocessors, renderers do not move. Migration then happens one call site at a time, each in its own PR: a call site is "migrated" when it speaks the new type directly instead of having the sandwich convert for it. The old type is deleted only after every call site has migrated — but the seam was usable from the first PR.

The trade-off is double conversion cost during the migration window (legacy → new → legacy on each call). Acceptable when the seam is not a hot path; measure first if it might be.

**Evidence (external — stanfordnlp/dspy):** PR #9802 introduced `LMRequest`/`LMResponse` types in `dspy/clients/openai_format.py` (verified: exactly 923 lines) as the new normalized boundary for adapters ↔ LM. Adapters had been speaking directly in provider-shaped messages; adding new capabilities (tools, reasoning, citations, multimodal) required threading provider-specific shapes everywhere. The PR converts the new types back to the legacy OpenAI-format dict on the LM side and back to the legacy parsed-completion dict on the adapter side — neither side moves. TODOs in `dspy/adapters/base.py` mark which call sites should later parse `LMResponse` directly instead of having the layer convert for them; each TODO is one future PR. Evidence: `.goat-flow/scratchpad/related/dspy/dspy/clients/openai_format.py`, `.goat-flow/scratchpad/related/dspy/dspy/adapters/base.py` (search: `_legacy_call_kwargs`, `LMRequest`, `LMResponse`).

**Goat-flow application:**
- **Evidence envelope correlation key** (per memory `project_ag_ui_committed.md` — AG-UI v1 mapping is CUSTOM-only because the envelope has no correlation key): introduce `EvidenceEnvelopeV2` with the correlation key as a sandwich layer that round-trips to V1 on both producer and consumer sides. Producers keep emitting V1; consumers keep reading V1; AG-UI mapping starts speaking V2 directly. Other consumers migrate per-PR.
- **`CheckResult` / `HarnessCheckResult` schema evolution** (`src/cli/audit/types.ts`): a new field that changes semantics for some checks (e.g. `suggestedRevision` per `.goat-flow/plans/related-improvement-ideas/M05-audit-suggested-revision.md`) can ride a sandwich layer rather than requiring all checks and consumers to update at once.
- **Manifest schema changes** (`workflow/manifest.json` consumed by `loadManifest()` at `src/cli/manifest/manifest.ts` (search: `loadManifest`)): when adding capability metadata for per-agent adapter work, the new shape rides as a sandwich between `loadManifest()` and consumers; each consumer migrates when it needs the new field.

**Relation to [Canary-first contract changes](#pattern-canary-first-contract-changes-one-consumer-before-all-consumers):** Canary tests *one consumer* with the new contract while leaving the rest on the old. Sandwich keeps *all consumers* on the old contract while introducing the new shape at the boundary. Use canary when consumers must adopt the change. Use sandwich when the boundary itself is the unit of change. They compose: a sandwich can roll out via a canary consumer first.

**When NOT to use:**
- Tight inner loops where the double-conversion cost is measurable in the hot path.
- When the legacy shape carries data the new shape genuinely cannot represent (the round-trip is lossy) — then the migration must be breaking, and canary-first is the right pattern.
- When all consumers will migrate in the same PR anyway (small N, well-known surface) — the sandwich is overhead without payoff.
