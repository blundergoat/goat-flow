---
category: config
last_reviewed: 2026-05-25
---

## Footgun: `value || DEFAULT` silently drops valid falsy values (0, "", false)

**Status:** active | **Created:** 2026-05-25 | **Evidence:** EXTERNAL_REFERENCE

**Symptoms:** CLI option documented as "set to 0 to disable" is silently overridden by the config default. The user types `--cost-limit 0`, the runner reads it, the merge sees `0 || UNSET` → `UNSET`, the merge picks the config-default `3.0` instead. Same shape applies to `--workers 0`, `--retries 0`, any empty-string flag that means "explicitly unset", any boolean flag where `false` is a meaningful override.

**Why it happens:** `||` (and Python's `or`) fall back on every falsy value, not just `null`/`undefined`. The "fallback only if not set" intent and the "fallback if falsy" behaviour look identical until a user picks a falsy value that is also a meaningful intent. The bug is invisible in tests that only exercise non-zero defaults; the regression coverage is the kind nobody writes proactively because the code looks obviously correct.

**Evidence (external — mini-swe-agent):**
- PR #818 (closed, not merged, `kolygri`) reported the bug: `cost_limit or UNSET` in `mini.py` and `swebench_single.py` discarded `--cost-limit 0`. The runner CLI help string says "Set to 0 to disable" but the merge dropped that value.
- PR #825 (merged 2026-05-20, `klieret`) shipped the fix as the supersession of #818, replacing `or UNSET` with `if cost_limit is not None else UNSET` and adding regression tests in external mini-swe-agent paths tests/run/test_cli_integration.py (search: `test_cost_limit_zero_is_preserved`) and tests/run/test_swebench_single.py (search: `test_swebench_single_cost_limit_zero_is_preserved`).

**Goat-flow applicability — HIGH:** TypeScript's `??` (nullish coalescing) handles this correctly — it only falls back on `null`/`undefined`. But `||` is dangerous identically to Python's `or`. Any goat-flow CLI option whose value space includes a falsy member is exposed.
- Audit grep for `||` patterns that look like config-default-merge: `rg -n '|| (UNSET|default)' src/` and `rg -n 'options?\.\w+ \|\|' src/`.
- The proposed M01 session-tracker hook will accept threshold options (e.g. `--budget-warn-fraction 0.75`); if any of those allow `0` to mean "disable this signal," they must use `??` not `||`.
- Pydantic-style `UNSET` sentinel patterns ported from mini (see [patterns/architecture.md](../patterns/architecture.md) "UNSET sentinel + recursive merge") must use the explicit `value === undefined ? UNSET : value` form, not `value || UNSET`.

**Prevention:**
1. In TypeScript: prefer `value ?? DEFAULT` over `value || DEFAULT` whenever `value` is a scalar that could legitimately be `0`, `""`, or `false`. Add `@typescript-eslint/prefer-nullish-coalescing` to lint configuration to enforce.
2. In Python (scripts/, conftest patterns): use `value if value is not None else DEFAULT`, never `value or DEFAULT`, when zero/empty are meaningful intents.
3. When adding a CLI option, write the regression test for the falsy intent (`--option 0`, `--option ""`, `--option false`) before the happy-path test. If the test cannot be written because the value never reaches the consumer, the merge logic is already broken.
4. Document on every CLI flag whether falsy values are legitimate (`Set to 0 to disable` is a contract). The flag's help text and the flag's merge logic must agree.

## Footgun: Misspelled config key silently disables the feature

**Status:** active | **Created:** 2026-05-25 | **Evidence:** EXTERNAL_REFERENCE

**Symptoms:** A feature reads its configuration from a nested config object via `.get("env", {})` or `cfg.section?.field`, but the actual key in the YAML/JSON is `"environment"`. The accessor returns the empty default, the feature initialises with empty config, the feature appears to "work" but no user setting takes effect. No error, no warning, no diff between "configured wrong" and "not configured at all."

**Why it happens:** Loose dict accessors with a default value (`get(key, {})`) and optional chaining (`?.field`) are designed to handle "key not present" gracefully. They cannot distinguish "user did not set this" from "user set this under a typo." Pydantic v1 default behaviour, plain Python dicts, and untyped TypeScript objects all suffer this. Catching it requires either strict schema validation (Pydantic v2 `extra="forbid"`, Zod `.strict()`) or a manual unknown-key audit at parse time.

**Evidence (external — mini-swe-agent):**
- PR #700 (merged 2026-01-12, `klieret`). One-line fix: `LocalEnvironment(**config.get("env", {}))` → `LocalEnvironment(**config.get("environment", {}))`. Closed issue #699 ("Fix: mini ignored environment config"). Every user's environment configuration was silently ignored for the duration of the bug because the config schema used `"environment"` as the top-level key while the runner accessor used `"env"`.

**Goat-flow applicability — MEDIUM:** TypeScript catches the *typed* version of this at compile time (`cfg.environment` is OK, `cfg.env` would fail if not declared). But several surfaces in goat-flow read config via untyped paths or pass through to schema-less consumers:
- YAML-loaded sections in `.goat-flow/config.yaml` that don't have a strict schema validator (audit by reading `src/cli/config/`).
- Hook configs in `workflow/hooks/agent-config/*.json` consumed by hook scripts as untyped JSON.
- Future preset/prompt overrides that may load JSON without a Zod schema at the boundary.

**Prevention:**
1. Every config schema must reject unknown keys at parse time. TypeScript: Zod `.strict()` at the boundary. Python: Pydantic v2 `model_config = ConfigDict(extra="forbid")`. Bash: explicit allowlist of expected keys, fail on any other.
2. When adding a config section, write a "typo regression": deliberately misspell the section key in a fixture and assert the loader fails loudly. If the loader accepts the typo silently, fix the schema before shipping the feature.
3. Hook scripts that read JSON config must validate the keys they expect before using them. A grep-based smoke check (`jq -e '.expected_key' < config.json`) at hook startup is cheap insurance.

## Footgun: `JSON.stringify` as a dedupe key silently drops function values, class instances, and BigInts

**Status:** active | **Created:** 2026-05-25 | **Evidence:** EXTERNAL_REFERENCE

**Symptoms:** A merge or dedupe step over a list of config objects silently loses entries. `[fnA, fnB, fnC]` becomes `[fnA]` after the dedupe pass. Or `[providerA, providerB]` where both contain `{transform: fn}` collapses to `[providerA]`. The downstream consumer sees fewer items than the user configured; assertions about "every test should call provider X" pass because the user re-typed the same provider three times and only one survived. Particularly silent for callback-style config fields (transforms, hooks, predicates) where the function IS the load-bearing content.

**Why it happens:** `JSON.stringify(fn) === undefined`. So when a dedupe pass uses `seen.add(JSON.stringify(item))` and the items are functions, every function after the first finds `undefined` already in the `Set` and is discarded. Same shape for objects CONTAINING functions: `JSON.stringify({id: 'X', transform: fn})` returns `'{"id":"X"}'`, the function silently drops from the key, and two distinct providers with the same id but different transforms collide. Class instances stringify to `{}` (no enumerable own properties), cycles throw, BigInts throw.

**Evidence (external — promptfoo PR cluster #9402 → #9408 → #9430, three PRs over three days):**
- PR #9402 (merged 2026-05-22): `combineConfigs` keyed dedupe on `JSON.stringify(provider)`. Every `CallApiFunction` after the first hit the `undefined` collision and was dropped. Fix: branch on type — `typeof provider === 'function' ? provider : JSON.stringify(provider)`.
- PR #9408 (merged 2026-05-23): #9402 still missed three cases — `{id, transform: fn}` objects (function silently dropped from stringify), `ApiProvider` class instances (identity on prototype, stringify sees `{}`), and cycle / BigInt configs. Fix extracted `providerDedupeKey`, returns `undefined` (= "give up, always keep") when any function value or class instance is detected.
- PR #9430 (merged 2026-05-24): #9408's "give up" rule was too eager — same reference twice was kept as duplicates. Final fix replaced `hasFunctionValue` short-circuit with a `JSON.stringify` REPLACER that swaps each function for `{__functionReference: id}` keyed by reference identity (`Map<Function, number>` shared across the whole combine pass). Dedupe key now mixes value equality (object shape) with function reference identity.

**Goat-flow applicability — MAYBE (preventative):** Today `src/cli/prompt/compose-setup.ts` doesn't dedupe by `JSON.stringify` (`rg -n "JSON.stringify|Set<|dedupe|seen" src/cli/prompt/` returns nothing). But:
- M28 architecture reviews flagged `compose-setup.ts`, `hooks.ts`, and `types.ts` as next bottlenecks — exactly where future merge / dedupe logic accretes.
- Any future "skill X declared by both user and default" or "hook declared in two agent configs" dedupe will hit this shape if skills / hooks carry callback functions.
- Skill quality artifact dedupe (`src/cli/quality/skill-quality-content.ts` search: `artifactsById`) currently dedupes by string id — safe today; would break if artifact entries gained a `transform` callback.

**Prevention:**
1. Never use `JSON.stringify` as a dedupe key for values that may contain functions, class instances, BigInts, or cycles. Use a typed `dedupeKey(item)` function that branches:
   - If the item is a function, use reference identity (`Map<Function, number>` for stable IDs).
   - If the item is a plain data object, use `JSON.stringify` with a custom REPLACER that injects function reference IDs.
   - If the item is a class instance, prefer a custom `dedupeKey` field on the class or fall back to reference identity.
   - If the key cannot be computed deterministically, **preserve, don't drop** — silent loss is worse than visible duplicates.
2. When dedupe is added to a new code path, write the test that exercises the falsy-collision case (two distinct items that stringify to the same string) BEFORE the happy-path test. If you can't construct the bad case, you don't understand the dedupe surface yet.
3. The "preserve, don't drop" rule scales: in any merge / normalize step that can't decide whether two items are the same, default to keeping both and let downstream notice the duplicate. A visible duplicate is a loud failure; a silent loss is a quiet one.
4. For TypeScript, prefer `Map<DedupeKey, Item>` over `Set<string>` so the key type is explicit and the items survive past the dedupe pass.
