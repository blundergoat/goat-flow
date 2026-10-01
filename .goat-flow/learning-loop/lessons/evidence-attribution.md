---
category: evidence-attribution
last_reviewed: 2026-10-01
---

**Scope:** Attributing guarantees to the implementation that supplies them and checking whether reused evidence still describes current bytes. General guidance remains in [agent-evidence-claims.md](agent-evidence-claims.md).

## Lesson: Naming the component that satisfies a rule is a claim about its code

**Status:** active | **Created:** 2026-09-07
**Decision changed:** Before writing that a named tool provides a guarantee, read that tool's implementation, including its failure paths, and claim only the property its code establishes.
**Trigger phase:** ACT
**Caught at:** VERIFY

**Prevention:** Correcting an unreachable instruction usually means naming the component that really performs the work. That rewrite silently converts a requirement into an assertion about an implementation, so it needs the same evidence as any other claim: open the source, follow the success path and every rejection path, and describe only what you find. Never carry an adjective from the old requirement onto the new attribution. Describe outcome vocabularies in terms of end states an agent can observe, because a failure path that leaves a partial artifact will not match a state named after what the code intended to do.

**What happened:** In 1.17.0 M45 the goat-security Persist Gate was corrected to name the redactor as the component performing the parent traversal, and the phrase "race-safe" was carried over from the requirement being replaced. Three independent reviewers found the redactor's parent walk is a pathname `lstat` sequence, not a descriptor-anchored one, and that the claim contradicted a sibling reference in the same skill forbidding exactly that substitution. The same reviewers found the new outcome vocabulary said "no artifact created" while a real rejection path leaves a zero-byte file at the destination, so an agent would report the artifact as skipped.

**Root cause:** Attribution was treated as editorial phrasing rather than as a factual claim about code. Carrying an adjective across a rewrite is the specific move that hides the error, because the sentence still reads like the sentence that was approved. Evidence anchors: `src/cli/redact-command.ts` (search: `assertRedactDirectories`) walks parents with `lstatSync` by pathname, while `assertRedactAllocation` compares `fstatSync` against `lstatSync` before and after the write; `workflow/skills/goat-security/references/common-threats.md` (search: `MUST NOT emulate containment with a status check`) is the sibling rule the false claim contradicted.

---

## Lesson: Reused evidence expires the moment you edit what it depended on

**Status:** active | **Created:** 2026-09-07
**Decision changed:** After every source edit, re-check which retained results read the file you changed, and mark those results stale before reusing them.
**Trigger phase:** VERIFY
**Caught at:** VERIFY

**Prevention:** Reusing an earlier run to close a criterion is legitimate only while its inputs are unchanged, so record which files each reused run read. Before an evidence record is offered for approval, diff the session's writes against those input lists and re-run anything whose inputs moved. Treat a fix that broadens a rule as a candidate regression on every behaviour the narrow rule also protected, not only the one it targeted.

**What happened:** In 1.17.0 M26 a shipped template reference said "do not combine templates from different phases", which was overriding the skill and causing a Standard test-plan response to drop its risk map. The fix replaced it with a mode-level ban plus an explicit Standard exception. The old rule had been categorical and had also kept Audit's gap report separate from its post-gate plan, because that reference holds two Audit phases; the replacement forbade only cross-mode combination and left Audit unprotected at render time. The same record had already closed the Audit gate criterion by reusing two earlier runs, and those runs had read the pre-fix reference. The reuse was sound when written and was invalidated by the later edit. A self-audit caught both, the rule was rewritten to ban combining any gate report with the plan that follows it and to name Audit explicitly, and an extra isolated run confirmed the Audit gate still holds.

**Root cause:** Reuse was treated as a property of the earlier run rather than as a claim about the current tree. A narrow replacement for a broad rule silently drops whatever else the broad rule covered, and nothing in the change itself surfaces the loss. Recurrence is likeliest when one file governs several routes and a fix targets one of them. Evidence anchors: `workflow/skills/goat-qa/references/output-templates.md` (search: `never combine a gate report with the plan that follows it`), `test/contract/skill-hardening-skills-2.test.ts` (search: `lets an auto-released goat-qa gate carry both phases in one response`).

