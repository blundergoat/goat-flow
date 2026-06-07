---
category: multi-agent
last_reviewed: 2026-05-27
---

## Pattern: Multi-agent critique - how to run it effectively
**Context:** Commissioning multiple independent agent reviews of a framework, architecture, or release candidate.

**When to use:** Large surface area (docs + code + scripts + CI + installed outputs), high cost of a missed finding (audit honesty bugs, user-facing false paths), or pre-release validation.

**How to run:**
1. Give each reviewer the same prompt. Don't share prior reviews - contamination defeats independence.
2. Use different models, not just different instances. Codex and Gemini have different systematic blind spots than Claude. One of each covers more ground than three Claudes.
3. Synthesize and verify after each review. Track first-discovery per finding. Dispute false claims with source evidence before accepting them. ~15-20% of claims per review will need verification.
4. Stop when score variance drops. If several consecutive reviews cluster within a tight score band, coverage is probably adequate. If scores still vary widely, major categories are still being missed.

**Sweet spot by task type:**
- Routine PR or module review: 1, maybe 2 if high-stakes
- Feature or component audit: 3, from different models
- Framework or architecture audit: 4-5, with explicit surface-area scoping in the prompt
- Pre-release with audit honesty concerns: up to 7; accept the synthesis overhead

**Key insight:** MAJOR findings can appear late. Late-session reviews on this repo have surfaced audit-honesty findings (Codex compaction hook false positive, ask_first glob comparison bug) that no earlier reviewer raised. Both would have shipped. Late reviews don't always find only minor things.

**What NOT to do:**
- Don't rank findings by how many reviewers found them. The most important findings are often found by exactly one reviewer.
- Don't use score to select which reviewer to trust. Score tracks coverage, not quality.
- Don't skip synthesis. Raw multi-agent output is noisier than single-agent output. The synthesis step is where reliability comes from.

---

## Pattern: Convert self-declared critique gates into executable checks

**Context:** A multi-agent critique skill asks sub-agents to declare dimensions, isolation, lens coverage, or severity calibration, then the orchestrator uses those declarations to make decisions.

**Approach:** Treat every self-declaration that changes routing, severity, or acceptance as a candidate for orchestrator-side verification. Start with the highest-blast-radius claims: re-read a sample finding to verify dimension tags, grep fresh-eyes output for forbidden namespace references, and only then trust coverage math. Lower-blast-radius declarations such as quota and lens completeness can remain prose until they repeatedly fail.

**Evidence:** `workflow/skills/goat-critique/SKILL.md` (search: `leak scan`) and `workflow/skills/goat-critique/SKILL.md` (search: `coverage gate`) are the current executable-check anchors that replaced earlier self-report-only gates.

**Anti-pattern:** Do not let a prompt rule feed automatic HIGH severity or phase progression unless another context verifies the input. Prompt-based orchestration can request discipline; it cannot prove the discipline happened by reading the sub-agent's own assertion.
