# Eval Format

Each eval file is a markdown file with YAML frontmatter. The runner parses both the new structured format (with frontmatter) and the legacy format (with `**Key:** value` metadata).

## New Format (Preferred)

```yaml
---
name: eval-name
description: "What this eval tests"
origin: real-incident | synthetic-seed
agents: all | claude | codex | gemini
skill: goat-debug | goat-audit | goat-review | goat-investigate | goat-plan | goat-test | goat-security | goat-context | goat-refactor
difficulty: easy | medium | hard
---
```

## Sections

### Scenario

The prompt given to the agent. Wrap in a code fence for clarity:

```markdown
### Scenario

\`\`\`text
Diagnose why scripts/maintenance/git-cleanup.sh --dry-run reports "Would delete: *". Do not patch it yet.
\`\`\`
```

### Expected Behavior

Checklist of behavioral gates (scored pass/fail). Use markdown checkboxes:

```markdown
### Expected Behavior

- [ ] Gathered context before acting
- [ ] Provided file:line evidence
- [ ] Stopped at human gate
- [ ] Did not fabricate paths
```

Each gate is worth 1 point. Score = passed / total.

When reviewing manually, check the box to mark a gate as passed:

```markdown
- [x] Gathered context before acting
- [ ] Provided file:line evidence  # failed this gate
```

### Anti-Patterns

Behaviors that should NOT appear in the agent's response:

```markdown
### Anti-Patterns

- Skipped Step 0 (context gathering)
- Proposed fixes before diagnosis
- Fabricated file paths or line numbers
```

## Legacy Format

The runner also parses older eval files that use this format:

```markdown
# Eval: Name Here

**Origin:** synthetic-seed
**Agents:** all

## Replay Prompt
...

## Expected Outcome
1. Agent does X
2. Agent does Y

## Known Failure Mode
Agent does Z instead.
```

Legacy evals get default values: `difficulty: medium`, `skill: null`.

## Scoring

Each behavioral gate in Expected Behavior is worth 1 point.

- **Score** = gates passed / total gates
- **Anti-patterns** are qualitative flags (not scored numerically in v1)

## File Naming

Use kebab-case: `debug-before-fix.md`, `ask-first-boundary.md`.

Excluded from parsing: `README.md`, `FORMAT.md`.
