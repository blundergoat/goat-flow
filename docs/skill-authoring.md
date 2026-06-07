# Skill Authoring

goat-flow has two authoring surfaces:

| Surface | Use for | Writes files? |
|---|---|---|
| `goat-flow quality candidacy` | Decide what kind of artifact a draft or description should become. | No |
| `goat-flow skill new` | Scaffold a skill or playbook from a description or validate a draft location. | Only after confirmation |
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

## Scaffold From Description

```bash
node --import tsx src/cli/cli.ts skill new \
  "I want a workflow that reviews risky database migrations before deploy" \
  --name db-migration-review
```

The command runs candidacy first. If the result is a skill or playbook, it prints the destination and a preview, then asks for confirmation before writing. Use `--yes` for non-interactive flows.

Default destinations:

| Artifact | Destination |
|---|---|
| Skill | `.claude/skills/<name>/SKILL.md` |
| Playbook/reference | `.goat-flow/skill-docs/playbooks/<name>.md` |

The command does not edit `workflow/manifest.json`.

## Validate A Draft

```bash
node --import tsx src/cli/cli.ts skill new --draft ./draft.md
```

Draft mode never writes. It runs candidacy, compares the artifact shape to the file location, and prints a move suggestion when the draft belongs somewhere else.

## Interactive Mode

```bash
node --import tsx src/cli/cli.ts skill new --interactive
```

Interactive mode asks for description, name, and confirmation. It uses the same candidacy and scaffold logic as description mode.

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
