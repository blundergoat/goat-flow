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
- Strict mode: no implicit any, strict null checks, strict property initialization
- No `any`. Use `unknown` and narrow with type guards. Minimize `as` casts.
- Union types for constrained strings: `AgentId = 'claude' | 'codex' | 'antigravity' | 'copilot'`
- `Record<string, unknown>` over `any` for parsed JSON

## Testing

- Framework: `node:test` (describe/it) + `node:assert/strict`
- Run: `npm test` for the fast preflight suite; use `npm run test:slow` for the nested preflight/dashboard integration suite and `npm run test:full` before release-sensitive changes.
- Tests in `test/` mirroring `src/cli/` structure
- `createMockFS()` from `test/helpers/mock-fs.ts` for filesystem tests -- never touch real disk
- `createTestProject()` from `test/helpers/test-project.ts` for integration fixtures

## Build Check Pattern

Each build check is a `BuildCheck` object in `src/cli/audit/check-goat-flow.ts` or `check-agent-setup.ts`:

```typescript
{
  id: string,              // kebab-case identifier
  name: string,            // Human-readable check name
  scope: 'setup' | 'harness',  // Which audit scope this belongs to
  run: (ctx: AuditContext) => AuditFailure | null,  // null = pass
}
```

`AuditContext` provides: `projectPath`, `facts`, `config`, `fs`, `structure`, `agents`, `agentFilter`.

## Quality Check Pattern

Each quality check is a `QualityCheck` object in the `src/cli/audit/harness/` directory:

```typescript
{
  id: string,              // kebab-case identifier
  concern: AuditConcernKey,  // 'context' | 'constraints' | 'verification' | 'recovery' | 'feedback_loop'
  weight: number,          // Relative weight within concern
  run: (ctx: AuditContext) => QualityCheckResult,
}
```

`QualityCheckResult`: `{ score: number (0-100), findings: string[], recommendations: string[], howToFix?: string[] }`

Quality checks are advisory - they never affect exit code.

## Key Patterns

- `AuditFailure`: returned by failing build checks. Fields: `check`, `message`, `evidence?`, `howToFix?`
- `ReadonlyFS`: filesystem abstraction (exists, readFile, lineCount, readJson, listDir, isExecutable, glob). Auditor never writes.
- Grade thresholds: A >= 90, B >= 75, C >= 60, D >= 40, F < 40

## File Organization

- New build check? Add `BuildCheck` to `audit/check-goat-flow.ts` or `audit/check-agent-setup.ts`
- New quality check? Add `QualityCheck` to the appropriate file in `audit/harness/`
- New fact? Add to `SharedFacts` or `AgentFacts` in `types.ts`, extract in `facts/shared/` or `facts/agent/`
- New CLI command? Add to `Command` union and `COMMANDS` array in `cli.ts`
