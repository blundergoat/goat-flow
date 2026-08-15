---
category: config
last_reviewed: 2026-08-15
---

## Footgun: Misspelled nested config keys are silently ignored

**Status:** active | **Created:** 2026-05-25 | **Updated:** 2026-08-15 | **Evidence:** OBSERVED

**Symptoms:** A user sets a value inside a `.goat-flow/config.yaml` block - `hooks.gruff-code-quality.binaries.py`, `learning-loop.auto-capture.enabled`, a `footguns.path` override - and nothing changes. No error, no warning, no difference between "configured wrong" and "not configured at all". The feature runs on its default and the user concludes the feature is broken rather than the key.

**Why it happens:** Unknown-key detection is top-level only. `src/cli/config/reader-validators.ts` (search: `validateUnknownTopLevelKeys`) walks `Object.keys(raw)` against `KNOWN_TOP_LEVEL_KEYS` and warns per unrecognised key, so `hokes:` at the root is caught. Below the root there is no equivalent sweep: `validateObjectField` (search: `validateObjectField`) confirms a block is an object and hands it to a nested validator, and each nested validator reads the specific fields it knows about. A key the validator does not read is neither rejected nor reported - it is simply never looked at. The typo and the omission are indistinguishable to every consumer downstream.

**Evidence:**
- `src/cli/config/reader-validators.ts` (search: `unknown top-level key`) is the only unknown-key warning in the reader; verified 2026-08-15 that no nested equivalent exists.
- External precedent for the same shape: mini-swe-agent PR #700 (merged 2026-01-12) fixed `config.get("env", {})` reading a schema whose key was `"environment"`. Every user's environment configuration was silently ignored for the lifetime of the bug. Loose accessors with defaults cannot distinguish "unset" from "set under a typo".

**Prevention:**
1. When adding a nested config field, add a fixture that misspells the key and assert the loader surfaces a warning. If it cannot, the field joins the silent set and the test documents that.
2. Prefer warning over silence for any key a user can type. The reader's house style is warn-and-continue (`pushWarning`), not reject - match it rather than inventing a stricter path for one block.
3. Read scalar config values with `??`, not `||`, whenever `0`, `""`, or `false` is a legitimate setting. `||` falls back on every falsy value, so a user explicitly disabling something with `0` silently gets the default instead. This is the same silent-config failure in a different coat.
4. Hook scripts consuming JSON config must validate expected keys before use; a `jq -e '.expected_key'` guard at startup is cheap insurance against a renamed field.

**Decision changed:** Two entries retired 2026-08-15 - a `value || DEFAULT` footgun and a `JSON.stringify` dedupe-key footgun. Both were imported external bug reports with no goat-flow instance; the second was self-rated `MAYBE (preventative)` and its own text recorded that the hazard was absent from `src/cli/prompt/`. The surviving `??` guidance from the first is Prevention 3 above. Retiring them keeps this bucket to hazards that exist here.
