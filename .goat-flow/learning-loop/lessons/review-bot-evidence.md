---
category: review-bot-evidence
last_reviewed: 2026-08-15
---

**Scope:** Weighing an automated reviewer's output - sandbox reruns that reach different conclusions, position-independent ordering findings, an "addressed" marker that proves nothing, and a bot finding that contradicts a passing test. Human and multi-agent critique is [review-feedback.md](review-feedback.md).

## Lesson: External code-review bots that re-run verification commands in their own sandbox produce false-positive Critical findings

**Status:** active | **Created:** 2026-05-24

**Prevention:**
1. Triage bot review findings into two buckets: (a) "bot read the code and named a defect" → verify by reading the code; (b) "bot ran a command and reported failure" → rerun the command locally before accepting. On PR #44 every category-a finding from the Codex bot held up; every category-b finding from CodeRabbit was wrong.
2. Hallucination red-flag #1 in CLAUDE.md ("do not claim tests pass without the literal pass/fail line") cuts both ways - do not accept a bot's failure claim either without re-running and quoting the line yourself.
3. Bot environment claims about project-wide tooling (typecheck, test, lint) are systematically unreliable because the bot's environment is not the project's environment. Treat the finding as "worth running the command yourself" not as evidence of a defect.
4. Stale bot findings: bots reviewing one commit at a time produce findings that were valid at that snapshot but stale by the time of triage. Always check the current HEAD before acting (e.g. PR #44's `acme/example` and "v1.7.1 / v1.8.0 mismatch" findings were both already fixed in later commits).

**What happened:** On PR #44, CodeRabbit raised three findings tagged Critical 🔴 / Major 🟠 across multiple inline comments:
- `npm run typecheck` exits non-zero with `TS2307: Cannot find module 'node:fs'` (cited as "blocks acceptance" on three different files).
- `npm test` fails immediately with `ERR_MODULE_NOT_FOUND: Cannot find package 'tsx'`.
- `scripts/preflight-checks.sh` fails shellcheck SC2329 because `_on_exit` and `_emit_footer` are "never invoked".

All three were wrong. Locally: `npm run typecheck` exits 0, `npm test` passes 833/833, `shellcheck` v0.9.0 on the cited script exits 0. `_on_exit` is registered with `trap '_on_exit' EXIT` at line 242 and calls `_emit_footer` at line 233 - both clearly used. Same PR also had Codex bot findings about the Codex install migration regex (search: `invalidNoneEntryPattern`) that were all correct on inspection.

**Root cause:** CodeRabbit runs verification commands in an ephemeral sandbox without the project's dev dependencies (`@types/node`, `tsx`) and reports the missing-module output as a project failure. Its shellcheck pass may also be a different version or invoked without project context, so it cannot see the `trap '_on_exit' EXIT` registration that satisfies SC2329.

---

## Lesson: Ordering findings ("section X must be first") are grep-position-independent - rate them by how the artifact is consumed

**Status:** resolved | **Created:** 2026-06-05 | **Resolved:** 2026-07-13

**What happened:** A 3-agent goat-critique of `workflow/skills/playbooks/` reached HIGH consensus that the README's "first section MUST be `## Availability Check`" rule was violated by `gruff-code-quality.md` (leads with `## Gruff at a glance`) and `page-capture.md` (leads with `## Boundary`), and recommended reordering both. Orchestrator double-check downgraded it: agents locate the section by grepping `## Availability Check`, which succeeds at any line position, so "present but not first" is cosmetic - while the sections that precede it (gruff's at-a-glance TL;DR, page-capture's "am I in the right playbook?" routing table) legitimately earn the top slot. The only real defect was `skill-quality-testing.md` having NO such section (grep returns zero) - the one file actually fixed.

**Root cause:** The finding conflated two consumption models. "Must be FIRST" serves *human top-down scanning*; "must be PRESENT and findable" serves *grep/agent retrieval*. These playbooks are consumed by agents that grep for the heading, so position is nearly irrelevant and absence is the only real failure. The README's own justification even says "This is what agents grep for" - i.e. position-independent. Three agents rated by the letter of the rule; consensus amplified the miscalibration instead of catching it.

**Evidence at the time:** `workflow/skills/playbooks/README.md` required a grep-findable Availability Check, while the first H2 remained different in two playbooks and the skill-quality-testing reference had no such section.

**Resolution:** M12 later made Availability Check the deliberate first-H2 contract because cold-start users and agents need capability limits before procedural guidance. The audit now parses and enforces that order, and every standalone playbook conforms. Current anchors: `workflow/skills/playbooks/skill-playbook-authoring-sync.md` (search: "After the title and short orientation") and `src/cli/audit/skill-docs-contract.ts` (search: "standalonePlaybookContractFailure"). The original critique was over-scoped against the old contract; the later explicit contract change does not retroactively make that unverified recommendation correct.

**Prevention:**
1. For an ordering finding ("X must be first/before Y"), identify how the artifact is consumed (grep, top-down scan, or parser) and read the current contract before assigning severity.
2. Do not infer an ordering rule from a presence rule; add deterministic enforcement when ordering becomes intentional.
3. Consensus severity is not a substitute for the consumption-model check. Verify the premise, then rate.

---

## Lesson: A bot finding that contradicts a passing test is a design question, not a bug

**Status:** active | **Created:** 2026-08-10 | **Evidence:** ACTUAL_MEASURED

**Prevention:** Before acting on any review finding, grep the test suite and self-test for the behaviour it wants changed. Run the full suite after each guard edit rather than at the end - the 22-failure spike localised both mistakes immediately. Prefer narrowing a fix to the unsafe input (`/dev`, `/proc`, `-`) over removing a whole capability; the codebase usually already owns that predicate. Evidence anchors: `workflow/hooks/deny-dangerous/patterns-shell.sh` (search: `is_shell_name`), `workflow/hooks/deny-dangerous/deny-dangerous-self-test.sh` (search: `stdin rcfile before bash script`).

**What happened:** Among 41 automated review comments triaged on PR #58, two Codex findings were mechanically correct about the code yet wrong to act on. Codex reported that the managed hook launcher walks past a nested Git root and adopts an enclosing project's install. The code confirmed it. Applying the suggested reorder (explicit host root before the ancestor walk, walk bounded at the Git root) turned 2 test failures into 22, because `test/unit/hook-registrar.test.ts` (search: `selects Git first, then the nearest complete managed ancestor`) creates a plain `git init` directory inside a managed root and asserts the launcher still resolves the outer install. The reported hazard and the asserted behaviour are the same behaviour. Separately, blanket-rejecting `--rcfile` in the shell exemption to close a real `bash --rcfile /dev/stdin -i script.sh` bypass also broke `printf payload | bash --rcfile scripts/bashrc scripts/import-data.sh`, a legitimate checked-in startup file the self-test already covered.

**What this means:** Verifying the mechanism is only half the triage. A finding can describe real code accurately and still be a proposal to change intended behaviour. The deciding evidence is whether a test, ADR, or self-test case already asserts the current behaviour on purpose - if one does, the finding is a design question for the owner, not a defect to fix in a review-response pass. When a guard's parser skips an option to reach a safe operand, the fix is to validate that option's operand with the checker already in the file (`script_file_word_is_safe`), not to reject the option and lose its valid uses.

## Lesson: For a guard rewrite, run the base build - reading the base diff cannot tell a message change from a verdict change

**Status:** active | **Created:** 2026-08-11 | **Evidence:** ACTUAL_MEASURED

**Prevention:** When the reviewed surface is a guard, parser, or classifier with an observable verdict, extract the base version into a scratch directory and run one probe matrix against base and head, printing both exit codes side by side. Build the matrix from the suspicions, one row each, and label each row `same`, `newly-blocked`, or `newly-allowed`; the labels do the triage. Reserve the technique for behavioural surfaces - it proves nothing about code with no runnable verdict. This extends the "Regression without a baseline read" trap in `workflow/skills/goat-review/references/review-traps.md` (search: `Regression without a baseline read`), which asks for a baseline read; for guards, reading is not enough.

**What happened:** Reviewing the deny-policy rewrite in PR #58, Pass 1 raised four regression suspicions from the diff alone. The new `is_inert_download_pipe_consumer` rule appeared to newly block `curl` piped into `tar`, `sha256sum`, `sed`, `base64`, `less`, and `gunzip`. Dropping the trailing-slash requirement in `is_secret_path_touch` appeared to newly deny any command mentioning `secrets`. Removing two legacy pipe-to-shell regexes appeared to drop coverage. Adding `vendor` and `target` to the disposable-path list appeared to newly permit deleting real directories. Extracting the base-OID policy files into a scratch directory and running the same probe matrix against both builds refuted all four: every verdict was identical at base and head. The download rules changed the deny message, not the decision. `ls secrets` and `git log --grep secrets` were already denied. `rm -rf target` was already permitted by the existing no-slash rule, so the list addition changed nothing. Only `watch` and `parallel` unwrapping was a real behaviour change, and it moved in the safe direction.

**Root cause:** A guard rewrite changes the text of nearly every branch, so a diff of the source shows large movement whether or not any verdict moved. Reading `git show <base>:<file>` answers what the code used to say, not what it used to decide. For policy code the decision is the contract, and only executing both builds against the same inputs distinguishes a refactor from a regression. Four of thirteen refutations in that review came from this one technique; without it, the report would have carried four false regressions against a release that is strictly safer than its base.

---

## Lesson: A review bot's own "addressed" marker is not evidence the fix landed

**Status:** active | **Created:** 2026-08-10 | **Evidence:** ACTUAL_MEASURED

**Prevention:** Triage automated review comments against the current checkout, never against the comment text. Check the file content for "addressed" claims and re-read the cited symbol for open ones. Evidence anchors: `docs/coding-standards/git-commit-message.md` (search: `never longer`), `CLAUDE.md` (search: `Conventional `).

**What happened:** On PR #58, CodeRabbit appended `✅ Addressed in commits d40df9d to 5924750` to its finding that `docs/coding-standards/git-commit-message.md` contradicted the repository's 72-character subject rule. The file still read `No hard character limit` at review time, while `CLAUDE.md`, `AGENTS.md`, and `.github/copilot-instructions.md` all stated `≤72 chars`. Two other bot findings were the inverse: stale rather than unfixed. Codex reported that the release artifacts still identified as 1.15.0 and that the evidence contract had no production consumer, but `package.json`, `workflow/manifest.json`, and `CHANGELOG.md` were already at 1.15.1 and three server modules already imported the contract. Both classes are produced by bots reviewing an older commit than the branch head.

**What this means:** Resolution markers and finding bodies both describe the commit the bot last read, not the working tree. Every finding needs re-verification against current `HEAD` before it is accepted or dismissed, in both directions - a marker claiming a fix landed, and a finding claiming a defect exists.
