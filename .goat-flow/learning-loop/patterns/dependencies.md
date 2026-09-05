---
category: dependencies
last_reviewed: 2026-09-05
---

## Pattern: Pin AWAY from known-bad versions via `!=`, not only `>=`

**Context:** A direct dependency ships a compromised or broken release. Bumping this repo's lockfile protects CI only; consumers who install `@blundergoat/goat-flow` regenerate their own lockfiles and can still resolve the bad version.

**Approach:** Exclude the specific versions in the published constraint while leaving the range open for legitimate releases. Python: `"litellm >= 1.75.5, != 1.82.7, != 1.82.8"`. npm has no `!=`, so use a range with a gap: `">=1.2.0 <1.2.3 || >1.2.4 <2.0.0"`. For a transitive dependency, pin it through `overrides` in `package.json` or move the direct dependency that pulls it in, and record which was done so a later cleanup does not unwind it. Ship the constraint in a patch release with the disclosure in `CHANGELOG.md` or `SECURITY.md`. Preflight's bounded `npm audit` step (`scripts/preflight-checks.sh`, search: `section "Dependency Audit"`) reports advisories for the installed versions; it does not protect consumers, the published constraint does.

**Evidence (EXTERNAL_REFERENCE):** mini-swe-agent PR #794 (merged 2026-03-24, the day of disclosure) answered the litellm 1.82.7 and 1.82.8 supply-chain attack, which exfiltrated API keys through a malicious `.pth` file, with the one-line `pyproject.toml` exclusion above plus user remediation: purge caches, audit `~/.config/`, rotate keys.

**When not to use:** A plain bug in one release; prefer a floor bump (`>= 1.2.5`) so later patch releases stay reachable. Reserve exclusions for versions that must stay unreachable however the rest of the range resolves.
