---
goat-flow-reference-version: "1.17.0"
---
# Writing Agent-Facing Instructions

Use this when creating or editing text an agent executes from: a skill, a playbook, a shared preamble or conventions file, an instruction file (`CLAUDE.md`, `AGENTS.md`, `.github/copilot-instructions.md`), a hook message, or a README discovery row. `writing-human-facing-prose.md` owns human-read prose and exempts these surfaces because emphasis, structure, and deliberate repetition can be compliance mechanisms; this playbook owns the control text inside that exemption.

> **Illustrative examples - shape only; never evidence.** Examples below demonstrate form, not recorded incidents.

## Availability Check

This is a documentary reference, not a runnable tool; no CLI probe applies. Load it when work creates or changes text an agent will read later. Project standards own artefact shape, registration, budget, and storage. This playbook owns content, placement, prescription, testing, and pruning.

## Project Authority

Project conventions govern shape, vocabulary, budgets, and supported surfaces. Explicit current instructions and the authoritative project hierarchy stay higher. Safety, architecture, verified facts, evidence requirements, licences, permission boundaries, and verification gates are never superseded here.

When no project convention answers an authoring question, use this playbook's generic default.

Before writing project policy, inspect the applicable instructions, source, configuration, tests, CI, documentation, and relevant history. Preserve useful guidance and ownership. Do not invent conventions, commands, capabilities, or workflows or replace an established file merely to fit a template.

## Intent

The customers are the agent running the document on a future turn without the author's working context, and the human who must discover and maintain it. The goal is predictable behaviour: the same kind of input takes the intended path even when the output differs.

Keep a line only when it changes a decision, supplies non-obvious knowledge, prevents a demonstrated failure, states a hard boundary, or routes to material that does. If no durable guidance changes behaviour, create no document.

## Authoring Loop

Work in this order:

1. **Inspect** current authority, owners, live sources, and baseline behaviour; finish when facts and conflicts are recorded.
2. **Define** target behaviour, observed failure, and proof before drafting a corrective rule.
3. **Place** each meaning in always-loaded text, a pointer, disclosed reference, executable resource, or the live environment.
4. **Shape** the instruction to task fragility and failure class.
5. **Test** it against the baseline in fresh contexts, including variations and near-misses.
6. **Prune** until every remaining line changes behaviour or carries a hard boundary.


## The Two Loads

Every document, and every line pointing at one, spends one of two budgets:

- **Context load** is the recurring token and attention cost of always-loaded text, whether or not it fires.
- **Cognitive load** is the human cost of knowing which documents exist and when to reach for them. Spend it where human judgement matters.

Material behind a pointer avoids most body context cost but spends the pointer; material with no pointer relies on human memory.

| Material | Best home |
|---|---|
| Changes behaviour on most turns in scope | Always-loaded instruction or preamble |
| Changes behaviour when a surface, task, symptom, or tool is touched | Behind a pointer |
| Supplies detail needed by only one branch | Disclosed reference |
| Performs repeated, fragile, or mechanical work | Script, schema, hook, or validator |
| Can be found cheaply from the live environment | Environment lookup, not prose |
| Only a human should decide to invoke | Human-indexed runbook or user-invoked skill |

## Pointers and Discovery

A **pointer** is an always-visible line naming out-of-context material and its load condition. Skill descriptions, router rows, `Read first:` lines, and instruction-file routes use this mechanism. A required target behind a weak pointer is a variance bug.

A pointer names the capability or material and the distinct branches that should trigger it:

- **Front-load the trigger.** Put the task, surface, symptom, or decision first.
- **Trigger on the work, not the filename.** Route when the agent touches the governed surface even when the user never names the document.
- **Use one trigger per branch.** Collapse synonyms for the same case; keep genuinely different cases.
- **Name capability plus conditions.** For a skill description, answer what it enables and when it should load.
- **Do not summarise the workflow in metadata.** A compressed process can become a shortcut that replaces loading the body.
- **Use real task vocabulary.** Include meaningful symptoms, artefacts, operations, file types, and domain terms.
- **Read the pointer alone.** It is the agent's whole discovery context before loading the target.

```yaml
description: Reviews code changes for correctness, test integrity, and maintainability. Use when evaluating a diff, pull request, or agent-written implementation before approval.
```

Repeat `When to use` in the body only when it selects a branch, states a meaningful exclusion, or changes execution. Test discovery separately: a good pointer fires consistently on in-scope variations and stays silent on difficult near-misses.

## The Information Ladder

Agent-read documents contain **steps** - ordered actions - and **reference** - material consulted as needed.

Place each piece on the lowest rung that still makes it reliable:

1. **In-file step** - required on the main path, in order.
2. **In-file reference** - needed by every run or beside the step it governs.
3. **Disclosed reference** - needed by some branches and reached through a direct pointer.
4. **Executable resource** - deterministic work better performed than re-described.
5. **Environment source** - live facts retrieved from configuration, code, schemas, tests, directory structure, or `--help`.

**Progressive disclosure** keeps the main path visible. Inline what every branch needs; point directly to branch-only detail and say when to read it. Keep workflow and branch selection in the main file. Avoid deep chains; give long references stable headings, a contents map, or search anchors.

**Co-location** keeps a concept's definition, rule, caveats, and check together. Scattering fragments one meaning; duplication repeats it. Both increase variance and maintenance cost.

**Sprawl** is a document too long even when every line is live. Split by branch, variant, or real sequence boundary so each run carries only what it needs; do not raise the budget by default.

## Prescription and Instruction Form

Match prescription to task fragility:

- **High freedom** - goals, invariants, heuristics, trade-offs, and completion criteria when several approaches are valid.
- **Medium freedom** - one default path, observable branch conditions, bounded templates, pseudocode, or parameterised commands when a preferred pattern exists but context varies.
- **Low freedom** - exact sequence, constrained parameters, scripts, schemas, validators, and repair loops when order, safety, compatibility, or deterministic output matters.

State what must remain true before prescribing implementation. Prefer one default path; add an alternative only for a real constraint with an observable selection condition.

Choose the instruction form from the baseline failure:

| Baseline failure | Strong form | Weak form |
|---|---|---|
| Material does not load | Pointer with capability and trigger branches | More detail in the unloaded body |
| Output has the wrong shape | Positive contract, ordered parts, or exact template | A list of things not to write |
| A required element is omitted | Required slot, checklist item, or schema field | A buried prose reminder |
| Behaviour depends on a condition | `If <observable predicate>, then <action>` | General rule plus vague exception |
| A known rule is skipped under pressure | Explicit guardrail, safe path, observed rationalisation counters, and stop signal | Soft preference language |
| A repeated operation varies | Tested executable or validator and repair loop | Regenerating it from prose each run |
| The agent lacks non-obvious knowledge | Focused reference routed at the relevant branch | Whole-domain always-loaded context |

For output shaping, state the result's parts, order, invariants, and completion test. Use prohibitions for discipline failures, destructive operations, permission boundaries, and hard safety rules; pair each with the permitted action, precise scope, and rationalisation counters observed in tests.

```markdown
Coding agents do not run `git commit` or `git push`; the user performs both manually. Prepare the verified working tree and report the commands the user should run.
```

Write a real exception as its own conditional branch. Avoid "unless it matters" or "except when appropriate". Explain why when the reason helps the agent generalise or choose safely; rationale strengthens a rule rather than softening a binary gate.

## Workflow and Completion Criteria

Use numbered steps when sequence matters. Use decision criteria or flat reference for open-ended work.

Where not obvious, each procedural step names its **input**, **action**, **output**, and **completion criterion** - the check that distinguishes done from not done.

A strong criterion has **clarity** - the agent can check it - and **demand** - it asks for enough. Replace "understanding reached" with an observable bound; "every modified file accounted for" drives more legwork than "produce a change list".

Use a checklist when omission is the failure mode. Use a validator when correctness is mechanical: produce, validate, repair every in-scope failure, then validate again until the gate passes or a named blocker prevents repair.

If tests show later steps pulling execution forward, sharpen the current completion criterion first. Split only when the pull remains and a real context boundary, such as a hand-off or delegated task, can hide those steps.

## Language, Sources, and Portability

Write for the action the agent must take.

- Use direct verbs: **open**, **search**, **compare**, **run**, **record**, **delegate**, **validate**.
- Describe actions rather than harness-specific tool names unless the harness contract is the subject. Write "search the repository", not "call the Grep tool".
- Use one stable term per concept; do not vary terminology for rhythm.
- Document exact paths, commands, parameters, and outputs only when verified and durable; prefer relative project paths for bundled material.
- Scope **all**, **never**, **only**, and **always** to the surface where they are true.
- Keep current harness limits, metadata, discovery, precedence, model aliases, and capability gaps in the owning adapter documentation; verify them before publishing.
- State a supported fallback or explicit limitation when a harness lacks a required capability. Do not invent equivalence.

Put facts in their natural source: code and configuration define behaviour; tests, schemas, hooks, linters, and CI enforce mechanical contracts; documentation explains architecture and operations; plans hold live state; agent instructions hold durable, non-obvious decision context and routes.

An instruction file is a table of contents and behavioural contract, not an encyclopedia. Leave cheap lookups and volatile state in the environment. Keep what lookup cannot reveal: an unwritten invariant, rationale, dangerous seam, ownership boundary, or verified gotcha.

For repository-wide instructions, explain what the project enables and which product or domain boundaries change decisions. A stack list or directory map alone is not orientation. Keep one canonical policy entry where the verified harness strategy supports it; compatibility files point or import rather than maintain independent copies.

Examples clarify a contract; they do not define it. Prefer one strong example, retain the durable mechanism rather than the incident story, and move deterministic repetition into tested executables.

## Leading Words

A **leading word** is a short, stable term reused for a larger behavioural concept: *seam*, *red*, *gate*, *frontier*. It can compress explanations and give the agent a consistent handle for a decision class.

Treat this as a testable compression technique, not model law. Prefer an established term, define it once, repeat the token rather than its meaning, and remove it when tests show a no-op or inconsistent interpretations.

## Behavioural Evaluation

A document's prose is a behavioural hypothesis. Give strong claims a named basis - a project incident, controlled trial, or verified runtime contract - or frame them as guidance to test. Add evidence ceremony only when it changes a decision.

1. Choose representative tasks; declare expected behaviour, sample count, supported models and harnesses, and the acceptance rule.
2. Run a baseline without the new guidance, or with the previous version for an edit.
3. Record the exact trigger miss, omission, wrong shape, bypass, or rationalisation; do not invent a failure the baseline did not show.
4. Classify the failure and write the smallest pointer, instruction, reference, or executable that addresses it.
5. Test in fresh contexts against a no-guidance or unchanged control. When variance matters, use independent samples. Judge convergence against the declared acceptance rule; divergent valid interpretations mean the wording is not binding. Read outputs rather than trusting counts alone.
6. Test discovery and execution separately with realistic variations and near-misses not used to draft the rule.
7. Use objective assertions for mechanical requirements and human review for judgement. Inspect traces where available; plausible output can hide a skipped rule or wasted work.
8. Test only authorised models and harnesses the document claims to support. Record untested scope; do not generalise beyond observed environments.
9. Remove guidance that does not improve behaviour and watch for regressions in valid flexibility, time, or context use.

For a new skill or material behaviour edit, follow `.goat-flow/skill-docs/skill-quality-testing/README.md`; its failing-test-first contract, fixtures, controls, scoring, and deployment gate own the method. Behaviour-neutral corrections use focused contract proof.

## Pruning and Maintenance

- **One owner.** Keep each meaning in one authoritative place; link or route instead of copying.
- **Decision value.** Keep context that changes where, how, or whether the agent acts. Test suspected no-ops against the current model and harness baseline; delete guidance that changes nothing.
- **Live sources.** Let configuration, schemas, code, tests, directory layout, and `--help` answer cheap questions. Remove stale paths, commands, terms, and branches.
- **One default.** Remove speculative alternatives; a possible branch is not automatically useful.
- **Preserve value.** Retain valid policy, audience, and ownership. Update coupled instructions, pointers, executables, and references together.
- **At the cap.** Run the ownership, no-op, relevance, branching, and disclosure checks before requesting more budget.

## When to Split

Splitting adds cognitive load and another pointer, so make the cut earn itself:

- **By branch** - cases need substantial, mutually irrelevant reference.
- **By sequence** - later steps measurably cause premature completion and a real context boundary can hide them.
- **By audience or authority** - human guidance, project policy, and adapter facts have different owners.
- **By invocation** - agent-reachable and human-invoked skills make different context-load trade-offs.
- **By determinism** - repeated exact work belongs in an executable resource.

Do not split at a round number or merge merely to reduce file count. Protect each invocation path.

Agent-reachable skills pay context load through discovery metadata; human-invoked skills make the human the index. Choose agent reach only when the agent or another skill must discover it. When human-invoked skills become difficult to recall, use one compact router rather than making every skill always discoverable.

## Troubleshooting

- **Target does not load:** read the pointer alone, sharpen its trigger branches, and retest near-misses.
- **Rule is ignored:** reclassify the baseline failure, use the matching contract form, and repeat the pressure test.
- **File exceeds budget:** remove no-ops and environment caches, then disclose branch reference or extract deterministic work.
- **Harnesses diverge:** move provider mechanics to the owning adapter, verify each target, and state the capability gap.

## Verification Gate

Walk this once against the actual draft before claiming the document is done.

1. The surface, audience, authority order, and source-of-truth map are clear.
2. Every always-loaded line changes behaviour, states a hard boundary, or routes to material that does.
3. Every pointer front-loads the trigger, names capability plus real branches, and does not summarise the hidden workflow.
4. The document has one default path; every alternative has an observable condition; prescription matches task fragility and the demonstrated failure.
5. Output-shaping rules state the positive contract; hard guardrails include the safe path and precise scope; real exceptions are conditional branches.
6. Every procedural step ends on a checkable, sufficiently demanding completion criterion.
7. Required workflow is inline; branch-specific detail is directly disclosed; deterministic work uses tested executables where appropriate.
8. Terms are stable, actions are portable, absolutes are scoped, and commands and paths were verified safely.
9. Each meaning lives in one place; environment caches, volatile state, stale guidance, duplication, and model-relative no-ops were removed.
10. Illustrative examples are labelled; leading words and strong behavioural claims cite a named basis or are framed as hypotheses.
11. A claimed behaviour improvement records its baseline or control, fresh-context tasks, sample count, acceptance rule, authorised models and harnesses, observed outcome, and untested scope. Discovery and execution were tested separately.
12. The body remains below the project budget; pruning and disclosure ran before any increase was proposed.
13. For a new skill or material behaviour edit, the quality-testing gate passed; behaviour-neutral corrections have focused proof.

## Related References

- `writing-human-facing-prose.md` - human-read prose; its Scope Gate exempts the agent-control surfaces this playbook owns.
- `skill-playbook-authoring-sync.md` - frontmatter, first-H2, registration, budget, and structural contract for a playbook; this playbook owns the behaviour inside that frame.
- `.goat-flow/skill-docs/skill-quality-testing/README.md` - failing-test-first methodology, fixtures, controls, evaluation evidence, and deployment gate for skills.
- `code-comments.md` - code comments and docstrings, which are neither human prose nor agent control text.
