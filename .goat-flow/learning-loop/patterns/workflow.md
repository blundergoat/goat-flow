---
category: workflow
last_reviewed: 2026-09-05
---

## Pattern: Phase-boundary PR template for oversize work

**Context:** A change exceeds practical review size (roughly 3,000 lines or 20+ files, or GitHub's "exceeds 20,000 lines" Copilot cap), a reviewer asks to chunk it, two unrelated concerns land together, or a CodeQL or Copilot finding count swamps the diff.

**Approach:** Split into a sequence of phase-boundary PRs (foundation, hardening, automation, polish). Each PR body carries three sections: what is in this PR (scope, features, line and file count); what is explicitly not in it, with each deferred item naming its destination PR and a one-line reason; and the manual contract until automation lands, meaning any instruction-file edits that tell agents to invoke a primitive by hand until the driver PR ships. Link the full phase plan from the first PR; later PRs repeat the structure with a shrinking deferred list.

**Evidence (EXTERNAL_REFERENCE):** awslabs/cli-agent-orchestrator #179 was split into eight phase-boundary PRs starting at #245; the structure made per-phase review possible where the monolith was unreviewable.

## Pattern: Deny-rule grammar matrix before mirror fanout

**Context:** Adding or changing a deny hook rule for an external CLI with subcommands, inherited flags, or pipeline use.

**Approach:** Before syncing hook mirrors, write paired block and allow tests that cover the command grammar, not only the incident command. For each recognised option record whether it stands alone, consumes the next value, accepts an attached short value, or accepts an equals value, and verify that table against the installed CLI's `--help` or manual before coding. Cover direct forms, flags before and after subcommands, short forms, supported wrappers, pipeline consumers, API write methods, and read-only controls; probe overlapping short and long options directly. Run ShellCheck and the canonical full self-test before copying, then require byte parity and the installed full self-test.

**Evidence (ACTUAL_MEASURED, 2026-08-10):** GNU Parallel's `--halt` was first treated as a standalone flag although the manual defines a required value, and a Bash short-option glob shadowed `--rcfile`; ShellCheck exposed the overlap, and direct probes showed the first correction still missed `-c` and `-cl`. Anchors: `workflow/hooks/deny-dangerous.sh` (search: `--halt`), `workflow/hooks/deny-dangerous/patterns-shell.sh` (search: `A short option bundle containing`), `workflow/hooks/deny-dangerous/deny-dangerous-self-test.sh` (search: `parallel halt value before`).

## Pattern: Dry-run readiness belongs beside the command

**Context:** A command can write files, launch terminals, mutate harness config, or ask an agent to act.

**Approach:** Give that command its own dry-run or readiness output instead of one release-wide readiness surface. The preview runs the same admission and planning code as real execution so both report identical blockers and remediation, lists the exact paths and actions, and never prints secrets, raw prompts, scrollback, or file contents. Anchors: `src/cli/install-invocation.ts` (search: `Use for both dry-run admission and real execution`), `src/cli/learn-scaffold.ts` (search: `Dry-run performs every check above`).

## Pattern: Skill-playbook structural template

**Context:** Authoring a new playbook under `workflow/skills/playbooks/` (source) and `.goat-flow/skill-docs/playbooks/` (installed copy).

**Approach:** Do not draft from memory of an older playbook; the shape is owned and enforced elsewhere. Read `.goat-flow/skill-docs/playbooks/skill-playbook-authoring-sync.md` (search: `## Required Shape`) for the frontmatter, the rule that `## Availability Check` is the first H2, and the body a cold-start agent needs: intent, boundaries, workflow, verification, troubleshooting, related references. Two contract tests enforce it: `test/unit/playbook-contract.test.ts` (search: `fails when Availability Check is not the first H2`) and, for discipline playbooks, the `## Project Authority` requirement in `test/contract/playbook-precedence-doctrine.test.ts` (search: `AUTHORITY_PLAYBOOKS`). Then enrol the file in every surface listed by `.goat-flow/learning-loop/footguns/lockstep-surfaces.md` (search: `Adding a skill-playbook requires lock-step updates`); that list has grown past its original thirteen, and the footgun, not this entry, is the count of record. The most common defect is a playbook without an Availability Check or an Intent: the first fails its own purpose, the second becomes a wall of reference with no decision shape.

## Pattern: Gruff docs cleanup is a tight analyzer loop

**Context:** Fixing `gruff-ts` documentation findings by adding maintainer comments, especially `docs.missing-*`, `docs.magic-threshold-without-rationale`, `docs.missing-error-behavior-doc`, or `docs.missing-why-for-complex-code`.

**Approach:** Read `.goat-flow/skill-docs/playbooks/code-comments.md`, patch one file or cohesive cluster, then rerun `npx gruff-ts analyse <path>`. Treat remaining docs findings as comment-quality feedback; use analyzer-recognised words for error behaviour, complexity rationale, thresholds, and side-effect boundaries.
