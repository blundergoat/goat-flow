---
goat-flow-reference-version: "1.4.0"
---
# goat-security reference: dependency and supply chain

Use this pack for lockfiles, install scripts, third-party actions, packages, registries, or release automation.

## Common failure classes

- unpinned or floating versions on high-privilege dependencies
- install / postinstall scripts executing remote code
- third-party GitHub Actions without digest or reviewed version pins
- dependency alerts on packages not actually used at runtime
- repo automation trusting artifacts or outputs from untrusted branches

## High-signal review questions

- Is the dependency or action pinned to a reviewed version or digest?
- Does install or CI run downloaded code immediately?
- Is the vulnerable package reachable in production or privileged build paths?
- Can an external contributor influence release inputs or artifact consumers?

## Strong evidence patterns

- `curl | bash`, `wget | sh`, base64-decoded execution, or `node -e "$(curl ...)"`
- workflow uses `pull_request_target` with untrusted checkout or secrets exposure
- action references `@main`, `@master`, or broad semver on privileged jobs
- package manager hooks executing arbitrary scripts in CI or setup paths

## Common false positives

- vulnerable package is dev-only and isolated from privileged paths
- scanner flags an advisory with no affected version in the lockfile
- action is pinned and permissions are least-privilege even if the name looks risky

## Lead-only tooling

- `npm audit`
- `pnpm audit`
- `pip-audit`
- `cargo audit`

Always confirm package reachability, installed version, and runtime or CI impact before promoting the lead.
