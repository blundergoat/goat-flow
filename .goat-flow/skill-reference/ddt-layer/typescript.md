# DDT Layer — TypeScript Static / Contract Checks

Static analysis checks that must pass before behavioural tests run. These gate the test suite: if the contract layer fails, behavioural tests are unreliable.

## Required Checks

| Check | Command | Purpose |
|-------|---------|---------|
| Type check | `tsc --noEmit` | Catch type errors without emitting files |
| Lint (strict) | `eslint --max-warnings 0 src/` | Zero-warning policy; catches `any` leaks, unused vars, unsafe patterns |
| No `any` | `grep -rn ': any' src/ \| grep -v '// eslint-disable'` returns empty | Explicit `any` requires a disable comment with rationale |
| Strict null checks | Verify `tsconfig.json` has `"strict": true` or at minimum `"strictNullChecks": true` | Prevents null/undefined from hiding in types |

## Contract Checks (type-level)

These verify that module boundaries enforce their contracts via the type system:

- **Export surface:** Public API types are explicitly exported, not inferred. Use `@internal` or barrel files to control surface.
- **Return types:** Functions at module boundaries have explicit return type annotations, not inferred returns.
- **Parameter types:** No implicit `any` on function parameters (enforced by `noImplicitAny` in tsconfig).

## When to Suppress

Legitimate suppression cases (must include `// rationale:` comment):

- Third-party library type definitions are incomplete or incorrect — use `as unknown as T` with rationale
- Generic utility types where `any` is structurally required (e.g., type-level programming) — use `// eslint-disable-next-line @typescript-eslint/no-explicit-any -- rationale: <why>`
- Legacy code under incremental migration — baseline in `.eslintrc` with a tracked issue

Never suppress to make a test pass faster. If the type system rejects the code, the code is wrong until proven otherwise.

## Integration with Testing Gate

```markdown
### Static / Contract Check (must pass before behavioural tests run)
- [ ] `tsc --noEmit` exits 0
- [ ] `eslint --max-warnings 0 src/` exits 0
- [ ] No unrationed `any` usage: `grep -rn ': any' src/ | grep -v 'eslint-disable'` returns empty
```
