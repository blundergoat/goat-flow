# TypeScript Conventions

This is a **Node.js CLI tool** (not a browser app, not React/Vue). Pure TypeScript compiled to ESM.

## Module System

- ESM: `"type": "module"`, target ES2022, `"module": "NodeNext"`
- All imports use `.js` extensions: `import { foo } from './bar.js'`
- Dynamic imports for lazy loading (see cli.ts -- keeps `--help` fast)
- Node built-ins use `node:` prefix: `import { parseArgs } from 'node:util'`

## Type System

- Shared types in `src/cli/types.ts`; audit/check types in `src/cli/audit/types.ts`; CLI command types in `src/cli/cli-types.ts`
- Strict mode: no implicit any, strict null checks, strict property initialization
- No `any`. Use `unknown` and narrow with type guards. Minimize `as` casts.
- Union types for constrained strings: `AgentId = 'claude' | 'codex' | 'antigravity' | 'copilot'`
- `Record<string, unknown>` over `any` for parsed JSON

## Testing

- Framework: `node:test` (describe/it) + `node:assert/strict`
- Run: `npm test` for the fast preflight suite; use `npm run test:slow` for the nested preflight/dashboard integration suite and `npm run test:full` before release-sensitive changes.
- Tests in `test/` mirroring `src/cli/` structure
- Integration tests isolate the filesystem with a real temp dir (`fs.mkdtemp` under `os.tmpdir()`) -- never touch the real project tree
- Process/global-state helpers in `test/helpers/`: `setEnv` and `withStubbedDate` (`global-fixtures.ts`), `assertExists` (`assert-exists.ts`)

## Build Check Pattern

Each build check is a `BuildCheck` object in `src/cli/audit/check-goat-flow.ts` or `check-agent-setup.ts`:

```typescript
{
  id: string,              // kebab-case identifier
  name: string,            // Human-readable check name
  scope: 'setup' | 'agent',  // AuditScopeName -- which audit scope this belongs to
  provenance: CheckEvidence,  // required: evidence/source backing this check
  run: (ctx: AuditContext) => AuditFailure | null,  // null = pass
}
```

`AuditContext` provides: `projectPath`, `facts`, `config`, `fs`, `structure`, `agents`, `agentFilter`.

## Harness Check Pattern

Each AI Harness Completeness check is a `HarnessCheck` object in the `src/cli/audit/harness/` directory:

```typescript
{
  id: string,              // kebab-case identifier
  name: string,            // Human-readable check name
  concern: AuditConcernKey,  // 'context' | 'constraints' | 'verification' | 'recovery' | 'feedback_loop'
  type: HarnessCheckType,  // 'integrity' | 'advisory' | 'metric'
  provenance: CheckEvidence,  // evidence/source backing this check
  run: (ctx: AuditContext) => HarnessCheckResult,
}
```

`HarnessCheckResult`: `{ status: 'pass' | 'fail', findings: string[], recommendations: string[], howToFix?: string[] }`

Harness checks feed the AI Harness Completeness score and do not affect the deterministic audit exit code (only build checks do).

## Key Patterns

- `AuditFailure`: returned by failing build checks. Fields: `check`, `message`, `evidence?`, `howToFix?`
- `ReadonlyFS`: filesystem abstraction (exists, readFile, lineCount, readJson, listDir, isExecutable, glob). Auditor never writes.
- Grade thresholds: A >= 90, B >= 80, C >= 70, D >= 60, F < 60

## File Organization

- New build check? Add `BuildCheck` to `audit/check-goat-flow.ts` or `audit/check-agent-setup.ts`
- New harness check? Add a `HarnessCheck` to the appropriate file in `audit/harness/`
- New fact? Add to `SharedFacts` or `AgentFacts` in `types.ts`, extract in `facts/shared/` or `facts/agent/`
- New CLI command? Add to the `Command` union in `cli-types.ts` and the command table in `cli-parser.ts`
