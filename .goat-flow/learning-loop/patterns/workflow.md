---
category: workflow
last_reviewed: 2026-08-10
---

## Pattern: Phase-boundary PR template for oversize work
**Context:** A change exceeds practical PR review size (~3000 lines or 20+ files, or GitHub's "exceeds 20,000 lines" Copilot cap) or naturally divides into phases (foundation -> hardening -> automation -> polish). Single-PR review collapses under the volume; reviewers skim or defer.
**Approach:** Split into a sequence of phase-boundary PRs. Each PR body MUST include three explicit sections:

1. **What's in this PR** - shipped scope, named features, line/file count.
2. **What's explicitly NOT in this PR** - each deferred item names its destination PR with a one-line rationale (e.g. `SQLite metadata layer -> PR #2 (Phase 2)`).
3. **Manual contract until automation lands** - any instruction-file or doc edits that paper over the gap until the next phase ships. If Phase 1 ships primitives without the auto-driver, the agent profile gets a section telling agents to invoke the primitive explicitly until the driver PR lands.

Cross-link the full phase plan from PR #1 so reviewers can trace the sequence without hunting. Each subsequent PR repeats the structure with the cumulative "still deferred" list shrinking.

Trigger checklist: (1) GitHub returns "exceeds 20,000 lines"; (2) reviewer asks to chunk; (3) two unrelated concerns landing together (e.g. storage layer + auto-injection hooks); (4) a CodeQL/Copilot finding count that swamps the diff. Reference: awslabs/cli-agent-orchestrator #179 was split into 8 phase-boundary PRs starting with #245; the structure made independent review per phase possible where the monolith was unreviewable. (search: `What's explicitly NOT in this PR`)

## Pattern: Deny-rule grammar matrix before mirror fanout
**Context:** Adding or changing a deny hook rule for an external CLI with subcommands, inherited flags, or pipeline use.
**Approach:** Before syncing hook mirrors, write paired block and allow tests that cover command grammar, not only the incident command. For each recognized option, record whether it is a standalone flag, consumes the next value, accepts an attached short value, or accepts an equals value. Verify that table against the installed CLI's `--help` or local manual before coding. Include direct forms, flags before and after subcommands, short forms, supported wrappers, pipeline consumers, API write methods, and read-only controls. Probe overlapping short and long options directly. Run ShellCheck and the canonical full self-test before copying, then require byte parity and the installed full self-test.

**Observed refinement (2026-08-10):** GNU Parallel's `--halt` was initially treated as a standalone flag even though the local manual defines a required value. A Bash short-option glob also shadowed `--rcfile`; ShellCheck exposed that overlap, and direct option probes showed that the first correction missed `-c` and `-cl`. Evidence anchors: `workflow/hooks/deny-dangerous.sh` (search: `--halt`), `workflow/hooks/deny-dangerous/patterns-shell.sh` (search: `A short option bundle containing`), and `workflow/hooks/deny-dangerous/deny-dangerous-self-test.sh` (search: `parallel halt value before git push`).

## Pattern: Dry-run readiness belongs beside the command
**Context:** A command can write files, launch terminals, mutate harness config, or ask an agent to act.
**Approach:** Add readiness or dry-run output at the command boundary instead of shipping one release-wide readiness surface. The preview must reuse the same planner/fact pipeline as real execution, list exact paths/actions, emit a verdict such as `ready | warning | blocked | unsupported`, and avoid secrets, raw prompts, scrollback, or file contents. If preview and execution can diverge, share the execution planner before shipping the command. (search: `dry-run`)

## Pattern: Skill-playbook structural template
**Context:** Authoring a new playbook for `workflow/skills/playbooks/` (browser-use, page-capture, observability, code-comments, changelog, release-notes, skill-quality-testing are the established examples).
**Approach:** Follow the canonical playbook shape so readers (humans and agents) can find what they need by section heading without scanning the body:

1. **Frontmatter:** YAML with `goat-flow-reference-version` matching the current release. No other fields.
2. **Title + 1-2 paragraph intent.** First paragraph: "Use this when ..." plus the WHAT. Second paragraph (optional): cross-references to sibling playbooks or scope boundaries.
3. **`## Availability Check`** (required and grep-findable before any tool-dependent workflow). For runnable tools: the exact `command -v <tool>` or equivalent verification. For non-runnable discipline references: bullet list of load conditions and an explicit note that no CLI check applies. Agents grep for this section before declaring a tool unavailable; it does not have to be the first H2 when a routing or boundary section earns the top slot.
4. **`## Intent`.** The one big idea: who the customer is, what question they have, what failure mode the playbook prevents. Names the audience (often "a future maintainer with none of your context").
5. **Body sections.** Discipline-specific - decision ladders, decision tables, when-to-use cases, anti-cases. Use code blocks for examples; bad-then-good is the conventional pairing.
6. **`## Antipatterns`.** Bullet list of patterns to avoid, each one with the cost it has actually paid (not hypothetical). One-line bullets if the antipattern is self-explanatory; short paragraph if it needs context.
7. **`## Verification Gate`.** Numbered checklist a reviewer (or the author at completion time) walks before claiming the work satisfies the playbook. Each item maps to one rule in the body.
8. **`## Troubleshooting`** (optional). Q&A-shaped responses to common confusions when applying the playbook.
9. **`## Related References`.** Cross-links to sibling playbooks, external standards (semver.org, keepachangelog.com, OTel docs), and project-internal docs (CLAUDE.md, ADRs).

Add the new playbook to all 13 surfaces named in `.goat-flow/learning-loop/footguns/docs-and-crossrefs.md` (search: `Adding a skill-playbook requires lock-step updates`) before declaring done. Skipping the body sections (3) and (4) is the most common defect - playbooks without an Availability Check fail their own purpose; playbooks without an Intent become reference walls of text with no decision-shape.

## Pattern: Gruff docs cleanup is a tight analyzer loop
**Context:** Fixing `gruff-ts` documentation findings by adding maintainer comments, especially `docs.missing-*`, `docs.magic-threshold-without-rationale`, `docs.missing-error-behavior-doc`, or `docs.missing-why-for-complex-code`.
**Approach:** Read `.goat-flow/skill-docs/playbooks/code-comments.md`, patch one file or cohesive cluster, then rerun `npx gruff-ts analyse <path>`. Treat remaining docs findings as comment-quality feedback; use analyzer-recognized words for error behavior, complexity rationale, thresholds, and side-effect boundaries.
