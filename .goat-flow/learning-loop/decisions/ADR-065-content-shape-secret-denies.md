# ADR-065: Deny secret content shapes and credential stores, not folder names

**Status:** Accepted
**Date:** 2026-09-02
**Ticket/Context:** `.goat-flow/plans/permissions-rebalance/M01-rebalance-secret-denies.md` (local working state, not committed evidence)
**Updated:** 2026-09-25 - retain Claude credential-store protection at home and inside the project after the owner approved both locations.

## Context

The shipped permission templates denied `**/secrets/**` and `**/credentials*` for Read and Edit, and the Bash deny hook blocked any command naming a `secrets` path segment or a `credentials` token. A consumer project with a secrets page under `src/pages/secrets/` could not have that code read or edited by Claude, and a NextAuth `credentials.ts` provider hit the same wall. Claude Code evaluates deny before allow in every settings scope, so no local allow rule could reopen the path; the only fix was editing the shipped rules, and on Codex the installer put them back on the next upgrade.

Two more defects surfaced against the Claude Code permissions documentation. Bare `**/` patterns in project settings resolve under the working directory, so the rules for `.ssh`, `.aws`, `.gnupg`, `.docker/config.json`, `.kube/config`, `.npmrc`, and `.pypirc` matched only copies inside the project tree and never protected the real home-directory stores, which are the realistic prompt-injection target for the Read tool. The settings-layer denies for `sudo`, `mkfs`, `dd`, and `git reset --hard` duplicated `deny-dangerous.sh`, which already blocks them with a tokenizing parser, while the settings globs match as substrings and denied read-only commands that merely quoted the word; two such denials happened in the 2026-09-02 session.

`goat-flow install` repaired only three stale rule shapes on upgrade and never converged an existing file toward the template, while the Codex path re-added any missing canonical pattern. Neither model let a project opt out of an over-broad rule.

## Decision

Shipped deny rules match secret content shapes and credential stores, never plain folder or file names.

- Keep the ADR-025 `Bash(*git commit*)` and `Bash(*git push*)` rules, the eight enumerated `.env` variants for Read and Edit, and the `pem`, `key`, and `pfx` extensions for Read and Edit. The settings layer keeps only those two Bash rules, whose bluntness ADR-025 accepts deliberately; fail-closed enforcement belongs in the hook, whose parser can tell a command from a quotation.
- Protect each credential store at home and inside the project on Claude: `.ssh/**`, `.aws/**`, `.gnupg/**`, `.config/gcloud/**`, `.docker/**`, `.kube/**`, `.npmrc`, `.pypirc`, `.netrc`, `.git-credentials`, `.config/gh/hosts.yml`, `.pgpass`, each with both `~/` and `**/` anchors for Read and Edit. These tools bypass the Bash hook. Home anchors protect the developer's stores; project patterns protect copied stores and local registry tokens. Codex workspace-root grammar keeps its workspace-relative forms, and the Bash hook covers shell access to home stores for every agent. Exact plaintext filenames must not deny their `.example` documentation controls.
- Retire `**/secrets/**` and `**/credentials*` from both templates, the dashboard reporting profile, and the hook's path regexes. The hook keeps the exact `credentials.json` download and the registry auth files. A folder or file name is not evidence of secret content; an extension such as `.pem` or a dotfile store such as `.aws` is, and content-shape rules have no known collision with application code.
- Retire `Bash(*sudo *)`, `Bash(*mkfs*)`, `Bash(*dd if=*)`, and `Bash(*git reset --hard*)` from the settings layer; the hook owns them.

Upgrades carry the change through narrow, printed migrations, never wholesale replacement. Claude install removes the eight retired deny rules and pairs an existing credential-store deny with its missing home or project partner. Legacy Docker and Kubernetes file rules expand to the matching store pair. Allow and ask rules remain the user's choice, and a store with neither deny remains absent. Every addition and removal is printed. Already complete credential pairs keep their saved order so repeat installation remains byte-stable. Codex preserves project additions while refreshing retired or incomplete profiles. Other missing template rules still require the reviewed setup reconcile step; install does not restore the entire deny list.

The earlier home-only migration removed project coverage. The September 25 review reproduced that loss through the installer; `test/integration/setup-install.test.ts` (search: `in-project ssh rule preserved`) now checks both locations. The owner chose paired protection because home-only and project-only rules each leave a credential copy reachable through Read or Edit.

## Failure Mode Comparison

| Option | What fails | Verdict |
| --- | --- | --- |
| Keep `**/secrets/**` and document a manual removal | Codex install re-adds it, the hook still blocks the folder, and every affected project repeats the investigation | Rejected |
| Root-anchor the folder rules (`/secrets/**`) | Still collides with a root-level application folder; the installer already drops a bare `secrets/**` as legacy | Rejected |
| Config-level opt-out list for settings and hook | Coherent, but a new configuration contract for a rule set that should not need opting out of | Deferred; revisit if a content-shape rule ever collides |
| Converge installed files to the template on every upgrade | Silently reverts deliberate local removals | Rejected |
| Home-only credential rules | Project-local credential copies remain reachable through Read and Edit | Replaced on 2026-09-25 |
| Content-shape rules, paired credential anchors, printed migrations, agent-driven reconcile | A project that wants one store location readable must review its paired denies | Accepted |

## Consequences

- `test/unit/agent-config-template-parity.test.ts` forbids folder-name heuristics, requires both Claude credential-store locations, and limits settings-layer Bash denies to the ADR-025 pair.
- The hook self-test and `test/integration/deny-dangerous-policy.test.ts` assert that a nested secrets route and a `credentials.ts` provider stay readable while `.env`, key files, `credentials.json`, and home stores stay blocked.
- `deny-covers-secrets` no longer requires a secrets-directory family in the hook or a `secrets/**` or `credentials*` pattern in a Codex profile; env, key-store, registry, plaintext credential-store and key-extension families remain required. Existing Claude settings missing the new stores need the reviewed setup reconcile step; a normal install does not silently add those denies.
- A project whose secret material lives in an extensionless file under a folder named `secrets/` loses the folder-level deny. The Stop-time safety scan and the env and key-extension rules remain; teams that want the folder rule add it as a project-owned deny, which upgrades preserve.
- `CHANGELOG.md` (search: `Credential rules protect home and project copies`) records the paired-store migration; missing unrelated rules still require reviewed reconciliation.

## Reversibility

Reversible through a new decision that restores the retired patterns to both templates, the installer's canonical lists, the audit's family requirements, and the hook regexes together; restoring one surface alone recreates the audit and parity drift this change removed.
