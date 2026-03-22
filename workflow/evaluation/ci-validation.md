# Prompt: Create CI Context Validation Workflow

Paste this into your coding agent to create the GitHub Actions workflow that validates your AI workflow configuration on every PR.

---

## The Prompt

```
Create a GitHub Actions CI workflow that validates the AI workflow
configuration on every pull request. This catches drift - CLAUDE.md
growing past the line target, broken router references, missing skills.

Create .github/workflows/context-validation.yml:

name: Context Validation

on:
  pull_request:
    paths:
      - 'CLAUDE.md'
      - 'AGENTS.md'
      - '.claude/**'
      - '.github/instructions/**'
      - 'docs/footguns.md'
      - 'docs/lessons.md'

The workflow should run these checks:

1. CLAUDE.md line count
   - Target: 120 lines for all projects, hard limit 150.
     Warn if >120, error if >150.
   - Report the current line count in the workflow summary

2. AGENTS.md line count (if exists)
   - Warn if >150 (Codex files run larger, no strict target)

3. Router table references resolve
   - Extract file paths from the router table section of CLAUDE.md
   - Verify each referenced file exists (test -f)
   - Report missing references as errors

4. Skills directories have SKILL.md
   - For each directory in .claude/skills/, verify SKILL.md exists
   - Report missing SKILL.md files as errors

5. Local CLAUDE.md files are under 20 lines
   - Find all CLAUDE.md files that aren't the root one
   - Verify each is under 20 lines
   - Report violations as warnings

6. Footguns have evidence (if docs/footguns.md exists)
   - Check that docs/footguns.md contains at least one file: or line:
     reference pattern
   - Warn if zero evidence references found

7. Pending review flag check
   - Grep docs/footguns.md and docs/lessons.md for the string
     "> [!WARNING] AI-GENERATED: UNVERIFIED"
   - FAIL if found (agent-authored entries must be reviewed before merge)
   - WARN for entries with this flag older than 14 days

8. Layer 2 staleness and contradiction detection
   - Find all local instruction files (*/CLAUDE.md, .github/instructions/*.md)
   - WARN if any local file hasn't been modified in 90+ days but the
     directory it covers has been actively changed (check git log)
   - WARN if two local files contain contradictory guidance
   - WARN if a local file duplicates content from the root instruction file

Use bash steps (no external actions needed). Each check should output
a clear pass/fail with details. The workflow should fail (exit 1) if
any error-level check fails. Warnings should be reported but not fail
the workflow.

VERIFICATION:
- Verify the workflow YAML is valid
- Verify it triggers on the correct paths
- Verify each check produces clear output
- Report: number of checks implemented
```
