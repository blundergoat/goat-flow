---
goat-flow-reference-version: "1.17.0"
---
# Critique Rubric Examples (Reference Pack)

*Extracted from the goat-critique SKILL.md to stay within the 2500-word skill cap. Artifact rubrics remain in SKILL.md; the canonical meta-audit rubric, worked examples, and context maps live here.*

## Rubric Context Maps

Each map lists additions to the fixed Context split in `SKILL.md` and never replaces it. Agents A and B keep their artifact, architecture, and rubric baseline; an empty C list means no additional project context, so C still receives the supplied artifact + selected rubric payload only. Footgun/lesson entries mean targeted INDEX-first hits from those buckets, not whole-directory reads. Every map uses **Fresh-eyes boundary and recovery** in `sub-agent-directives.md`; none grants additional C reads. Generic fallback uses the default split plus the additions below.

### Plan
- **A:** targeted INDEX-first footgun/lesson hits, `.goat-flow/learning-loop/decisions/`
- **B:** `.goat-flow/plans/.active`, `git log --oneline -20`, milestone logs
- **C:** [] (no additional project context)

### Security assessment
- **A:** targeted INDEX-first footgun/lesson hits, threat-model docs, `.goat-flow/learning-loop/decisions/`
- **B:** `git log --oneline -20`, config.yaml, dependency manifests
- **C:** [] (no additional project context)

### Debug hypotheses
- **A:** targeted INDEX-first footgun/lesson hits, `.goat-flow/logs/sessions/`
- **B:** `git log --oneline -20`, config.yaml, test output
- **C:** [] (no additional project context)

### Review findings
- **A:** targeted INDEX-first footgun/lesson hits, `.goat-flow/learning-loop/decisions/`
- **B:** `git log --oneline -20`, config.yaml, CI logs
- **C:** [] (no additional project context)

### Test strategy
- **A:** targeted INDEX-first footgun/lesson hits, `.goat-flow/learning-loop/decisions/`
- **B:** `git log --oneline -20`, config.yaml, test manifests
- **C:** [] (no additional project context)

### Architecture/refactor
- **A:** targeted INDEX-first footgun/lesson hits, `.goat-flow/learning-loop/decisions/`, dependency maps
- **B:** `git log --oneline -20`, config.yaml, module boundaries
- **C:** [] (no additional project context)

### Generic (fallback)
- **A:** targeted INDEX-first footgun/lesson hits
- **B:** `git log --oneline -20`, config.yaml
- **C:** [] (no additional project context)

## Worked examples

> **Illustrative scenario - input/output shape only; never evidence.** Every artifact path, finding, command outcome, and prior-log id below is a placeholder. Live critique must substitute target-project files plus semantic anchors re-read in the current session.

### Full phase walkthrough: Phase 2 context-leak edge case

- **Artifact:** supplied inline `skills/goat-example/SKILL.md` content, including its Tests section.
- **Rubric:** Generic fallback, supplied inline with an `architecture.md#scope` identity.
- **Agent C output under review:** references to those two supplied identities and the ordinary word tests.
- **Phase 2 actions:** scan the response through stdin; trace both candidate references to the payload and disregard tests as navigation.
- **Expected Phase 2 result:** accept the references, record exposed activity or its absence, then check completeness. A clean scan alone proves no isolation.
- **Leak variant:** an observed unauthorized read ends C's use. Discard its return and use the shared replacement counter; never restart that child.

### Example: Plan rubric critique output

```markdown
## Finding: Verification belongs after execution, not only during synthesis
- **Finding ID:** F-01 | **Severity:** HIGH | **Confidence:** HIGH
- **Evidence:** `<target-project>/plan.md` (search: "Verification gate") - current-session size and version checks found state drift after the draft plan was written
- **Proof attempt:** Re-read the target plan's verification gate and ran the named current-state checks
- **Proof class:** STATIC
- **Evidence quality:** OBSERVED
- **SKEPTIC:** A plan can look internally consistent while the repo has drifted underneath it
- **ANALYST:** The failure appeared only when live commands re-checked the current files, so synthesis alone was insufficient
- **STRATEGIST:** Keep an execution-adjacent verification gate and cite the command output before closing the milestone
- **Rubric dimensions:** validation coverage [O], sequencing quality [M]
```

### Example: Architecture/refactor rubric critique output

```markdown
## Finding: Quick critique fallback would break the skill mechanism
- **Finding ID:** F-02 | **Severity:** HIGH | **Confidence:** HIGH
- **Evidence:** `<target-project>/decisions/critique-mode.md` (search: "delegated critique mode") - the current decision binds critique to isolated agents rather than inline role-play
- **Proof attempt:** Re-read the target decision and confirmed that it rejects a quick inline fallback
- **Proof class:** STATIC
- **Evidence quality:** OBSERVED
- **SKEPTIC:** Reintroducing quick mode would make the output promise multi-perspective critique without isolated contexts
- **ANALYST:** `/goat-review` already covers lightweight single-context review, so the fallback duplicates another skill and weakens this one
- **STRATEGIST:** Keep goat-critique full-delegated and route low-ceremony requests to goat-review
- **Rubric dimensions:** blast radius accuracy [M], migration safety [M], dependency impact [O]
```

### Example: Differential mode delta block (Phase 5 Verdict)

When Step 0 detects a same-artifact critique log within 30 days and differential mode is active, Phase 5 appends a delta block to the Verdict comparing this run against the prior one. Worked example for a plan re-critiqued after the author resolved two findings and added a milestone:

```markdown
## Verdict
- **Gate:** CONCERNS  <!-- one HIGH survives -->
- **Delta vs prior critique [diff-of: a1b2c]:** Resolved: 2 | Regressed: 0 | New: 1 | Unchanged: 1
```

- **Resolved (2):** the prior MILE-03 sequencing gap and the missing rollback step are absent from the current artifact.
- **New (1):** the added milestone introduces an untested integration boundary (HIGH) - this drives the CONCERNS gate.
- **Unchanged (1):** the prior MEDIUM on task specificity persists.
- Counts come from matching this run's findings against the prior log's findings by title/anchor; `[diff-of: a1b2c]` cites the `<rand5>` slug of the prior critique's filename.

## Meta-audit rubric (Phase 5.5)

The meta-agent scores the draft critique against these 10 checks. Award 10 only when a check is fully satisfied, otherwise 0; partial credit is forbidden. `Meta-score` is the sum. Name every failed check under `## Auto-Detected Issues`. When all 10 checks pass, write exactly `No failed meta-audit checks.` A clean attestation is not an issue and must not be expanded into one.

The meta-agent grades the packet it is handed and nothing else. It does not open the artifact, the main skill or the project. Every term the ten rules use is therefore defined here, and the packet carries the draft, the selected dimensions, the final-finding schema, the vocabulary below and these ten rules.

### Packet vocabulary

- **Title:** the finding's short defect statement. It may sit inline in the finding record rather than as a separately labelled field; check 2 grades that a reader can state what the defect is, not where the words sit.
- **Severity, highest to lowest:** CRITICAL, HIGH, MEDIUM, LOW. The producing agent sets it; check 8 grades whether comparable evidenced effects were rated consistently within this one report, never whether a rating is correct in the abstract.
- **Proof class, one of:** `RUNTIME`, `CONTRACT-GREP`, `STATIC`, `NOT-REPRODUCED`. Records how the claim was checked.
- **Evidence quality, one of:** `OBSERVED`, `INFERRED`, `UNVERIFIED`, `HUMAN-PENDING`. Records the claim's evidential support, independently of proof class and confidence.
- **Confidence, one of:** HIGH, MEDIUM, LOW. Records the certainty judgment, not the evidence's provenance or support label.
- **Per-finding fields check 2 requires,** and this list governs: Finding ID, title, severity, rubric dimensions, evidence anchor, Proof attempt, Proof class, Evidence quality, confidence, the three lens fields SKEPTIC, ANALYST and STRATEGIST, Host verification and Source agent IDs. A lens field may read `N/A` with a reason. Recommended action is required only when the finding warrants one; otherwise its omission does not fail check 2. The Final-finding schema defines those additions.
- **[M] and [O]:** a selected dimension is mandatory or optional. Check 3 grades honesty identically for both: an [M] dimension may be `unassessed` when the row gives a reason and the next evidence needed.
- **Not graded here:** the report's Risk level, its section layout and names, the wording or naming of a hook, whether a surviving finding also appears under recommendations, and how confidence relates to Evidence quality. The ten checks grade only what they name. Report a rule you cannot find rather than assuming one.

| # | Check | Complete passing rule |
|---|---|---|
| 1 | **Gate-finding match** | Any CRITICAL gives BLOCK; HIGH without CRITICAL gives CONCERNS; otherwise CLEAN |
| 2 | **Evidence quality per finding** | Every final finding retains every field in the Packet vocabulary's per-finding list, including Proof attempt, Proof class and Evidence quality |
| 3 | **Rubric coverage completeness** | Every selected dimension has an honest disposition and supporting evidence or a stated limitation; incomplete inspection is not an artifact defect |
| 4 | **Recommendation actionability** | Each recommendation traces to a surviving finding ID and gives a concrete next action |
| 5 | **Retraction rationale** | Every retraction identifies the discarded finding ID and why it was withdrawn |
| 6 | **Contradictions** | Mutually exclusive claims are reconciled or explicitly left unresolved, without contradictory recommendations |
| 7 | **Top-blocker traceability** | Every top blocker or concern maps to the corresponding surviving finding ID and its severity |
| 8 | **Severity consistency** | Comparable evidenced effects receive consistent severity, with any material difference explained |
| 9 | **Integration hooks** | Every hook maps to a surviving finding ID; a finding may carry zero or multiple applicable hooks |
| 10 | **Blind-spot statement** | The section names actual limits, or a supported none-identified statement within a declared scope |

Check 3 grades honesty, not completeness of inspection: an `unassessed` row with a reason and the next evidence needed passes. Check 9 grades traceability, not cardinality: a finding with no applicable hook and a finding with three both pass, and only a hook citing no surviving finding fails. Check 10 accepts a none-identified statement bounded by a declared scope and fails an empty section or an invented limit.

The meta-score measures how well the report conforms to these rules. It is not a measure of artifact correctness, and it never certifies that inspection was exhaustive.

## Final-finding schema

A finding that survives into the final report keeps every field the producing agent supplied and adds:

- **Host verification:** what the host re-read or re-ran to keep the finding, and the outcome. This is the host's own record, never a human disposition; `accepted`, `rejected`, `deferred` and `partial` belong only to outcomes captured after the human responds.
- **Source agent IDs:** which of A, B and C raised it, so convergence is visible without counting votes.
- **Recommended action:** a concrete next step, when the finding warrants one. Recommendations cite finding IDs rather than restating findings.

Merged findings map their retired IDs to the surviving ID. Retracted findings keep their ID with the reason for withdrawal, so a reader can tell a merge from a retraction.

## Audit payload identity

The audit payload is the complete final report content before the meta result is added. It is identified by the run ID and a `report_revision`; the meta-agent's return names the `audited_revision` it graded. Score and Auto-Detected Issues are the wrapper that results from the audit and are excluded from the payload, so the audit never grades a score that did not yet exist.

Freeze the payload for the initial two-call meta-agent. One host correction batch may create the next `report_revision` and receive one fresh two-call recheck. Stop after that recheck and retain any unresolved conformance failure at the human gate.

Adding the unchanged wrapper does not invalidate a score. Changing findings, gate, coverage or recommendations does. If later editing or redaction changes audited content, recheck within that same allowance or present the revision as unaudited and keep the old score only as history. Never award a new score by host calculation and never silently reuse the old one. Missing artifact proof is withdrawn or stays a limitation; a wording fix cannot supply evidence.
