# Skill Quality Config

goat-flow ships a zero-config skill-quality rubric. Consumer projects can override parts of it through `.goat-flow/config.yaml` under `quality:` without editing `workflow/manifest.json`.

Use config only when the project has real conventions that differ from goat-flow defaults: custom artifact roots, different verification-gate vocabulary, project-specific subtype profiles, or extra fixture corpora.

## Minimal Example

```yaml
# .goat-flow/config.yaml
quality:
  gate-vocabulary:
    verification-gate:
      - BLOCKING GATE
      - Release Gate
      - SLO Gate
  additional-fixtures:
    - test/fixtures/skill-quality/team-expected-scores.json
```

With no `quality:` block, the default rubric is unchanged.

## Custom Existing Subtype

Customize an existing subtype when the project has a repeatable artifact shape that should adjust goat-flow's default scoring or detection rules. The current evaluator supports these subtype keys: `workflow`, `dispatcher`, `report`, `playbook`, `index`, and `meta`.

```yaml
quality:
  subtypes:
    report:
      detection:
        kinds:
          - skill
        heading-patterns:
          - "^## Audit Mode\\b"
        must-not-have:
          - "^## Step 0\\b"
        name-patterns: []
      profile:
        trigger-clarity: 15
        workflow-completeness: 5
        gate-quality: 10
        evidence-testability: 10
        cold-start: 10
        token-cost: 10
        tool-deps: 5
        write-risk: 0
        skill-reference-fit: 10
      notes: "Audit-only skills score like reports but use a domain-specific Audit Mode marker."
```

Subtype detection contributes to the classification confidence shown in the dashboard. `subtype` remains the applied scoring profile, so existing reports and fixtures keep a stable contract. Newer reports may also include additive shape fields such as `detectedShape`, `shapeConfidence`, and `shapeMismatch`; these describe what the content reads like without changing the profile used for scoring. For example, an uploaded skill file can keep `subtype: workflow` while reporting `detectedShape: playbook` when the content is really a runbook. A high structure score with low subtype confidence still returns `consider-reclassifying`.

Fallback-only subtype matches are intentionally low confidence. If a subtype only matched because it is the default fallback for a kind, the evaluator must not report that as certain.

## Supported Keys

| Key | Purpose |
|---|---|
| `walk-roots.skills` | Skill directories to inventory. |
| `walk-roots.references` | Reference directories to inventory. |
| `composition` | Shared preamble/conventions paths, skill-reference-fit regex, and composed byte cap. |
| `gate-vocabulary` | Regex sources for verification gates, explicit pass/fail language, and human-stop language. |
| `tool-keywords-regex` | Regex source for external tool dependencies. |
| `subtypes` | Detection rules, metric profile caps, and notes for artifact subtypes. |
| `fixture-path` | Primary expected-score fixture for the current project. |
| `additional-fixtures` | Extra expected-score fixtures for consumer corpora. |

## Guardrails

- Keep config project-scoped. Do not store consumer overrides in `workflow/manifest.json`.
- Add a fixture when changing subtype profiles so score drift is intentional.
- Prefer extending defaults. Replace defaults only when the project convention is incompatible.
- Avoid brittle provider-specific regexes unless a real project artifact needs them.
- Keep the scoring rubric portable. Generic or uploaded skills must earn cold-start and evidence credit through explicit context, prerequisites, gates, and evidence rules; they should not be required to reference goat-flow's shared preamble unless they are installed goat-flow skills that actually inherit it.
- Browser, MCP, and GitHub CLI dependencies count as external tools. Defaults include `browser-use`, `Playwright MCP`, `browser_*` commands, `mcp__*` tool names, and `gh`; ordinary shell/runtime commands such as `npm`, `git`, `node`, or `bash` do not trigger tool-dependency deductions by themselves.
- Do not cite gitignored task, scratchpad, or log paths from committed fixtures or docs. When a local artifact exposes a useful failure shape, sanitize it into tracked test content without private domains, accounts, credentials, or `.goat-flow/plans/**` references.

## Verification

Run the focused tests after config changes:

```bash
node --import tsx --test test/unit/quality-config.test.ts
node --import tsx --test test/unit/skill-quality/*.test.ts
```
