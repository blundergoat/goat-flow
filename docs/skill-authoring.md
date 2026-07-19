# Skill Authoring

goat-flow has two authoring surfaces:

| Surface | Use for | Writes files? |
|---|---|---|
| `goat-flow quality candidacy` | Decide what kind of artifact a draft or description should become. | No |
| `goat-flow skill new` | Scaffold a skill or playbook from a description or validate a draft location. | Skills require accepted RED evidence and confirmation; playbooks require confirmation |
| Dashboard `Evaluate skill` | Score pasted/uploaded markdown and get improvement tips. | No |

## Decide First

Use candidacy before drafting when the artifact shape is unclear.

```bash
node --import tsx src/cli/cli.ts quality candidacy "I want a workflow that audits Postgres indexes before deploy"
node --import tsx src/cli/cli.ts quality candidacy --draft ./draft.md
```

The result recommends one of:

| Recommendation | Meaning |
|---|---|
| `skill` | A first-class workflow, dispatcher, or report skill. |
| `reference` | A reusable playbook, index, or meta reference. |
| `instruction-file` | A short rule for `AGENTS.md` / `CLAUDE.md` style instructions. |
| `learning-loop` | A lesson, footgun, pattern, or decision. |
| `cli-command` | A deterministic one-shot command may be enough. |
| `do-not-create` | Too vague, duplicate, or one-time work. |

Candidacy is deterministic. Borderline LLM-assisted candidacy is intentionally deferred.

## Choose The Artifact

Use the smallest durable artifact that fits the evidence:

| Candidate shape | Route to | Evidence required |
|---|---|---|
| First-class workflow with Step 0, modes, blocking gates, or reports | goat-* skill | Repeated cross-task behavior that needs an invocation workflow |
| Tool/capability runbook loaded on demand | `.goat-flow/skill-docs/playbooks/<name>.md` | Availability Check, boundary, workflow, fallback, verification gate |
| Shared doctrine every skill inherits | `.goat-flow/skill-docs/` | Cross-skill invariant plus ADR-023 word-budget headroom |
| Real incident or permanent caution | learning-loop lesson/footgun/pattern/decision | Actual evidence and prevention text |
| Short project rule | instruction file | Hot-path rule that must always be visible |
| Deterministic transform or validation | CLI/check/script | Repeatable operation better enforced by code |
| One-off or speculative advice | no new artifact | No repeated evidence yet |

Before editing shared references or playbooks, check the ADR-023 tier. Always-loaded shared references must stay under 1500 body words; top-level playbooks and progressive topical files must stay under 3000 body words.

## Scaffold From Description

For a skill, run the failing scenario before scaffolding and capture the RED
receipt at `.goat-flow/logs/sessions/YYYY-MM-DD-<name>-tdd.md`. The receipt must
record a concrete scenario, three distinct documented pressure types, an
explicit failing agent outcome, and one non-placeholder quoted rationalisation
inside its first RED iteration. Pure playbook/reference scaffolds do not use
this pressure gate.

```bash
node --import tsx src/cli/cli.ts skill new \
  "I want a workflow that reviews risky database migrations before deploy" \
  --name db-migration-review \
  --red-log .goat-flow/logs/sessions/2026-07-17-db-migration-review-tdd.md \
  --agent codex
```

The command runs candidacy first. A skill recommendation stops without writing
when `--red-log` is absent or invalid. Once the RED receipt passes, or when the
recommendation is a playbook, the command prints the destination and preview and
asks for confirmation. Use `--yes` for non-interactive flows.

Destinations:

| Artifact | Destination |
|---|---|
| Skill with `--agent <id>` | The selected manifest profile's skill directory, such as `.agents/skills/<name>/SKILL.md` for Codex or `.claude/skills/<name>/SKILL.md` for Claude. |
| Skill without `--agent` | `.claude/skills/<name>/SKILL.md` (backward-compatible default). |
| Playbook/reference | `.goat-flow/skill-docs/playbooks/<name>.md` |

The command does not edit `workflow/manifest.json`.

An untouched generated skill is a placeholder, so the command does not show a
numeric quality score after writing it. Human and JSON output cite the accepted
RED receipt and defer scoring until GREEN, REFACTOR, and STAY GREEN have run.

## Validate A Draft

```bash
node --import tsx src/cli/cli.ts skill new --draft ./draft.md
```

Draft mode never writes. It runs candidacy, compares the artifact shape to the selected agent profile's skill directory, and prints a move suggestion when the draft belongs somewhere else. For an installed `<name>/SKILL.md`, it derives the artifact name from the parent directory and returns that exact draft's current score in both human and JSON output; a same-name copy for another agent is not substituted. Omitting `--agent` retains the Claude default.

## Interactive Mode

```bash
node --import tsx src/cli/cli.ts skill new --interactive \
  --name example-skill \
  --red-log .goat-flow/logs/sessions/2026-07-17-example-skill-tdd.md
```

Interactive mode asks for the description and confirmation; omit `--name` when
the log basename already matches the name you will enter at its prompt. Skill
recommendations use the same `--red-log` gate as description mode.

## Dashboard Evaluation

Open the Skills page and click **Evaluate skill**. Paste markdown, upload one file, or drag a small multi-file bundle. The dashboard posts to `POST /api/quality/evaluate`, returns a deterministic score, and renders improvement tips mapped to the metric breakdown.

The modal is read-only. It does not scaffold, move, or save files.

## Authoring Checks

After creating or changing a skill, run:

```bash
node --import tsx --test test/unit/skill-quality/*.test.ts
node --import tsx --test test/integration/skill-author.test.ts
node --import tsx --test test/integration/dashboard-server.test.ts
```

For release work, run the full preflight gate.
