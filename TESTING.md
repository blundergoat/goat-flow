# Testing

Run all tests: `npm test`

## Test Layers

```
Layer 1: Fixture Projects     test/fixtures/projects/           End-to-end scan against known states
Layer 2: Rubric Check Tests   test/unit/evaluate-check.test.ts  Individual rubric checks with pass/fail mock context
Layer 3: Hook Behavior Tests  test/unit/deny-dangerous.test.ts  Hook and deny-policy behavior
Layer 4: Contract Tests       test/contract/                   Path resolution, migration, and instruction-quality checks
Layer 5: Integration Tests    test/integration/                In-memory and fixture-backed scanner/setup regressions
Layer 6: Journey Tests        test/journeys/                   Behavioral eval parsing and journey coverage
Layer 7: Agent Smoke Tests    test/smoke/                      Real agent runs (CI-only, expensive)
```

## Adding a Fixture Project

1. Create `test/fixtures/projects/<name>/` with the project files
2. Add `fixture.json` with expected results:
   ```json
   {
     "agentFilter": "claude",
     "expected": { "claude": { "percentage": 100, "grade": "A" } }
   }
   ```
3. Overlay fixtures use `"extends": "../base-fixture"` to inherit files
4. Add a test in `test/integration/project-fixtures.test.ts`

## Adding a Rubric Check Test

```typescript
import { getCheck } from '../../src/cli/rubric/registry.js';
import { createMockContext } from '../helpers/mock-context.js';

describe('Check X.Y.Z: Name', () => {
  const check = getCheck('X.Y.Z');
  assert.ok(check);

  it('passes when ...', () => {
    const ctx = createMockContext({ agentFacts: { /* overrides */ } });
    const result = runSingleCheck(check, ctx);
    assert.equal(result.status, 'pass');
  });
});
```

The `createMockContext()` defaults match a passing-minimal project. Override only the fields under test.

## Adding an Anti-Pattern Test

```typescript
const ap = getAntiPattern('APXX');
const result = runSingleAntiPattern(ap, ctx);
assert.equal(result.triggered, true);
assert.equal(result.deduction, -N);
```

## Adding a Behavioral Journey

Behavioral journeys validate scanner contracts via `test/journeys/scanner-journeys.test.ts`. The eval surface (`.goat-flow/evals/`) was removed — journey tests now validate scanner check behavior directly against fixture projects.

## Running Smoke Tests (Layer 7)

```bash
# Requires ANTHROPIC_API_KEY
GOAT_SMOKE=1 npm test -- test/smoke/
```

Cost: ~$0.50-2.00 per test. Only run locally when validating workflow changes.

## Test Helpers

| Helper | Purpose |
|--------|---------|
| `test/helpers/mock-context.ts` | Build mock `FactContext` with defaults |
| `test/helpers/mock-fs.ts` | In-memory filesystem for isolated tests |
| `test/helpers/hook-runner.ts` | Pipe JSON to hook scripts, capture results |
| `test/helpers/fixture-scanner.ts` | Scan fixture projects in temp directories |

## CI

Layers 1-6 run on every PR via `.github/workflows/ci.yml`.
Layer 7 (smoke tests) runs on release branches only.
