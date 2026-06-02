---
goat-flow-reference-version: "1.9.1"
---
# Gruff Code Quality

Use this when the user asks to run or fix findings from the gruff static-analysis family: `gruff-go`, `gruff-rs`, `gruff-ts`, `gruff-php`, or `gruff-py`. Gruff is a composite-score code-quality analyzer: it grades quality pillars and emits per-rule findings without executing the code.

**Why gruff exists.** The goal is to force the agent to produce code a human can actually sign off on: legible enough to verify, secure where the eye fails, and tested for real rather than padded with low-signal ceremony. The findings are the lever, not the goal - a doc comment a reviewer can diff against the body, a name that carries intent, a security finding that catches what a reading review misses, a test that asserts behavior instead of just exercising mocks. Each closes the gap between code that *looks* done and code that *is* done; see [`code-comments.md`](./code-comments.md) for the verification-surface principle underneath.

Gruff is not a correctness checker. It does not replace typecheckers, linters, test suites, or maintainer judgment. It also does not know every project convention; a short variable, repeated test setup, or public parameter name may be intentional.

Composite score is a weak cleanup KPI during active work. High-count accepted-debt rules can dominate penalty weight, so report per-rule deltas for APPLY / APPLY-WITH-CHECK clusters instead of treating score movement as proof of progress.

For comment-specific findings, load [`code-comments.md`](./code-comments.md) as the quality bar before editing source comments.

## Gruff at a glance

- **Loop:** measure -> pick one cohesive cluster -> fix the root cause -> rerun gruff on the touched paths -> run the project's normal verify.
- **The targeted gruff rerun is the reproduction** - never claim a finding fixed from inspection alone.
- **Fix, don't silence.** Rename, extract, or document to satisfy a finding; never `enabled: false`, and never baseline mid-cleanup.
- **Triage high-volume rules first** (APPLY / APPLY-WITH-CHECK / CONFIGURE / BASELINE / LARGER-REFACTOR / SKIP-CODEBASE) before editing individual findings.
- **Doc findings:** load `code-comments.md` as the quality bar - doc comments are mandatory there, so `docs.missing-*` is mostly FIX, not noise.
- **API safety:** don't rename public/exported names to satisfy a rule; prefer config or accepted debt.
- Gruff is not a correctness checker - it never replaces typecheck, tests, or judgment.

## Availability Check

Run this before declaring the requested gruff tool unavailable. Set `target` from the requested language; finding any other gruff binary does not satisfy the check.

```bash
target=gruff-ts  # one of: gruff-go, gruff-rs, gruff-ts, gruff-php, gruff-py
found=
for candidate in "vendor/bin/$target" "node_modules/.bin/$target" "$HOME/.local/bin/$target" "$target"; do
  if [ -x "$candidate" ]; then
    found="$candidate"
    break
  fi
  if command -v "$candidate" >/dev/null 2>&1; then
    found="$(command -v "$candidate")"
    break
  fi
done
test -n "$found"
"$found" --version
```

For Node-installed `gruff-ts`, `npx` is also valid:

```bash
npx gruff-ts --version
```

Then confirm the command surface for the specific tool before relying on flags. The examples below are illustrative; substitute the target binary and verify the installed tool before assuming another gruff family member or release supports the same subcommands or flags.

```bash
gruff-ts --help
gruff-ts analyse --help
gruff-ts summary --help
gruff-ts dashboard --help
gruff-ts report --help
gruff-ts list-rules --help
gruff-ts list-rules --format json
```

If the requested gruff binary fails because the package cannot be fetched or executed, do not invent findings. Fall back to the project's normal lint, typecheck, and test commands, and report that gruff itself could not run.

## Tool vs Target

When a request names a path or project, classify it before reading deeply:

- **TOOL:** the named path is a gruff checkout, package, binary, or CLI reference to run against the current target.
- **TARGET:** the named path is the codebase the user wants scanned or fixed.

Parse "use X to find/check/analyse Y" as "invoke X against Y" when X is tool-shaped: it has a `bin` entry, executable wrapper, CLI README, or lives outside the current working tree. If both readings remain plausible after checking the README/package metadata, ask whether X is the tool or the target before drafting plans or editing files.

## Intent

Use gruff to guide a tight code-quality loop:

1. Measure the current findings.
2. Pick one cohesive cluster.
3. Fix root causes, not symptoms.
4. Rerun gruff on the touched paths.
5. Run the project's normal verification for the changed behavior.

Gruff output is input to engineering judgment. A finding may point at a real defect, a naming smell, an under-documented contract, or an analyzer limitation. Treat each finding as a question to answer in code, comments, or tests.

The tools share the same broad purpose across languages, but do not assume every rule id, flag, severity, or false-positive escape hatch is identical. Confirm the installed tool's `--help` and `list-rules` output before writing language-specific claims.

## Command Selection

Use the smallest command that answers the current question. Examples use `gruff-ts`; substitute the target binary.

```bash
gruff-ts summary
gruff-ts summary src/
gruff-ts analyse src/payments/charge.ts
gruff-ts analyse --diff working-tree
gruff-ts analyse --format json src/payments/charge.ts
gruff-ts list-rules
```

Use `summary` for orientation when the installed tool provides it. If it does not, use `analyse --format json` plus a local summarizer. Use `analyse <path>` while fixing a file or cohesive cluster. Use `dashboard` only when the tool exposes it and a browsable view helps the user inspect findings. Use `--diff working-tree` when the installed tool supports it and the user wants changed-code focus. Use JSON when you need complete output, grouping, scripting, or exact counts.

Do not run broad gruff scans in a loop when a targeted path would answer the question. Broad scans are useful at the start and end; targeted scans are useful during fixes.

## JSON-First Triage

For large reports, use JSON before editing:

```bash
gruff-ts analyse --format json <paths> > /tmp/gruff-findings.json
```

Inspect the schema before scripting against it:

```bash
python3 - <<'PY'
import json

with open("/tmp/gruff-findings.json", encoding="utf-8") as handle:
    report = json.load(handle)

print("top-level keys:", sorted(report.keys()))
findings = report.get("findings")
if not isinstance(findings, list):
    raise SystemExit("No list-valued findings field; inspect the JSON before scripting.")
print("findings:", len(findings))
print("first finding:", findings[0] if findings else None)
PY
```

Then group by rule, file, and pillar. A tiny helper is enough after the schema check:

```python
import json
from collections import Counter

with open("/tmp/gruff-findings.json", encoding="utf-8") as handle:
    report = json.load(handle)

findings = report.get("findings")
if not isinstance(findings, list):
    raise SystemExit("No list-valued findings field; inspect this gruff version's JSON schema.")

rule_ids = Counter(
    finding.get("ruleId", "<missing-ruleId>")
    for finding in findings
    if isinstance(finding, dict)
)

for rule_id, count in rule_ids.most_common():
    print(f"{count:5d}  {rule_id}")
```

Do not assume the JSON schema from memory. Verify fields such as `ruleId`, `severity`, `pillar`, `confidence`, `symbol`, or `metadata` on the installed version.

## Triage

Sort findings by likely maintenance value, not by easiest suppression:

1. Correctness or security findings that can change runtime behavior.
2. Modernisation findings that remove unsafe or obsolete current-language idioms.
3. Naming findings where better names make comments unnecessary.
4. Documentation findings on exported APIs, side effects, invariants, thresholds, and error behavior.
5. Complexity findings when a small extraction reduces real branching risk.
6. Test-quality findings when the test currently hides behavior, overfits implementation, or is hard to extend.

Keep one cluster small enough to verify. A good cluster is "one file", "one rule family across adjacent files", or "one public contract plus its tests". Avoid mixing unrelated gruff categories just because they appear in the same global report.

For high-volume rules, classify the rule before editing individual findings:

| Category | Meaning | Action |
|---|---|---|
| APPLY | Findings are true positives for this codebase. | Fix the cluster in small batches. |
| APPLY-WITH-CHECK | Rule is useful but has false positives. | Sample findings and verify each edit. |
| CONFIGURE | Rule is right but the project uses accepted vocabulary or thresholds. | Tune config with comments explaining why. |
| BASELINE | Remaining findings are accepted debt. | Baseline only after cleanup, with notes. |
| LARGER-REFACTOR | Finding is real but needs a larger refactor. | Report it; do not smuggle a refactor into cleanup. |
| SKIP-CODEBASE | Rule conflicts with a deliberate project convention. | Document the decision and avoid churn. |

Decision tree:

- Real defect or clear maintainability win -> APPLY.
- Useful rule with false positives -> APPLY-WITH-CHECK.
- Accepted project vocabulary, abbreviation, or threshold -> CONFIGURE with a rationale comment in config.
- Accepted debt after cleanup -> BASELINE with notes, never mid-cleanup.
- Deliberate convention and no config hook -> SKIP-CODEBASE.
- Correct finding but multi-day fix -> LARGER-REFACTOR.

Before CONFIGURE or BASELINE, write down the policy decision. Broad allowlists and baselines are not routine cleanup.

```text
Rule:
Action: CONFIGURE | BASELINE
Sampled findings:
Why these findings are accepted:
Config or baseline file:
Notes file, when baselining:
Approval status:
Revisit trigger or expiry:
```

## Fix Loop

For each cluster:

1. Read the relevant source and nearby tests before editing.
2. If a Rewrite-First fix (rename, extract, or simplify) can remove the need for a comment, do that first, per [`code-comments.md`](./code-comments.md).
3. Patch the code.
4. Run `<gruff-binary> analyse <touched paths>`.
5. If findings remain, decide whether the remaining issue is real, out of scope, or better handled in a later cluster.
6. Run the language's compile/typecheck step, lint, and focused tests appropriate to the changed paths.
7. Record any repeated gruff lesson, footgun, or pattern with real evidence when verification catches a failure or the workflow changes.

Stop a cluster when the targeted gruff rerun is clean, or when every remaining finding is explicitly categorized as CONFIGURE, BASELINE, LARGER-REFACTOR, or SKIP-CODEBASE. Never claim a gruff finding is fixed from inspection alone. The targeted gruff command is the reproduction for analyzer findings.

## Reading Rule Source

Before fixing a high-volume, surprising, or potentially breaking rule, read the rule implementation for the installed tool. Locate it from the package manager layout, not from memory. Common starting points:

- PHP: `vendor/blundergoat/gruff-php/src/Rule/<Pillar>/<RuleName>Rule.php`, optional `RuleHelper.php`, and shared helpers such as `vendor/blundergoat/gruff-php/src/Rule/TestQuality/TestQualityNodeHelper.php`.
- TypeScript: `node_modules/@blundergoat/gruff-ts/` or the package source for the installed version.
- Go: `$(go env GOMODCACHE)/github.com/blundergoat/gruff-go@*/` when installed as a module/tool.
- Rust: `~/.cargo/registry/src/*/gruff-rs-*/` or the tool checkout used to install it.
- Python: the environment's `site-packages/gruff_py/`; use `python -m pip show gruff-py` or the project's package manager to locate it.

Look for default options, built-in type/name lists, skip conditions, metadata variants, helper predicates, and the AST or test-scope walker. Those reveal supported config knobs and false-positive escape hatches. If the rule source is unavailable, sample more findings and be conservative with automated edits.

## Known Rule Mechanics

These are starting points from prior gruff cleanup work, not universal law. Verify against the installed rule source before applying them at scale.

For analyzer-shape recipes such as callable rewrites or intentional silent-catch markers, require proof before editing: show the target value is the expected type, run focused behavior checks when runtime behavior can change, and leave a rationale that makes the code clearer or safer for a maintainer. Do not apply these patterns only because they silence a finding.

| Tool | Rule or shape | Mechanic to remember |
|---|---|---|
| gruff-php | `naming.parameter-type-name` | `ignoredParameterNames` filters parameters, not local `$x = new Type()` assignments. Locals need rename, restructuring, or accepted debt. |
| gruff-php | `naming.parameter-type-name` duplicate expected names | Descriptive variants can pass when they contain the expected token sequence and add extra distinguishing tokens. |
| gruff-php | `test-quality.mystery-guest` / conditional logic | Rules may walk only PHPUnit test scopes. Extract I/O or branching into a meaningful private helper when that improves test signal. |
| gruff-php | `test-quality.mock-without-expectation` | `createMock` -> `createStub` may lower severity but does not clear the finding. Add verification or accept. |
| gruff-php | `test-quality.mock-only-test` | Mock expectation chains may not count as assertions. Use capture-spy plus real assertions, or assert an externally observable result. |
| gruff-php | `security.dangerous-function-call` | `$callable()` -> `$callable->__invoke()` can clear closure/object invocations because the rule shape differs. Safe only when the value is invokable. |
| gruff-php | `security.silent-catch` | Empty/comment-only catches are detected. Add a real no-op such as `unset($exception)` with a rationale comment if swallowing is intentional. |
| gruff-php | `security.sensitive-data-logging` | Identifier regexes can flag OpenTelemetry `inputTokens`/`outputTokens`; treat as false positives when they are metrics, not auth tokens. |
| gruff-php | `sensitive-data.high-entropy-string` | Long MIME types and rule path strings can fire with no useful rewrite. Prefer accept/baseline over string-splitting. |
| gruff-php | PHPStan scaffolds | `waste.redundant-variable` can hit variables that anchor `/** @var */` narrowing. Check adjacent lines before inlining. |
| gruff-php | `modernisation.readonly-property-candidate` | Append mutations such as `$this->items[] = ...` may be missed. Grep writes before adding `readonly`. |
| gruff-php | `docs.missing-constant-phpdoc` | A `//` line above a constant may not count; use the docblock shape the rule expects. |
| gruff-ts / gruff-go / gruff-rs / gruff-py | language-specific rule names | Fill this table only after checking that tool's `list-rules` and rule source. Do not copy PHP mechanics across languages. |

## Public API Safety

Gruff naming fixes can break callers even when tests pass. Classify the symbol before renaming:

| Position | Usually safe to rename? | Notes |
|---|---:|---|
| Local variable | Yes | Still grep the old name after batch renames. |
| Closure or callback parameter | Usually | Check framework conventions and inferred callback contracts. |
| Private method parameter | Usually | Safe inside one class after typecheck/tests. |
| Test helper parameter | Usually | Keep failure messages readable. |
| Protected method parameter | Maybe | Subclasses and named-argument callers may depend on the name. |
| Public method or constructor parameter | No by default | PHP named arguments, TS declaration consumers, and docs can depend on it. |
| Interface or exported callback parameter | No by default | Implementers and callers may both be affected. |
| Exported object property or serialized field | No by default | Wire formats and dashboard/test fixtures often depend on names. |

If a public name is ugly but stable, prefer config, allowlist, or accepted-debt documentation over a breaking rename.

Language footnotes:

- PHP and Python public parameter names are caller-visible through named arguments.
- TypeScript exported declarations, object fields, and serialized shapes are the common breaking surface.
- Go parameter names are usually not API; exported identifier names and struct fields are.
- Rust free-function parameter names are usually not API, but public struct fields, enum variants, trait contracts, and generated docs matter.

## Documentation Findings

Documentation findings should produce maintainable comments, not analyzer bait. Use [`code-comments.md`](./code-comments.md) and write comments that explain the hidden contract. A `docs.missing-*` fix is not about satisfying the analyzer - the doc comment is a verification surface: it states the intent a reviewer can diff against the body, and a promise the code doesn't keep is exactly the mismatch the bar exists to catch.

`code-comments.md`'s omit-by-default stance is about *inline* comments - it never licensed skipping `docs.missing-*`. Doc comments are mandatory there, so a missing one is a real gap, and the bar is "do not restate syntax," not "write fewer comments." A useful doc comment describes caller obligation, edge values, side effects, errors, determinism, compatibility, or rationale. If a language's ecosystem consumes tags, keep accurate tags; and give every `@param`/`@returns` a real description - if a tag only restates the type signature, rewrite it with meaning (units, edge values, caller obligation) rather than dropping it, per [`code-comments.md`](./code-comments.md).

Gruff documentation rules often need explicit vocabulary near the declaration:

- Error behavior: say whether the function throws, returns a fallback, reports a finding, logs, exits, or swallows an error.
- Side effects: name what changes, such as filesystem writes, process state, network calls, mutation of an argument, local scanner cursor, or local accumulator.
- Thresholds: explain the limit, cap, budget, default, or compatibility reason near the number.
- Complex code: say why the shape exists: compatibility, invariant, tradeoff, performance, determinism, or ordering constraint.
- Public APIs: describe caller-visible contract, not the body line-by-line.
- Parameters and returns: keep tags accurate; delete stale tags when signatures change.

Language conventions matter:

- TypeScript: prefer JSDoc/TSDoc; give every `@param`/`@returns` a real description (not a type-only restatement of the signature), per `code-comments.md`.
- PHP: PHPDoc tags may be part of local static-analysis and IDE contracts; verify project convention before deleting tags.
- Go: all identifiers, exported and internal, need godoc comments per `code-comments.md` - not just exported ones.
- Rust: use rustdoc `///` or `//!` for items (public and internal) and keep parameter facts in the type signature when possible.
- Python: use PEP 257 docstrings for caller-visible contracts and type hints for type facts.

Bad:

```ts
/**
 * Handles paths.
 *
 * @param paths - a string array of paths
 * @returns a string array
 */
function collect(paths: string[]): string[] {
  return paths.filter(Boolean);
}
```

Good:

```ts
/**
 * Return only user-supplied paths that can be checked by the audit.
 *
 * Empty strings are ignored here because setup prompts may emit optional
 * fields as blank lines; callers still receive the original ordering.
 *
 * @param paths - raw path list from setup prompts; may contain blank entries
 * @returns the non-empty paths - original input order preserved
 */
function collectAuditPaths(paths: string[]): string[] {
  return paths.filter(Boolean);
}
```

The Bad version pairs a vague summary with type-only tags (`a string array of paths` just restates `string[]`); the Good version's tags add what the signature can't show - provenance, blank-entry handling, and preserved order. A type-only tag fails the bar as surely as a missing one.

Do not add `contract:` prefixes or other marker words as a substitute for meaning. If gruff still reports the comment, improve the comment around the real boundary the rule is asking for.

### docs.missing-internal-function-doc under the mandatory-doc rule

This rule fires on every internal helper that lacks a leading maintainer comment. Under [`code-comments.md`](./code-comments.md)'s mandatory-doc rule - every function/method carries a doc comment - these findings are mostly genuine, not noise: the helper is missing a contract it is required to have. Default response is FIX, not suppress.

Triage `docs.missing-internal-function-doc`:

1. **FIX (default)** - add the doc comment `code-comments.md` requires. A trivial, name-clear helper gets a single tight contract line; a helper hiding a non-obvious WHY (tradeoff, workaround, threshold rationale, side effect, caller obligation) gets that orientation too. Both satisfy the rule.
2. **RENAME first where it helps** - a better name (`phaseFor` over `processItem`) makes the required doc comment shorter, per the "Rewrite First" ladder. Renaming does not remove the requirement: the mandate stands regardless of name clarity.
3. **Never baseline `docs.missing-*` as accepted noise** - under the mandate there is no name-clear-helper tail to write off; those get a one-line doc comment too. Do not set `enabled: false`, and do not baseline these away to dodge the work - satisfy them.

Test functions are the one carve-out: under the mandate they still need a doc comment, but a descriptive test name plus a single line is enough (per `code-comments.md`'s "Test code" note) - don't expand test helpers into full contract blocks just to clear the finding.

## Naming Findings

Fix naming findings by making the code carry meaning:

- First decide whether the rule is identifying a readability issue, an accepted project abbreviation, or a breaking API change.
- Rename booleans to `is`, `has`, `can`, `should`, `does`, `did`, `was`, `will`, `may`, `in`, `supports`, or `requires` shapes unless the project config says otherwise.
- Replace short or placeholder names with domain names: `finding`, `agentFacts`, `renderedLine`, `instructionPath`.
- Avoid generic functions such as `process`, `handle`, `run`, or `execute` when the body has a domain verb available.
- Prefer one casing for acronyms in a file.

Many naming rules expose options such as accepted abbreviations, ignored parameter names, or threshold lists. For project vocabulary, a documented config entry is often better than fighting the same finding one symbol at a time.

After a rename, grep the old identifier and run the language's compile/typecheck step. Gruff naming cleanup can cross declarations, test fixtures, serialized payloads, and dashboard or generated contexts.

Do not mass-rename public API parameters or exported object fields to satisfy a naming rule. First decide whether the rule is a real readability issue, an accepted project abbreviation, or a breaking API change.

## Complexity Findings

Complexity findings are not an automatic refactor order. First identify why the function is complex:

- Many independent validation branches may be clearer as named checks.
- Rendering functions may be complex because they preserve a public text format.
- Parsers may need explicit branches for compatibility.
- Large test setup may need fixture helpers only if the helpers make assertions clearer.

Refactor only when the extraction reduces real maintenance risk. If public output shape, ordering, or compatibility forces explicit branches, document that reason and leave deeper refactoring for a scoped change.

## Modernisation Findings

Modernisation findings point at safer or clearer current-language idioms. Do not apply a TypeScript rewrite to PHP, Go, Rust, or Python code just because this playbook names it.

Examples by language:

- TypeScript: replace unsafe non-null assertions with guards, prefer `??` when valid falsy values must survive, and add rationale to `@ts-ignore` / `@ts-expect-error`.
- PHP: verify constructor promotion, enum conversion, readonly properties, and callable rewrites against PHPStan and mutation sites.
- Go: check whether the finding maps to current standard-library idioms, error handling, or deprecated package use.
- Rust: check whether the finding maps to current control-flow or error-propagation idioms before changing public types.
- Python: check whether the finding maps to current typing, f-string, context-manager, or pathlib idioms.

Run the language's compile/typecheck step after these fixes. Modernisation changes can alter narrowing and public types even when runtime behavior looks unchanged.

## Generic Type Narrowing

Generic-soup types are a cross-language modernisation pattern. Narrow them when the boundary contract is known:

| Language | Broad type | Better target |
|---|---|---|
| PHP | `mixed` | JSON unions such as `array<array-key, mixed>|bool|float|int|string|null`, or a domain DTO. |
| TypeScript | `any` | `unknown` plus narrowing, discriminated unions, or concrete interfaces. |
| Go | `interface{}` / `any` | Concrete types, type parameters, or explicit tagged structures. |
| Rust | `Box<dyn Any>` / broad `serde_json::Value` | Concrete types, enums, or narrow deserialization structs. |
| Python | `typing.Any` | Concrete annotations, `Optional[...]`, `Union[...]`, protocols, or typed dicts. |

Always run the language type checker after narrowing; callers may pass a variant the first replacement missed.

## Test-Quality Findings

Treat test-quality findings as questions about signal:

- Is the test asserting behavior or implementation detail?
- Does setup hide the production path?
- Is a magic assertion number a real domain constant that deserves a name?
- Would a fixture helper clarify the test, or would it hide the key behavior?
- Is a loop in a test masking which case failed?

Do not blindly abstract test setup. A little explicit setup is often better than a helper that makes the failing contract invisible.

Never add no-op helpers, fake SUT calls, or meaningless wrappers just to satisfy a test-quality heuristic. Extraction is valid only when it improves the test's signal: clearer setup, isolated I/O, reusable fixtures, or a more direct assertion.

When a mock-expectation test is flagged as assertion-free, treat the warning as "no explicit assertion call found" - some gruff rules count only explicit assertion calls. To clear without weakening the test, capture collaborator arguments in a spy/callback and assert them outside the mock, or assert an externally observable return value/state.

## Mechanical Patterns

Use mechanical edits only after the rule and symbol class are safe.

| Pattern | Recipe | Guardrail |
|---|---|---|
| Word-boundary rename | PHP: `r'\$' + re.escape(old) + r'\b'`; TS/Go/Rust/Python: `r'\b' + re.escape(old) + r'\b'`. | Never plain string-replace; `$auth` must not rewrite `$author`. |
| Per-test data helper | Move inline arrays, literals, or setup objects into a named helper such as `dataForInvalidToken()` or `transportReturning(body, status)`. | Helper must make the test clearer, not merely reduce line count. |
| Multi-new setup | Collapse repeated mock/transport/SUT construction into a factory helper with domain parameters. | Keep the SUT call and assertions visible in the test body. |
| Real lightweight implementation | Prefer a small real PSR-17 or framework implementation over four mocks when the real object is stable and cheap. | Do not introduce integration behavior into a unit test by accident. |

## Anti-Patterns to Refuse

- Empty helpers such as `arrange()` that exist only to increase call counts.
- Wrappers such as `array_merge([], $literal)` that exist only to look like a SUT call.
- Public DTO/property/parameter renames that break callers just to satisfy naming rules.
- Mid-cleanup baseline generation to make current findings disappear.
- `createMock` -> `createStub` conversions presented as clearing `mock-without-expectation` when the finding remains.
- Splitting standard MIME types, paths, or rule identifiers into concatenated strings to dodge entropy checks.

## Baselines and Reports

Use baselines only when the user asks for debt tracking or when a project already has a gruff baseline workflow:

```bash
<gruff-binary> analyse --generate-baseline .gruff-baseline.json
<gruff-binary> analyse --baseline .gruff-baseline.json
```

Do not generate a baseline mid-cleanup. That captures true positives and noise together. Generate or update a baseline only after the remaining findings are deliberately accepted debt, and keep a sibling notes file explaining why the debt is accepted.

Use reports when the user needs an artifact:

```bash
<gruff-binary> report --format html --output .goat-flow/logs/quality/gruff-report.html
<gruff-binary> report --format json --output .goat-flow/logs/quality/gruff-report.json
```

Reports are evidence. They do not replace source edits, tests, or focused analyzer reruns.

## Progress Reporting

Report targeted deltas, not just the composite score. Composite scores can barely move when high-count accepted rules dominate the penalty.

Use this shape:

```text
Rule cluster fixed:
- tool: gruff-ts <version>
- docs.missing-error-behavior-doc: 12 -> 0 on src/payments
- naming.short-variable: 9 -> 1 on test helpers

Remaining accepted/larger-refactor:
- complexity.npath in renderTextOutput: real but needs separate renderer refactor
- naming.* public API params: skipped to avoid BC break
```

For regression tracking, compare stable tuples such as `(ruleId, file, symbol)` instead of trusting line-number-only diffs; line shifts can make old findings look new.

## Quick Reference

| Finding shape | Default response |
|---|---|
| `naming.*` on local/private symbols | Word-boundary rename, then grep old name and typecheck. |
| `naming.*` on public API params or exported fields | Prefer config/allowlist/accepted debt unless a breaking change is approved. |
| `test-quality.*` reading I/O in the test body | Extract meaningful I/O fixture/helper; keep assertions visible. |
| `test-quality.*` conditional logic in the test body | Extract setup policy only when the test reads clearer afterward. |
| `test-quality.mock-without-expectation` | Add real verification or accept; `createStub` may not clear it. |
| `test-quality.mock-only-test` | Capture-spy plus explicit assertion, or assert observable SUT output. |
| `security.silent-catch` | Add a real statement plus rationale if swallowing is intentional. |
| `security.dangerous-function-call` on PHP `$x()` | Use `$x->__invoke()` only when the value is known invokable. |
| insecure random APIs | Use the language's secure random primitive unless the rule source documents a safe escape hatch. |
| sensitive-data false positives on metrics names | Accept/configure with evidence; do not break public telemetry names. |
| high-entropy MIME/path/rule strings | Accept or baseline with notes; do not reduce readability to game entropy. |
| size/complexity/god-function findings | LARGER-REFACTOR unless a small extraction clearly reduces risk. |

## Verification Gate

Before claiming gruff work is done, show current-session evidence for the universal gates:

- Targeted gruff rerun on every touched source cluster.
- Compile/typecheck for the edited language: examples include PHPStan/Psalm, `tsc`, `go test`/`go vet`, `cargo check`/`cargo clippy`, mypy/pyright.
- Focused tests for behavior or fixture changes.
- Lint or formatter checks when code style changed.
- Existing project linter configs checked before overriding gruff findings; when project lint explicitly allows a pattern, decide CONFIGURE/SKIP-CODEBASE rather than churn.

Project-specific anti-pattern scans may also apply: run any comment-marker scans, learning-loop, or housekeeping checks your project defines after the fix, so analyzer-driven edits don't reintroduce a banned pattern.

## Troubleshooting

**Gruff says a comment is missing, but there is already a comment.** The comment may be attached to the wrong declaration, may restate the symbol, or may omit the rule's required boundary. Rewrite it around caller-visible contract, side effect, error behavior, invariant, or threshold rationale.

**Gruff reports complexity but the function is public-output rendering.** Check whether extraction would make the output contract easier to break. If explicit branches preserve ordering or compatibility, document that contract and leave structural refactoring to a dedicated change.

**Gruff reports naming after a rename.** Grep for the old name and check generated, ambient, fixture, and serialized surfaces. TypeScript may compile while a dashboard VM test or JSON fixture still expects the old shape.

**The global summary still looks bad after the cluster is fixed.** Report both the global state and the targeted state. A cluster can be clean while unrelated debt remains.

**`analyse` exits non-zero with no findings and an error mentioning `schemaVersion`.** Recent gruff releases require a `schemaVersion:` line at the top of the project config (`.gruff-<lang>.yaml`); without it `analyse` fails closed instead of scanning, so any wrapper that only reads `.findings` sees empty or non-JSON output. The error names the expected value (for example `gruff-ts.config.v0.1`). Fix by regenerating the config: `gruff-<lang> init --force` rewrites it with the required `schemaVersion` while preserving your existing `paths.ignore` and severity entries (plain `init` refuses to overwrite an existing file). Do not hand-invent the version string or strip the field - run `init` so the value matches the installed binary.

## Related References

- [`code-comments.md`](./code-comments.md) - comment quality bar for documentation findings.
- [`observability.md`](./observability.md) - logging, metrics, and span guidance when a gruff fix touches instrumentation.
