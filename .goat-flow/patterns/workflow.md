---
category: workflow
last_reviewed: 2026-05-24
---

## Pattern: Blocked ≠ impossible
**Context:** A deny hook blocks a command.
**Approach:** Deny hooks block dangerous patterns, not all operations. When a command is blocked, spend 2 seconds thinking about the safe alternative before asking the user or giving up. `rm -rf dir/` → `rm dir/file && rmdir dir/`. `mv old new` → `mv -n old new`.

## Pattern: Deny-rule grammar matrix before mirror fanout
**Context:** Adding or changing a deny hook rule for an external CLI with subcommands, inherited flags, or pipeline use.
**Approach:** Before syncing hook mirrors, write self-tests that cover the command grammar, not only the incident command. Include: direct write form, global flags before the topic, inherited flags after the topic, short flag forms, wrapper prefixes (`env`, `command`, `sudo` when supported), pipeline consumers (`xargs`), API write-method forms, and at least one read-only allow control. Then run the canonical self-test before copying to installed hooks.

## Pattern: Dry-run readiness belongs beside the command
**Context:** A command can write files, launch terminals, mutate harness config, or ask an agent to act.
**Approach:** Add readiness or dry-run output at the command boundary instead of shipping one release-wide readiness surface. The preview must reuse the same planner/fact pipeline as real execution, list exact paths/actions, emit a verdict such as `ready | warning | blocked | unsupported`, and avoid secrets, raw prompts, scrollback, or file contents. If preview and execution can diverge, share the execution planner before shipping the command.

## Pattern: Skill-playbook structural template
**Context:** Authoring a new playbook for `workflow/skills/playbooks/` (browser-use, page-capture, observability, code-comments, changelog, release-notes, skill-quality-testing are the established examples).
**Approach:** Follow the canonical playbook shape so readers (humans and agents) can find what they need by section heading without scanning the body:

1. **Frontmatter:** YAML with `goat-flow-reference-version` matching the current release. No other fields.
2. **Title + 1-2 paragraph intent.** First paragraph: "Use this when ..." plus the WHAT. Second paragraph (optional): cross-references to sibling playbooks or scope boundaries.
3. **`## Availability Check`** (required, first section). For runnable tools: the exact `command -v <tool>` or equivalent verification. For non-runnable discipline references: bullet list of load conditions and an explicit note that no CLI check applies. This is the section agents grep for before declaring a tool unavailable.
4. **`## Intent`.** The one big idea: who the customer is, what question they have, what failure mode the playbook prevents. Names the audience (often "a future maintainer with none of your context").
5. **Body sections.** Discipline-specific - decision ladders, decision tables, when-to-use cases, anti-cases. Use code blocks for examples; bad-then-good is the conventional pairing.
6. **`## Antipatterns`.** Bullet list of patterns to avoid, each one with the cost it has actually paid (not hypothetical). One-line bullets if the antipattern is self-explanatory; short paragraph if it needs context.
7. **`## Verification Gate`.** Numbered checklist a reviewer (or the author at completion time) walks before claiming the work satisfies the playbook. Each item maps to one rule in the body.
8. **`## Troubleshooting`** (optional). Q&A-shaped responses to common confusions when applying the playbook.
9. **`## Related References`.** Cross-links to sibling playbooks, external standards (semver.org, keepachangelog.com, OTel docs), and project-internal docs (CLAUDE.md, ADRs).

Add the new playbook to all 13 surfaces named in `.goat-flow/footguns/docs-and-crossrefs.md` (search: `Adding a skill-playbook requires lock-step updates`) before declaring done. Skipping the body sections (3) and (4) is the most common defect - playbooks without an Availability Check fail their own purpose; playbooks without an Intent become reference walls of text with no decision-shape.
