# Milestone 2: Prompt Generator

**Archetype:** Make It Real — connect M1's scan results to tailored prompts that users paste into their agents.

## Objective

`npx @blundergoat/goat-flow fix --agent claude` outputs a pre-filled prompt targeting only the failed checks for that project. Fragment-based template system keyed on M1's stable recommendation keys.

## Architecture

```
ScanReport (M1) → select failed checks
  → lookup fragments by recommendationKey
    → group by phase (foundation → standard → full)
      → fill variables from ScanReport facts
        → compose into single pasteable prompt
```

### Fragment Data Model

```typescript
interface Fragment {
  key: string;              // matches CheckDef.recommendationKey
  phase: 'foundation' | 'standard' | 'full' | 'anti-pattern';
  category: string;         // groups fragments in output
  instruction: string;      // what the agent should do (markdown)
  variables?: string[];     // placeholders filled from facts
  dependsOn?: string[];     // other fragment keys that must come first
  agentSpecific?: Record<AgentId, string>;  // agent-specific overrides
}
```

### Three Prompt Modes

| Mode | Command | What it generates |
|------|---------|-------------------|
| **fix** | `goat-flow fix [path]` | Prompt targeting only failed checks. Groups by phase, skips passing checks. |
| **setup** | `goat-flow setup [path]` | Full setup prompt for a fresh project. Pre-fills stack, shape, agent paths. |
| **audit** | `goat-flow audit [path]` | Read-only analysis prompt. No file edits, just diagnosis. |

## Assumptions to Validate

- [x] Fragment composition produces coherent prompts — **confirmed**: grouped by phase, category subheadings
- [x] Variable substitution from facts covers 90%+ of placeholders — **confirmed**: agentName, instructionFile, skillsDir, stack all filled
- [x] Grouping by phase produces natural reading order — **confirmed**: anti-pattern → foundation → standard → full
- [x] Agent-specific overrides are needed for <10 fragments — **confirmed**: ~6 fragments use agentOverrides (deny, hooks, local context)
- [x] Single-prompt output is more useful than multi-prompt — **confirmed**: one rendered markdown document

## Tasks

### Phase A: Fragment Model + Registry (1 session)
1. [x] `src/cli/prompt/types.ts` — Fragment, PromptMode, PromptOptions, ComposedPrompt, PromptVariables types
2. [x] `src/cli/prompt/registry.ts` — fragmentsByKey map, getFragment(), getFragmentsByPhase(), getAllFragments()
3. [x] `src/cli/prompt/variables.ts` — extractVariables() + fillTemplate() from ScanReport + AgentReport
4. [x] Unit tests for variable substitution — 3 tests (fill known, leave unknown, extract from report)

### Phase B: Foundation Fragments (1-2 sessions)
5. [x] Foundation fragments — 22 keys in `src/cli/prompt/fragments/foundation.ts`
6. [x] Anti-pattern fix fragments — 9 keys in `src/cli/prompt/fragments/anti-patterns.ts`

### Phase C: Standard + Full Fragments (1-2 sessions)
7. [x] Standard fragments — 21 keys in `src/cli/prompt/fragments/standard.ts`
8. [x] Full fragments — 19 keys in `src/cli/prompt/fragments/full.ts`

### Phase D: Composers (1-2 sessions)
9. [x] `src/cli/prompt/compose-fix.ts` — select failed fragments, group by phase, fill variables
10. [x] `src/cli/prompt/compose-setup.ts` — full setup prompt with phases 1a/1b/2, pre-filled stack
11. [x] `src/cli/prompt/compose-audit.ts` — read-only diagnosis prompt with tier breakdown + diagnostic questions
12. [x] `src/cli/prompt/render.ts` — render ComposedPrompt to markdown with category grouping

### Phase E: CLI Integration (1 session)
13. [x] Add `fix`, `setup`, `audit` subcommands to cli.ts (command parsing before flags)
14. [x] `--agent` filter for prompt targeting
15. [ ] `--mode self-contained|reference` — deferred to M4
16. [ ] Pipe support: `goat-flow scan . --format json | goat-flow fix --from-stdin` — deferred to M4

### Phase F: Tests + Validation (1 session)
17. [x] Fragment coverage test: every recommendationKey has a fragment (9 tests)
18. [x] Compose-fix test: full-claude fixture → few fragments (7 tests)
19. [x] Compose-fix test: minimal-claude fixture → many fragments across tiers
20. [x] Compose-fix test: phase ordering, preamble content, variable filling
21. [x] Compose-setup test: fresh project → complete setup prompt with 3 phases + agent-specific paths (5 tests)
22. [x] Variable substitution test: fillTemplate + extractVariables (3 tests)
23. [x] Compose-audit test: score overview, failed checks, diagnostic questions, read-only mode (5 tests)

## Exit Criteria

- [x] `goat-flow fix .` outputs a pasteable prompt targeting only failed checks
- [x] `goat-flow fix --agent claude` filters to one agent
- [x] `goat-flow setup .` outputs a complete setup prompt with stack pre-filled
- [x] `goat-flow audit .` outputs a read-only diagnosis prompt
- [x] Fix prompts group by phase (foundation first) — tested
- [x] Variable substitution fills stack, shape, agent paths from scan facts — tested
- [x] Every recommendationKey has a corresponding fragment — tested (71/71 coverage)
- [x] Fix prompt for a passing project is empty (or "all checks pass") — tested
- [x] Prompt output is markdown (paste-ready) — tested

## Human Testing Gate

### Quick: run all checks at once

```bash
scripts/run-cli.sh test-all
```

This runs all 7 human gate checks (JSON, text, verbose, no-setup project, agent filter, fix, setup, audit) in sequence. Review the output for each.

### Individual commands

```bash
scripts/run-cli.sh scan . --format json              # JSON output
scripts/run-cli.sh scan . --format text --verbose     # text + per-check details
scripts/run-cli.sh scan . --agent claude --format text # agent filter
scripts/run-cli.sh fix . --agent claude               # fix prompt
scripts/run-cli.sh setup /tmp/fresh --agent claude    # setup prompt
scripts/run-cli.sh audit . --agent claude             # audit prompt
```

### What to verify

- [ ] JSON output is valid (pipe to `jq .` or similar)
- [ ] Text output shows grade + tier breakdown + recommendations
- [ ] `--verbose` shows per-check details with evidence
- [ ] No-setup project reports gracefully (no crash, no inflated score)
- [ ] `--agent` filter shows only the selected agent
- [ ] Self-scan scores B+ across agents
- [ ] Fix prompt targets only failed checks — passing checks are NOT included
- [ ] Fix prompt variables are filled (no `{{placeholders}}` in output)
- [ ] Paste fix prompt into Claude — confirm it fixes the right things without touching what's already passing
- [ ] Setup prompt includes all phases (1a/1b/2) with pre-filled stack
- [ ] Paste setup prompt into an agent — confirm it produces a working GOAT Flow setup
- [ ] Audit prompt is read-only — diagnosis and 7 diagnostic questions, no file changes
- [ ] Paste audit prompt into an agent — confirm it reads and reports without modifying files

M2 is NOT complete until the user has tested the generated prompts with real agents.

## Key Decisions

| Decision | Why |
|----------|-----|
| Fragment keyed on recommendationKey | M1 already has stable keys. One join point, not two parallel registries. |
| Group by phase, not by category | Users fix foundation first, then standard — mirrors the tier priority. |
| Single composed prompt, not N fragments | One paste is better than 5. The prompt reads as a coherent plan. |
| Variable substitution from facts | M1 already detected stack, shape, agents. Don't make the user re-enter. |
| Agent-specific overrides (not separate fragments) | Most content is identical. Only paths and mechanisms differ. |
| Code-fenced output | User copies the fence contents and pastes into agent. Clean boundary. |

## Gotchas & Fallbacks

| Risk | Fallback |
|------|----------|
| Composed prompt too long (>2000 lines) | Truncate to top-priority fragments. Add "see remaining N checks" summary. |
| Variable substitution misses edge cases | Leave `{{variable}}` unfilled with a comment. User fills manually. |
| Agent-specific overrides needed for >10 fragments | Accept the overhead. Each fragment is ~10 lines — manageable. |
| Fix prompt for partially-passing project is confusing | Clear section headers: "## Already Passing (skip)" and "## Needs Fix" |

## What M2 Does NOT Build

- HTML dashboard (M3)
- Markdown renderer for scan output (M4)
- Dynamic fragment loading from external files (v2)
- Interactive prompt builder (M3's wizard handles this)
