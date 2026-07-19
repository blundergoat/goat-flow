# TypeScript Conventions

TypeScript spans the **Node.js CLI and server** under `src/cli/` and the **browser dashboard** under `src/dashboard/`. The CLI uses ESM; the dashboard compiles to classic scripts loaded by the HTML shell (not React/Vue).

## Module System

- CLI/server: ESM with `"type": "module"`, target ES2023, and `"module": "NodeNext"`
- CLI/server imports use `.js` extensions: `import { foo } from './bar.js'`
- CLI dynamic imports provide lazy loading (see `cli.ts` -- keeps `--help` fast)
- CLI/server Node built-ins use the `node:` prefix: `import { parseArgs } from 'node:util'`
- Dashboard files are classic browser scripts compiled by `tsconfig.dashboard.json`; cross-file symbols are resolved through their shared script scope

## Type System

- Shared types in `src/cli/types.ts`; audit/check types in `src/cli/audit/types.ts`; CLI command types in `src/cli/cli-types.ts`
- Strict mode: no implicit any, strict null checks, strict property initialization
- Avoid explicit `any`. Use `unknown` and narrow with type guards. A load-bearing dynamic-interop exception requires an inline ESLint suppression with a same-line `-- rationale` comment. Minimize `as` casts.
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

Harness checks feed the AI Harness Completeness score. When `audit --harness` is used, harness failures contribute to the overall audit status and exit code.

## Key Patterns

- `AuditFailure`: returned by failing build checks. Fields: `check`, `message`, `evidence?`, `howToFix?`
- `ReadonlyFS`: filesystem abstraction (exists, readFile, lineCount, readJson, listDir, isExecutable, glob). Auditor never writes.
- Grade thresholds: A >= 90, B >= 80, C >= 70, D >= 60, F < 60

## File Organization

- New build check? Add `BuildCheck` to `audit/check-goat-flow.ts` or `audit/check-agent-setup.ts`
- New harness check? Add a `HarnessCheck` to the appropriate file in `audit/harness/`
- New fact? Add to `SharedFacts` or `AgentFacts` in `types.ts`, extract in `facts/shared/` or `facts/agent/`
- New CLI command? Add to the `Command` union in `cli-types.ts` and the command table in `cli-parser.ts`
- New dashboard behavior? Add it under `src/dashboard/`, register any new classic script in `src/dashboard/index.html`, and cover the browser-visible flow
