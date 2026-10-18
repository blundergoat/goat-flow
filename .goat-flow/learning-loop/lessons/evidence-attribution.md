---
category: evidence-attribution
last_reviewed: 2026-10-19
---

**Scope:** Attributing guarantees to the implementation that supplies them, attributing readiness and run details to the host row or command output that recorded them, and checking whether reused evidence still describes current bytes. General guidance remains in [agent-evidence-claims.md](agent-evidence-claims.md).

## Lesson: Naming the component that satisfies a rule is a claim about its code

**Status:** active | **Created:** 2026-09-07
**Decision changed:** Before writing that a named tool provides a guarantee, read that tool's implementation, including its failure paths, and claim only the property its code establishes.
**Trigger phase:** ACT
**Caught at:** VERIFY

**Prevention:** Correcting an unreachable instruction usually means naming the component that really performs the work. That rewrite silently converts a requirement into an assertion about an implementation, so it needs the same evidence as any other claim: open the source, follow the success path and every rejection path, and describe only what you find. Never carry an adjective from the old requirement onto the new attribution. Describe outcome vocabularies in terms of end states an agent can observe, because a failure path that leaves a partial artifact will not match a state named after what the code intended to do.

**What happened:** In 1.17.0 the goat-security Persist Gate was corrected to name the redactor as the component performing the parent traversal, and the phrase "race-safe" was carried over from the requirement being replaced. Three independent reviewers found the redactor's parent walk is a pathname `lstat` sequence, not a descriptor-anchored one, and that the claim contradicted a sibling reference in the same skill forbidding exactly that substitution. The same reviewers found the new outcome vocabulary said "no artifact created" while a real rejection path leaves a zero-byte file at the destination, so an agent would report the artifact as skipped.

**Root cause:** Attribution was treated as editorial phrasing rather than as a factual claim about code. Carrying an adjective across a rewrite is the specific move that hides the error, because the sentence still reads like the sentence that was approved. Evidence anchors: `src/cli/redact-command.ts` (search: `assertRedactDirectories`) walks parents with `lstatSync` by pathname, while `assertRedactAllocation` compares `fstatSync` against `lstatSync` before and after the write; `workflow/skills/goat-security/references/common-threats.md` (search: `MUST NOT emulate containment with a status check`) is the sibling rule the false claim contradicted.

---

## Lesson: Reused evidence expires the moment you edit what it depended on

**Status:** active | **Created:** 2026-09-07
**Decision changed:** After every source edit, re-check which retained results read the file you changed, and mark those results stale before reusing them.
**Trigger phase:** VERIFY
**Caught at:** VERIFY

**Prevention:** Reusing an earlier run to close a criterion is legitimate only while its inputs are unchanged, so record which files each reused run read. Before an evidence record is offered for approval, diff the session's writes against those input lists and re-run anything whose inputs moved. Treat a fix that broadens a rule as a candidate regression on every behaviour the narrow rule also protected, not only the one it targeted.

**What happened:** In 1.17.0 a shipped template reference said "do not combine templates from different phases", which was overriding the skill and causing a Standard test-plan response to drop its risk map. The fix replaced it with a mode-level ban plus an explicit Standard exception. The old rule had been categorical and had also kept Audit's gap report separate from its post-gate plan, because that reference holds two Audit phases; the replacement forbade only cross-mode combination and left Audit unprotected at render time. The same record had already closed the Audit gate criterion by reusing two earlier runs, and those runs had read the pre-fix reference. The reuse was sound when written and was invalidated by the later edit. A self-audit caught both, the rule was rewritten to ban combining any gate report with the plan that follows it and to name Audit explicitly, and an extra isolated run confirmed the Audit gate still holds.

**Root cause:** Reuse was treated as a property of the earlier run rather than as a claim about the current tree. A narrow replacement for a broad rule silently drops whatever else the broad rule covered, and nothing in the change itself surfaces the loss. Recurrence is likeliest when one file governs several routes and a fix targets one of them. Evidence anchors: `workflow/skills/goat-qa/references/output-templates.md` (search: `never combine a gate report with the plan that follows it`), `test/contract/skill-hardening-skills-2.test.ts` (search: `lets an auto-released goat-qa gate carry both phases in one response`).

---

## Lesson: Readiness confirmations belong to named host rows

**Status:** active | **Created:** 2026-10-16 | **Evidence:** OBSERVED
**Decision changed:** Match readiness updates by host name and inspect unavailable-host rows before saving.
**Trigger phase:** ACT
**Caught at:** VERIFY

**Prevention:** Update each named host row from its own evidence. Keep executable discovery, user-reported authentication and observed live delivery separate. Check unavailable hosts explicitly after replacing repeated status text; a structural plan check cannot establish factual readiness.

**What happened:** While preparing a local runtime plan, a global replacement changed every repeated unverified cell. It copied the user's Windows/WSL sign-in confirmation into native Linux/macOS rows even though the user had no access to either host. Reading the saved table caught the false attribution; host-specific corrections restored both unavailable rows to unverified.

**Root cause:** Identical cell text was treated as identical evidence ownership. This was a local planning error, not an observed provider failure; no provider was launched and no implementation was credited.


---

## Lesson: A run record is read from the session's command outputs, not recalled

**Status:** active | **Created:** 2026-09-19
**Severity:** CORRECTNESS
**Decision changed:** Before writing which harness, model and effort ran a piece of work, search the session for the requester's model and effort commands and copy what their outputs say.
**Trigger phase:** VERIFY
**Caught at:** VERIFY
**Incident count:** 3 | **Latest occurrence:** 2026-09-19

**Prevention:** Model and effort commands leave output lines in the conversation. Find them, quote their values, and tie each change to its timing segment. A harness notice naming a new model is the effect of such a command: look for the command just before it. Write "not observable" only for a setting no output mentions; never say a command was not seen without searching.

**What happened:** One closeout recorded effort xhigh and an unseen model switch; the requester had set effort max and switched models in visible commands. The next closeout corrected it, then missed a second model switch and a new effort command in one turn. A requested second check caught it.

**Recurrence 2026-09-19:** The next milestone, written after this lesson, again claimed no command for a switch to Opus 5; its "Set model to Opus 5" output sat just before the notice the record cited. A second check caught it.

**Root cause:** The record came from settings remembered at the start. Mid-turn commands arrive between tool results, and the closeout never searched for them.
