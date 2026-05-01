# DDT Layer — PHP Static / Contract Checks

Static analysis checks that must pass before behavioural tests run. These gate the test suite: if the contract layer fails, behavioural tests are unreliable.

## Required Checks

| Check | Command | Purpose |
|-------|---------|---------|
| Static analysis | `composer analyse` (PHPStan Level 10) | Catch type errors, null paths, dead code |
| Code style | `composer cs:check` (PHP-CS-Fixer dry run) | Enforce consistent formatting |
| Complexity | `composer analyse:complexity` (cyclomatic max 20) | Prevent over-complex methods |
| Strict types | `grep -rL "declare(strict_types=1)" src/**/*.php` returns empty | Every PHP file declares strict types |
| Psalm (if configured) | `vendor/bin/psalm --no-cache` | Secondary type checker; catches different class of errors than PHPStan |

## Contract Checks (type-level)

These verify that module boundaries enforce their contracts via the type system:

- **Parameter types:** All public method parameters have explicit type declarations. No `mixed` without PHPDoc rationale.
- **Return types:** All public methods have explicit return type declarations. `void` is explicit, not omitted.
- **Property types:** All class properties have type declarations (PHP 7.4+). No untyped properties.
- **Strict comparisons:** Use `===` and `!==`. Loose comparisons (`==`, `!=`) require inline rationale comment.

## When to Baseline / Suppress

Legitimate suppression cases (must include `-- rationale:` in PHPStan baseline or `@phpstan-ignore-*` with comment):

- Third-party library returns `mixed` or has incomplete stubs — suppress at the call site with rationale
- Legacy code under incremental migration — add to PHPStan baseline with a tracked issue number
- Dynamic magic methods (`__call`, `__get`) — document the contract in PHPDoc, suppress the specific rule

Never baseline to make a test pass faster. If PHPStan Level 10 rejects the code, the code is wrong until proven otherwise.

## Integration with Testing Gate

```markdown
### Static / Contract Check (must pass before behavioural tests run)
- [ ] PHPStan Level 10: `composer analyse` exits 0
- [ ] PHP-CS-Fixer dry run: `composer cs:check` exits 0
- [ ] Cyclomatic complexity max 20: `composer analyse:complexity` exits 0
- [ ] Strict types declared: `grep -rL "declare(strict_types=1)" src/**/*.php` returns empty
```
