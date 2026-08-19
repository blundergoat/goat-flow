---
category: config
last_reviewed: 2026-08-15
---

## Resolved Entries

> Historical record. These entries are no longer active traps.

## Footgun: Misspelled nested config keys are silently ignored

**Status:** resolved | **Created:** 2026-05-25 | **Resolved:** 2026-08-15 | **Evidence:** ACTUAL_MEASURED

**Original symptoms:** A user set a value inside a `.goat-flow/config.yaml` block - `learning-loop.auto-capture.enabled`, `hooks.<id>.binaries` - and nothing changed. No error, no warning, no difference between "configured wrong" and "not configured at all". The feature ran on its default and the user concluded the feature was broken rather than the key.

**Why it happened:** Unknown-key detection was top-level only. `validateUnknownTopLevelKeys` walked `Object.keys(raw)` against `KNOWN_TOP_LEVEL_KEYS`, so `hokes:` at the root was caught. Below the root there was no equivalent sweep: `validateObjectField` confirmed a block was an object and handed it to a nested validator, and each nested validator read only the fields it knew. A key no validator read was neither rejected nor reported, making the typo and the omission indistinguishable downstream.

**Resolution:** `src/cli/config/reader-validators.ts` (search: `warnUnrecognizedKeys`) reports any key inside a block that no validator reads, keyed by full config path. `validateObjectField` (search: `warnUnknownNestedKeys(value, key, warnings)`) runs the sweep for every block reached by a fixed path, so a newly added block cannot forget it - registering the block in `KNOWN_NESTED_KEYS` (`src/cli/config/config-vocabulary.ts`) is what enables the check. Blocks nested under a user-chosen name call the helper directly: `hooks.<id>` rows are swept against `HOOK_ROW_KEYS`, and `learning-loop.auto-capture` against its own set. Warnings, not errors, so a config written for a newer goat-flow still loads on an older CLI. Regression coverage: `test/unit/config-reader.test.ts` (search: `config surfaces misspelled nested keys`) pins the fixed-block case, the hook-row case, the silent-when-correct case, and the user-named-hook-id exemption.

**Deliberately still unswept:** `hooks` row keys are hook ids and `quality` is handed to `loadQualityConfig` unparsed, so neither has a closed key set to check against. Blocks like `footguns` are not valid top-level keys at all, so a user writing one already gets the root-level warning.

**Prevention (retained):**
1. When adding a nested config block, register its keys in `KNOWN_NESTED_KEYS` and add a fixture that misspells one. A block with no entry is skipped silently by design, so the registration is the check.
2. Prefer warning over silence for any key a user can type. The reader's house style is warn-and-continue (`pushWarning`), not reject.
3. Read scalar config values with `??`, not `||`, whenever `0`, `""`, or `false` is a legitimate setting. `||` falls back on every falsy value, so a user explicitly disabling something with `0` silently gets the default instead. This is the same silent-config failure in a different coat.
4. Hook scripts consuming JSON config must validate expected keys before use; a `jq -e '.expected_key'` guard at startup is cheap insurance against a renamed field.

**Decision changed:** Two entries retired 2026-08-15 - a `value || DEFAULT` footgun and a `JSON.stringify` dedupe-key footgun. Both were imported external bug reports with no goat-flow instance; the second was self-rated `MAYBE (preventative)` and its own text recorded that the hazard was absent from `src/cli/prompt/`. The surviving `??` guidance is Prevention 3 above.
