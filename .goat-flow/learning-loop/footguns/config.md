---
category: config
last_reviewed: 2026-09-05
---

## Resolved Entries

> Historical record. These entries are no longer active traps.

## Footgun: Misspelled nested config keys are silently ignored

**Status:** resolved | **Created:** 2026-05-25 | **Resolved:** 2026-08-15 | **Evidence:** ACTUAL_MEASURED

**Resolution:** `src/cli/config/reader-validators.ts` (search: `warnUnrecognizedKeys`) reports any key inside a block that no validator reads, keyed by full config path, and `validateObjectField` in the same file (search: `warnUnknownNestedKeys(sectionValue, key, warnings)`) runs the sweep for every block reached by a fixed path; registering the block in `KNOWN_NESTED_KEYS` (`src/cli/config/config-vocabulary.ts`) is what enables the check. `hooks.<id>` rows sweep against `HOOK_ROW_KEYS` and `learning-loop.auto-capture` against its own set. Warnings, not errors, so a config written for a newer goat-flow still loads on an older CLI. `test/unit/config-reader.test.ts` (search: `config surfaces misspelled nested keys`) pins the fixed-block, hook-row, silent-when-correct, and user-named-hook-id cases. Still unswept by design: `hooks` row keys are hook ids and `quality` is handed to `loadQualityConfig` unparsed.

**Original symptoms:** A value set inside a `.goat-flow/config.yaml` block, such as `learning-loop.auto-capture.enabled` or `hooks.<id>.binaries`, changed nothing, with no error or warning. Unknown-key detection was top-level only: `validateUnknownTopLevelKeys` caught `hokes:` at the root while nested validators read only the fields they knew.

**Prevention retained:**
1. When adding a nested config block, register its keys in `KNOWN_NESTED_KEYS` and add a fixture that misspells one; a block with no entry is skipped silently.
2. Prefer warn-and-continue (`pushWarning`) over silence for any key a user can type.
3. Read scalar config values with `??`, not `||`, whenever `0`, `""`, or `false` is a legitimate setting; `||` silently replaces an explicit `0` with the default.
4. Hook scripts consuming JSON config validate expected keys before use; a `jq -e '.expected_key'` guard at startup is cheap insurance against a renamed field.

**Retired siblings:** Two entries were retired on 2026-08-15, a `value || DEFAULT` footgun and a `JSON.stringify` dedupe-key footgun. Both were imported external bug reports with no goat-flow instance; the surviving `??` guidance is Prevention 3 above.
