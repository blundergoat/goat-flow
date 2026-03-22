# TypeScript Conventions

This is a **Node.js CLI tool** (not a browser app, not React/Vue). Pure TypeScript compiled to ESM.

## Module System

- ESM: `"type": "module"`, target ES2022, `"module": "NodeNext"`
- All imports use `.js` extensions: `import { foo } from './bar.js'`
- Dynamic imports for lazy loading (see cli.ts -- keeps `--help` fast)
- Node built-ins use `node:` prefix: `import { parseArgs } from 'node:util'`

## Type System

- All shared types in `src/cli/types.ts`
- Prompt types in `src/cli/prompt/types.ts` (Fragment, ComposedPrompt, PromptVariables)
- Eval types in `src/cli/eval/types.ts` (ParsedEval, EvalSummary, EvalFrontmatter)
- Strict mode: no implicit any, strict null checks, strict property initialization
- No `any`. Use `unknown` and narrow with type guards. Minimize `as` casts.
- Union types for constrained strings: `AgentId = 'claude' | 'codex' | 'gemini'`
- `Record<string, unknown>` over `any` for parsed JSON

## Testing

- Framework: `node:test` (describe/it) + `node:assert/strict`
- Run: `npm test` (uses tsx loader: `node --import tsx --test 'test/**/*.test.ts'`)
- Tests in `test/` mirroring `src/cli/` structure
- `createMockFS()` from `test/helpers/mock-fs.ts` for filesystem tests -- never touch real disk
- `createTestProject()` from `test/helpers/test-project.ts` for integration fixtures

## Scanner Check Pattern

Each rubric check is a `CheckDef` object in `src/cli/rubric/{foundation,standard,full}.ts`:

```typescript
{
  id: string,              // e.g. '1.1.1', '2.1.5'
  name: string,            // Human-readable check name
  tier: Tier,              // 'foundation' | 'standard' | 'full'
  category: string,        // Grouping label
  pts: number,             // Points awarded on pass
  partialPts?: number,     // Points for partial pass
  confidence: Confidence,  // 'high' | 'medium' | 'low' (affects score weighting)
  detect: Detection,       // Declarative detection config
  na?: (ctx) => boolean,   // Optional N/A condition
  recommendation: string,  // Human-readable fix suggestion
  recommendationKey: string, // Links to Fragment.key in prompt/fragments/
}
```

Detection types: `file_exists`, `dir_exists`, `line_count`, `grep`, `grep_count`, `json_valid`, `json_contains`, `count_items`, `composite`, `custom`.

Use declarative detection when possible. Use `custom` with a typed `fn: (ctx: FactContext) => CheckResult` when declarative is insufficient.

## Fragment Pattern

Each fragment in `src/cli/prompt/fragments/{foundation,standard,full,anti-patterns}.ts`:

```typescript
{
  key: string,             // Must match a CheckDef.recommendationKey
  phase: FragmentPhase,    // 'foundation' | 'standard' | 'full' | 'anti-pattern'
  category: string,        // Same as CheckDef.category
  kind: FragmentKind,      // 'create' (setup) or 'fix' (repair)
  instruction: string,     // Markdown instruction with {{variables}}
  agentOverrides?: {},     // Per-agent instruction variants
}
```

Template variables: `{{instructionFile}}`, `{{agentName}}`, `{{languages}}`, `{{buildCommand}}`, `{{testCommand}}`, `{{lintCommand}}`, `{{date}}`, `{{grade}}`, `{{percentage}}`.

## Key Patterns

- `CheckResult`: returned by all evaluators. Fields: id, name, tier, category, status, points, maxPoints, confidence, message, evidence, recommendationKey
- `FactContext`: `{ facts: ProjectFacts, agentFacts: AgentFacts }` -- passed to every check function
- `ReadonlyFS`: filesystem abstraction (exists, readFile, lineCount, readJson, listDir, isExecutable, glob). Scanner never writes.
- `SKILL_QUALITY_THRESHOLD = 0.8` in `rubric/standard.ts`: skills must meet 80% quality criteria
- Anti-patterns cap at `MAX_DEDUCTION = -15` in `scoring/engine.ts`
- Grade thresholds: A >= 90, B >= 75, C >= 60, D >= 40, F < 40
- `INFLATION_THRESHOLD = 0.10`: fewer than 10% applicable checks = 'insufficient-data' grade

## File Organization

- New check? Add `CheckDef` to the appropriate tier file in `rubric/`, add matching `Fragment` in `prompt/fragments/`
- New detection type? Add to `DetectionType` union in `types.ts`, implement in `evaluate/evaluators.ts`
- New fact? Add to `SharedFacts` or `AgentFacts` in `types.ts`, extract in `facts/shared.ts` or `facts/agent.ts`
- New CLI command? Add to `Command` union and `COMMANDS` array in `cli.ts`
