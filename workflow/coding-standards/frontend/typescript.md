# TypeScript Coding Standards (Plain TypeScript — No Framework)

Reference for generating `ai/instructions/frontend.md` or `ai/instructions/backend.md` in TypeScript projects that do NOT use React, Vue, Angular, or Svelte. Applies to CLI tools, libraries, Node.js services, and utility packages.

## ESM Configuration

- Use ESM: set `"type": "module"` in package.json and `"module": "ESNext"` in tsconfig.
- Always include `.js` extensions in relative imports — TypeScript does not rewrite them.
- Use `exports` field in package.json for public entry points. Avoid bare `"main"` for ESM packages.

```typescript
// DO — explicit .js extension in ESM imports
import { parseConfig } from "./config/parser.js";
import type { AppConfig } from "./types/config.js";

// DON'T — missing extension breaks at runtime
import { parseConfig } from "./config/parser";
```

## Strict Mode

- Enable `strict: true` in tsconfig. DO NOT disable individual strict checks.
- No `any` in production code — use `unknown` and narrow with type guards.
- No non-null assertions (`!`) in production code. Narrow with checks or provide defaults.

```typescript
// DO — narrow unknown with type guard
function isError(value: unknown): value is Error {
  return value instanceof Error;
}

const result: unknown = await fetchData();
if (isError(result)) {
  console.error(result.message); // safely narrowed to Error
}

// DON'T — any and non-null assertions
const result: any = await fetchData();
console.error(result!.message);
```

## Type Patterns

- Prefer `interface` for object shapes — they merge, produce clearer error messages, and extend naturally.
- Use `type` for unions, intersections, mapped types, and computed types.
- Use discriminated unions for state variants. Every branch gets a literal `kind` or `type` field.

```typescript
// DO — discriminated union with exhaustive switch
interface Success { kind: "success"; data: string }
interface Failure { kind: "failure"; error: Error }
type Result = Success | Failure;

function handle(r: Result): string {
  switch (r.kind) {
    case "success": return r.data;
    case "failure": return r.error.message;
  }
}

// DON'T — boolean flags and optional fields for state
interface Result { ok: boolean; data?: string; error?: Error }
```

## Error Handling

- Use typed error classes for expected failures. Throw only for unexpected/programmer errors.
- Use a Result pattern for operations that can predictably fail.

```typescript
// DO — Result type for expected failures
type Result<T, E = Error> = { ok: true; value: T } | { ok: false; error: E };

function parsePort(input: string): Result<number> {
  const port = Number(input);
  if (Number.isNaN(port) || port < 1 || port > 65535) {
    return { ok: false, error: new Error(`Invalid port: ${input}`) };
  }
  return { ok: true, value: port };
}

// DON'T — throw for expected validation failure
function parsePort(input: string): number {
  const port = Number(input);
  if (Number.isNaN(port)) throw new Error("bad port"); // caller must guess what throws
  return port;
}
```

## Module Structure

- Use explicit imports. Avoid barrel files (`index.ts` re-exporting everything) — they break tree-shaking and create circular dependency traps.
- Keep modules focused: one concept per file. Split when a file exceeds ~200 lines.
- Export types separately with `export type` to ensure they are erased at compile time.

```typescript
// DO — explicit imports from specific modules
import { createLogger } from "./logging/logger.js";
import type { LogLevel } from "./logging/types.js";

// DON'T — barrel re-export pulls in everything
import { createLogger, LogLevel } from "./logging/index.js";
```

## Testing

- Use `node:test` (built-in, zero deps) or Vitest for test runner.
- Type-safe mocks: define mock implementations that satisfy the interface.
- Test utility types with `expectTypeOf` (Vitest) or compile-time assertion helpers.

```typescript
// DO — interface-based mock
interface Clock { now(): number }

const fakeClock: Clock = { now: () => 1700000000000 };
const scheduler = createScheduler(fakeClock);

// DON'T — untyped mock with as any
const fakeClock = { now: jest.fn() } as any;
```

## Common Footguns

- **ESM/CJS interop**: Importing a CJS module from ESM may require `.default` access. Check whether the library provides an ESM build. Use `import pkg from "cjs-lib"` then access `pkg.default` if needed.
- **Missing `.js` extensions**: TypeScript compiles fine but Node.js ESM loader throws `ERR_MODULE_NOT_FOUND` at runtime. Always include `.js` in relative imports.
- **Type narrowing gaps**: `typeof null === "object"`. Always check `!== null` before `typeof` checks for objects.
- **Index signatures swallow typos**: `Record<string, T>` accepts any key silently. Prefer explicit interfaces or use `Map<string, T>` when keys are dynamic.
- **Enum pitfalls**: Numeric enums reverse-map and bloat output. Prefer string literal unions (`type Status = "active" | "inactive"`) or `as const` objects.
