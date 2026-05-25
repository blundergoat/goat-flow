---
category: dependencies
last_reviewed: 2026-05-25
---

## Pattern: Pin AWAY from known-bad versions via `!=`, not only `>=`

**Context:** A dependency you ship in your own `package.json` / `pyproject.toml` constraint is disclosed as compromised (supply-chain attack, malicious version, broken release). You need to make sure downstream consumers regenerating their lockfile do not pick the bad version, without forcing a major version pin that breaks legitimate range matching.

**Approach:** Add explicit `!=` exclusions for the specific bad versions alongside the existing floor constraint. The constraint stays open-ended for legitimate new releases while structurally rejecting the known-bad ones.

**Evidence (external — mini-swe-agent):**
- PR #794 (merged 2026-03-24, same day as the disclosure, `michalcichon`). Supply-chain attack on litellm 1.82.7/1.82.8: malicious `.pth` file injection on install, exfiltrated `OPENAI_API_KEY` / `AWS_SECRET_ACCESS_KEY`, attempted to establish a persistent backdoor in `~/.config/`, and could trigger a fork-bomb DoS.
- One-line fix in `pyproject.toml` (search: `litellm`):
  ```
  "litellm >= 1.75.5, != 1.82.7, != 1.82.8"
  ```
  Preserves the GPT-5 floor (`1.75.5`+), excludes the two compromised releases, allows the package resolver to fall back to the highest non-excluded version automatically.
- PR body includes explicit user remediation steps: `uv cache clean` / `pip cache purge`, audit `~/.config/` for unexpected files, rotate API keys if the compromised version had run while keys were in memory.

**Goat-flow application:**
- The `npm`-equivalent shape uses caret/tilde + explicit exclusion. For example, if package `foo` had `1.2.3` and `1.2.4` compromised, the `package.json` constraint becomes:
  ```json
  "foo": "^1.2.0 <1.2.3 || >1.2.4 <2.0.0"
  ```
  (`npm` does not have a direct `!=` operator like Python; the equivalent is the range-with-exclusion form above.)
- When a CVE/compromise lands, the fix is goat-flow's own `package.json` constraint, NOT just a lockfile bump in this repo. Lockfile bumps protect this repo's CI but not downstream consumers running `npm install @blundergoat/goat-flow@<version>` who regenerate their own lockfiles.
- Ship the constraint update in a patch release of `@blundergoat/goat-flow` as soon as the compromise is confirmed, with the disclosure noted in release notes and a one-line summary in `CHANGELOG.md`.
- If the compromised dependency is a transitive (not direct) dep, the fix path is either (a) pin the transitive via `overrides` in `package.json`, or (b) pin or update the intermediate direct dep that pulls it in. Document which approach was used so future reviews don't unwind the pin accidentally.
- Add the disclosed bad versions to a security-tracking note (CHANGELOG entry or `SECURITY.md`) so the constraint isn't "cleaned up" months later by a maintainer who doesn't know what the `!=` was for.

**When NOT to use:**
- Routine dependency-incompatibility issues (a release has a bug, but nothing malicious) — prefer a floor bump (`>= 1.2.5`) over a specific `!=`, because the bug will likely be fixed in patch releases that the `!=` would still allow.
- Use `!=` / range-with-exclusion specifically for security exclusions, where the bad version must be structurally unreachable regardless of how the rest of the constraint resolves.
