# ADR-065: Deny secret content shapes and credential stores, not folder names

**Status:** Accepted
**Date:** 2026-09-02
**Ticket/Context:** `.goat-flow/plans/permissions-rebalance/M01-rebalance-secret-denies.md` (local working state, not committed evidence)
**Updated:** 2026-09-05 - condensed; the release-documentation consequence records that the changelog entry is still outstanding.

## Context

The shipped permission templates denied `**/secrets/**` and `**/credentials*` for Read and Edit, and the Bash deny hook blocked any command naming a `secrets` path segment or a `credentials` token. A consumer project with a secrets page under `src/pages/secrets/` could not have that code read or edited by Claude, and a NextAuth `credentials.ts` provider hit the same wall. Claude Code evaluates deny before allow in every settings scope, so no local allow rule could reopen the path; the only fix was editing the shipped rules, and on Codex the installer put them back on the next upgrade.

Two more defects surfaced against the Claude Code permissions documentation. Bare `**/` patterns in project settings resolve under the working directory, so the rules for `.ssh`, `.aws`, `.gnupg`, `.docker/config.json`, `.kube/config`, `.npmrc`, and `.pypirc` matched only copies inside the project tree and never protected the real home-directory stores, which are the realistic prompt-injection target for the Read tool. The settings-layer denies for `sudo`, `mkfs`, `dd`, and `git reset --hard` duplicated `deny-dangerous.sh`, which already blocks them with a tokenizing parser, while the settings globs match as substrings and denied read-only commands that merely quoted the word; two such denials happened in the 2026-09-02 session.

`goat-flow install` repaired only three stale rule shapes on upgrade and never converged an existing file toward the template, while the Codex path re-added any missing canonical pattern. Neither model let a project opt out of an over-broad rule.

## Decision

Shipped deny rules match secret content shapes and credential stores, never plain folder or file names.

- Keep the ADR-025 `Bash(*git commit*)` and `Bash(*git push*)` rules, the eight enumerated `.env` variants for Read and Edit, and the `pem`, `key`, and `pfx` extensions for Read and Edit. The settings layer keeps only those two Bash rules, whose bluntness ADR-025 accepts deliberately; fail-closed enforcement belongs in the hook, whose parser can tell a command from a quotation.
- Anchor credential-store rules at the home directory on Claude: `~/.ssh/**`, `~/.aws/**`, `~/.gnupg/**`, `~/.config/gcloud/**`, `~/.docker/**`, `~/.kube/**`, `~/.npmrc`, `~/.pypirc`, each for Read and Edit. The Read tool bypasses the Bash hook, so only a `~/` rule stops it opening `~/.aws/credentials`. Codex workspace-root grammar cannot express home paths, so its profile keeps the workspace-relative forms plus `**/.config/gcloud/**`, and the Bash hook covers shell access to home stores for every agent.
- Retire `**/secrets/**` and `**/credentials*` from both templates, the dashboard reporting profile, and the hook's path regexes. The hook keeps the exact `credentials.json` download and the registry auth files. A folder or file name is not evidence of secret content; an extension such as `.pem` or a dotfile store such as `.aws` is, and content-shape rules have no known collision with application code.
- Retire `Bash(*sudo *)`, `Bash(*mkfs*)`, `Bash(*dd if=*)`, and `Bash(*git reset --hard*)` from the settings layer; the hook owns them.

Upgrades carry the change through narrow, printed migrations, never wholesale replacement. Claude install removes the eight retired deny rules and rewrites the seven in-project credential-store rules to their `~/` form, touching the deny list only; an allow or ask rule with the same text is the user's choice. Codex refreshes a profile that still carries a retired pattern the way it refreshes one missing a canonical pattern, and project-added patterns survive. Every removal is printed, because a hand-typed rule with the same text cannot be told from a shipped one. The `goat-flow setup` upgrade prompt gains a reconcile step where the agent compares the installed file with the template, proposes missing rules, keeps project additions, and asks before restoring anything that looks deliberately removed; the installer never adds template rules to an existing file.

## Failure Mode Comparison

| Option | What fails | Verdict |
| --- | --- | --- |
| Keep `**/secrets/**` and document a manual removal | Codex install re-adds it, the hook still blocks the folder, and every affected project repeats the investigation | Rejected |
| Root-anchor the folder rules (`/secrets/**`) | Still collides with a root-level application folder; the installer already drops a bare `secrets/**` as legacy | Rejected |
| Config-level opt-out list for settings and hook | Coherent, but a new configuration contract for a rule set that should not need opting out of | Deferred; revisit if a content-shape rule ever collides |
| Converge installed files to the template on every upgrade | Silently reverts deliberate local removals | Rejected |
| Content-shape rules, home anchors, printed retirements, agent-driven reconcile | One judgment call per upgrade for the agent | Accepted |

## Consequences

- `test/unit/agent-config-template-parity.test.ts` forbids folder-name heuristics and in-project credential-store rules on either template and limits settings-layer Bash denies to the ADR-025 pair.
- The hook self-test and `test/integration/deny-dangerous-policy.test.ts` assert that a nested secrets route and a `credentials.ts` provider stay readable while `.env`, key files, `credentials.json`, and home stores stay blocked.
- `deny-covers-secrets` no longer requires a secrets-directory family in the hook or a `secrets/**` or `credentials*` pattern in a Codex profile; env, key-store, registry, and key-extension families remain required.
- A project whose secret material lives in an extensionless file under a folder named `secrets/` loses the folder-level deny. The Stop-time safety scan and the env and key-extension rules remain; teams that want the folder rule add it as a project-owned deny, which upgrades preserve.
- The retired rules and the reconcile step are not in the v1.17.0 changelog as of 2026-09-05; documenting them is an open release task outside this decision.

## Reversibility

Reversible through a new decision that restores the retired patterns to both templates, the installer's canonical lists, the audit's family requirements, and the hook regexes together; restoring one surface alone recreates the audit and parity drift this change removed.
