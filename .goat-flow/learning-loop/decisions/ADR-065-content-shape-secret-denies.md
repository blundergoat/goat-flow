# ADR-065: Deny secret content shapes and credential stores, not folder names

**Status:** Accepted
**Date:** 2026-09-02
**Ticket/Context:** `.goat-flow/plans/permissions-rebalance/M01-rebalance-secret-denies.md` (local working state, not committed evidence)

## Context

The shipped permission templates denied `**/secrets/**` and `**/credentials*` for Read and Edit, and the Bash deny hook blocked any command naming a `secrets` path segment or a `credentials` token. A consumer project with a secrets page under `src/pages/secrets/` could not have that code read or edited by Claude, and a NextAuth `credentials.ts` provider hit the same wall. Claude Code evaluates deny before allow in every settings scope, so no local allow rule could reopen the path; the only fix was editing the shipped rules, and on Codex the installer put them back on the next upgrade.

Two further defects surfaced while checking the rule set against the Claude Code permissions documentation:

- Bare `**/` patterns in project settings resolve under the working directory. The rules for `.ssh`, `.aws`, `.gnupg`, `.docker/config.json`, `.kube/config`, `.npmrc`, and `.pypirc` therefore only matched copies inside the project tree and never protected the real credential stores in the home directory, which are the realistic prompt-injection target for the Read tool.
- The settings-layer denies for `sudo`, `mkfs`, `dd`, and `git reset --hard` duplicated `deny-dangerous.sh`, which already blocks those commands with a tokenizing parser, while the settings globs match as substrings and denied read-only commands that merely quoted the word. Two such denials happened in the 2026-09-02 session while investigating this rule set.

`goat-flow install` repaired only three stale rule shapes on upgrade and never converged an existing file toward the template, while the Codex path re-added any missing canonical pattern. Neither ownership model let a project opt out of an over-broad rule.

## Decision

Shipped deny rules match secret content shapes and credential stores, never plain folder or file names.

- Keep the ADR-025 `Bash(*git commit*)` and `Bash(*git push*)` rules, the eight enumerated `.env` variants for Read and Edit, and the `pem`, `key`, and `pfx` extensions for Read and Edit.
- Anchor credential-store rules at the home directory on Claude: `~/.ssh/**`, `~/.aws/**`, `~/.gnupg/**`, `~/.config/gcloud/**`, `~/.docker/**`, `~/.kube/**`, `~/.npmrc`, `~/.pypirc`, each for Read and Edit. Codex workspace-root grammar cannot express home paths, so its profile keeps the workspace-relative forms plus `**/.config/gcloud/**`, and the Bash hook covers shell access to home stores for every agent.
- Retire `**/secrets/**` and `**/credentials*` from both templates, from the dashboard reporting profile, and from the hook's path regexes. The hook keeps the exact `credentials.json` download and the registry auth files.
- Retire `Bash(*sudo *)`, `Bash(*mkfs*)`, `Bash(*dd if=*)`, and `Bash(*git reset --hard*)` from the settings layer; the hook owns them.

Upgrades carry the change into installed files through narrow, printed migrations rather than wholesale replacement:

- Claude: install removes the eight retired deny rules, rewrites the seven in-project credential-store rules to their `~/` form for Read and Edit, and otherwise leaves the file alone. Retirement and rewriting apply to the deny list only; an allow or ask rule with the same text is the user's own choice.
- Codex: a profile that still carries a retired pattern is refreshed like one missing a canonical pattern, and patterns the project added survive.
- Every removal is printed, because a rule the project typed by hand with the same text cannot be told apart from a shipped one.
- The upgrade prompt from `goat-flow setup` gains a reconcile step where the agent compares the installed file with the template, proposes missing rules, keeps project additions, and asks before restoring anything that looks deliberately removed. The installer never adds template rules to an existing file.

## Rationale

- A folder or file name is not evidence of secret content, but an extension such as `.pem` or a dotfile store such as `.aws` is. Rules keyed on content shapes have no known collision with application code.
- Home anchoring closes a real gap: the Read tool bypasses the Bash hook, and only a `~/` rule stops it opening `~/.aws/credentials`.
- Fail-closed enforcement belongs where the parser can tell a command from a quotation. The settings layer keeps only the two rules whose bluntness ADR-025 accepts deliberately.
- Printed removals plus an agent-driven reconcile step give upgrades a coherent contract: goat-flow may retract what it shipped, and the user decides everything else with the diff in front of them.

## Failure Mode Comparison

| Option | What fails | Why rejected or accepted |
| --- | --- | --- |
| Keep `**/secrets/**` and document a manual removal | Codex install re-adds it; the Bash hook still blocks the folder; every affected project repeats the same investigation | Rejected |
| Root-anchor the folder rules (`/secrets/**`) | Still collides with a root-level application folder, and the installer already treats a bare `secrets/**` as a legacy shape to drop | Rejected |
| Add a config-level opt-out list applied to settings and hook | Coherent, but a new configuration contract for a rule set that should not need opting out of | Deferred; revisit if a content-shape rule ever collides |
| Converge installed files to the template on every upgrade | Silently reverts deliberate local removals | Rejected |
| Content-shape rules, home anchors, printed retirements, agent-driven reconcile | Asks the agent for one judgment call per upgrade | Accepted |

## Consequences

- `test/unit/agent-config-template-parity.test.ts` forbids folder-name heuristics and in-project credential-store rules on either template and limits settings-layer Bash denies to the ADR-025 pair.
- The hook self-test and `test/integration/deny-dangerous-policy.test.ts` assert that a nested secrets route and a `credentials.ts` provider stay readable while `.env`, key files, `credentials.json`, and home stores stay blocked.
- `deny-covers-secrets` no longer requires a secrets-directory family in the hook or a `secrets/**` or `credentials*` pattern in a Codex profile; env, key-store, registry, and key-extension families remain required.
- A project whose secret material lives in an extensionless file under a folder named `secrets/` loses the folder-level deny. The Stop-time safety scan and the env and key-extension rules remain; teams that want the folder rule add it as a project-owned deny, which upgrades preserve.
- The 1.17.0 release owner documents the retired rules and the new reconcile step; the changelog is outside this decision.

## Reversibility

Reversible through a new decision that restores the retired patterns to both templates, the installer's canonical lists, the audit's family requirements, and the hook regexes together; restoring one surface alone recreates the audit and parity drift this change removed.
