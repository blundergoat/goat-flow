---
goat-flow-reference-version: "1.11.0"
---
# Gruff Code Quality

Use this when the user asks to run or fix findings from `gruff-go`, `gruff-rs`, `gruff-ts`, `gruff-php`, or `gruff-py`. Gruff is static analysis: it reports quality findings; it does not replace tests, typecheck, lint, or maintainer judgment.

You are a coding agent. Your job is to run the right gruff tool, fix one cohesive cluster, prove the finding changed with a targeted rerun, then run the normal project verification.

## Availability Check

Set `target` from the requested language; another gruff binary is not enough.

```bash
target=gruff-ts  # gruff-go | gruff-rs | gruff-ts | gruff-php | gruff-py
found=
for candidate in "vendor/bin/$target" "node_modules/.bin/$target" ".cargo-tools/bin/$target" "$HOME/.local/bin/$target" "$target"; do
  if [ -x "$candidate" ]; then found="$candidate"; break; fi
  if command -v "$candidate" >/dev/null 2>&1; then found="$(command -v "$candidate")"; break; fi
done
test -n "$found"
"$found" --version
"$found" --help
```

If no binary is found, try the ecosystem wrapper before declaring gruff unavailable: `npx gruff-ts --version`, `go tool gruff-go --version`, `uv run gruff-py --version`. If gruff cannot run, say so and use the project's normal lint/typecheck/tests; do not invent gruff findings.

## Intent

Gruff work is a loop:

1. Measure.
2. Pick one cohesive cluster.
3. Fix root causes, not symptoms.
4. Rerun gruff on touched paths.
5. Run normal verification for the changed code.

Never claim a gruff finding is fixed from inspection. The targeted gruff rerun is the reproduction.

## Tool vs Target

When the user names a path, classify it before reading deeply:

- **TOOL:** gruff checkout/package/binary/CLI reference to invoke.
- **TARGET:** codebase or paths to scan/fix.

If the user says "use X to find Y" and X has a binary, package metadata, or CLI README, treat X as the tool and Y as the target. If both readings remain plausible, ask one question before planning or editing.

## Command Selection

Use the smallest command that answers the question. Examples use `gruff-ts`; substitute the installed binary.

```bash
gruff-ts summary
gruff-ts analyse src/payments/charge.ts
gruff-ts analyse --diff working-tree
gruff-ts analyse --format json src/payments/charge.ts
gruff-ts check-ignore src/generated/schema.ts
gruff-ts list-rules --format json
```

- Use `summary` for orientation.
- Use `analyse <path>` while fixing.
- Use `analyse --format json` for grouping or exact counts.
- Use `check-ignore <path>` to verify a config ignore before planning CONFIGURE/SKIP.
- Use `dashboard` or `report` only when the installed tool exposes it and the user needs an artifact.

Exit codes matter: `analyse` may exit `1` because findings exist; that is not tool failure. Exit `2` is a real diagnostic such as parse error, missing path, or rejected config. Use `--fail-on none` for pure reporting when supported; gruff-go/gruff-rs may spell the threshold `--min-severity`.

## JSON Triage

For large reports:

1. Run `analyse --format json <paths>` and save output outside tracked source.
2. Inspect the top-level keys before scripting against the schema.
3. Group by `ruleId`, file, pillar, and symbol.
4. Prefer `stableIdentity` for finding diffs; line numbers and `fingerprint` move with edits.

Current ports are converging on `schemaVersion: "gruff.analysis.v2"` and flat findings with `ruleId`, `message`, `file`, `line`, `severity`, `pillar`, `symbol`, `metadata`, `fingerprint`, and `stableIdentity`. Verify the installed version; older releases and ports differ.

If JSON is empty or non-JSON, suspect a real diagnostic or config `schemaVersion` failure before assuming the schema changed.

## Triage Actions

Classify high-volume rules before editing individual findings.

| Action | Use when | Agent response |
|---|---|---|
| APPLY | True positive and small enough to fix | Fix in batches. |
| APPLY-WITH-CHECK | Useful rule with false positives | Sample and verify each edit. |
| CONFIGURE | Project vocabulary/threshold is valid | Tune config with rationale. |
| BASELINE | Remaining findings are accepted debt | Baseline only after cleanup, with notes. |
| LARGER-REFACTOR | Real issue needs bigger design work | Report; do not smuggle refactor. |
| SKIP-CODEBASE | Rule conflicts with deliberate convention | Document and avoid churn. |

Hard rule: never set `enabled: false` and never baseline mid-cleanup. If the user asked to "fix", do not tune thresholds or baselines unless they explicitly approve that policy change.

## Cluster Choice

Fix one cluster small enough to verify:

- one file;
- one rule family across adjacent files;
- one public contract plus its tests;
- one generated/config path decision.

Prioritize security/correctness, unsafe modernisation, naming that removes confusion, documentation of hidden contracts, real complexity risk, then test-quality signal. Do not chase composite score as proof; high-count accepted debt can dominate it.

## Fix Loop

For each cluster:

1. Read source and nearby tests.
2. Read rule source for high-volume, surprising, security-sensitive, or potentially breaking findings.
3. Prefer Rewrite First: rename, extract, simplify, then comment.
4. Patch the code.
5. Rerun gruff on touched paths.
6. Run compile/typecheck, lint/format, and focused tests for the changed language.
7. Stop when targeted gruff is clean or each remaining finding is CONFIGURE, BASELINE, LARGER-REFACTOR, or SKIP-CODEBASE.

## Documentation Findings

For `docs.*`, load [`code-comments.md`](./code-comments.md) first. Doc comments are mandatory under that playbook, so missing-doc findings default to FIX, not suppress.

Write comments for caller-visible contract: obligations, edge values, side effects, error behavior, thresholds, determinism, compatibility, or non-obvious rationale. Do not restate syntax or add marker words just to satisfy the analyzer. If `@param`/`@returns` tags are used, each tag needs meaning beyond the type signature.

Rule scopes differ by port: gruff-ts can flag internal helpers; gruff-py covers every function; gruff-go/rust mostly cover public/exported docs; gruff-php focuses on public/class/file/constant phpdoc. The rule IDs use `docs.`, while the pillar is `documentation`.

Test functions still need the playbook's doc bar, but a descriptive test name plus one tight line is enough. Do not expand tests into contract essays.

## Public API Safety

Naming fixes can break callers. Before renaming, classify the symbol:

- Usually safe: local variables, private helper params, test helper params.
- Check carefully: closure/callback params, protected method params, framework hooks.
- Unsafe by default: public/constructor params, interface params, exported object fields, serialized fields, public struct fields, enum variants, trait contracts.

After any rename, grep the old identifier and run the language typecheck/tests. TypeScript can pass while fixtures, ambient declarations, generated code, or dashboard VM tests still expect the old shape.

Use `allowlists.acceptedAbbreviations` for accepted project vocabulary instead of fighting the same naming finding repeatedly.

## Finding-Specific Guardrails

- Complexity is not an automatic refactor order. Extract only when the result is clearer and safer.
- Modernisation can change narrowing or public types; run the type checker.
- Generic type narrowing is good only when the boundary contract is known.
- Test-quality findings ask whether the test has signal. Do not add no-op helpers, fake SUT calls, or wrappers to game the rule.
- Data-driven test loops are good when each row asserts behavior; do not de-parametrize to clear a loop smell.
- Mock-only tests need real assertions: capture-spy arguments or assert observable output/state.
- PHP `$callable()` -> `$callable->__invoke()` is safe only when the value is known invokable.
- Empty/silent catches need real handling plus rationale if swallowing is intentional.
- High-entropy MIME/path/rule strings and telemetry token metric names may be accepted false positives; do not reduce readability to game entropy.
- `createMock` -> `createStub` does not by itself clear mock-without-expectation.

## Baselines and Reports

Baselines are debt tracking, not cleanup:

```bash
<gruff-binary> analyse --generate-baseline .gruff-baseline.json
<gruff-binary> analyse --baseline .gruff-baseline.json
```

Generate or update a baseline only after remaining findings are deliberately accepted debt, with notes explaining why. Reports are evidence artifacts, not a substitute for source edits or targeted reruns.

## Progress Reporting

Report targeted deltas, not only global score:

```text
Fixed:
- tool: gruff-ts <version>
- docs.missing-error-behavior-doc: 12 -> 0 on src/payments
- naming.short-variable: 9 -> 1 on test helpers

Remaining:
- complexity.cognitive in renderTextOutput: LARGER-REFACTOR
- naming.* public API params: SKIP to avoid breaking callers
```

## Verification Gate

Before claiming gruff work is done:

1. Show the exact targeted gruff rerun for every touched cluster.
2. Show compile/typecheck for the edited language.
3. Show focused tests for behavior, fixture, or public-shape changes.
4. Show lint/format if style or TS/JS changed.
5. Confirm no `enabled: false` rule disablement was added.
6. Confirm no mid-cleanup baseline was generated.
7. For renames, grep the old identifier.
8. For doc findings, confirm `code-comments.md` bar was followed.
9. Report remaining findings by action category, not as "fixed".

## Troubleshooting

- **Comment exists but finding remains:** it may be attached to the wrong declaration, restate syntax, or omit side effect/error/threshold/invariant language.
- **Complexity on rendering/parser code:** preserve public output/order compatibility unless extraction clearly lowers risk.
- **Global score still bad:** report global state plus targeted cluster delta; unrelated debt can remain.
- **Ignore seems broken:** config ignores apply during directory traversal; an explicit file path may still be analysed. Verify ignores with a directory scan or `check-ignore`.
- **`analyse` exits non-zero with no findings and mentions `schemaVersion`:** regenerate config with the installed tool's `init --force` flow, then reapply custom allowlists/severities. Do not hand-invent schema strings.

## Related References

- [`code-comments.md`](./code-comments.md) - comment quality bar for documentation findings.
- [`observability.md`](./observability.md) - instrumentation guidance when a gruff fix touches logs, metrics, or spans.
