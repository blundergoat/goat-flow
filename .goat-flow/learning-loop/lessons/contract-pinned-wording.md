---
category: contract-pinned-wording
last_reviewed: 2026-10-11
---

**Scope:** Changing prose, a path, an adjacent section, or a word budget that tests or semantic anchors already pin, and the full-suite failures that follow when the exact old text was not searched first. Other pinned-contract lessons, such as anchor-preserving compaction and user-visible serialization, are [contract-testing.md](contract-testing.md); instruction and reference word budgets are [instruction-word-budgets.md](instruction-word-budgets.md).

## Lesson: Contract tests pin doctrine wording and path semantics

**Status:** active | **Created:** 2026-04-25 | **Evidence:** OBSERVED
**Severity:** INTEGRATION
**Incident count:** 27 | **Latest occurrence:** 2026-10-11
**Merged:** 2026-10-11 - moved here from `.goat-flow/learning-loop/lessons/verification-testing.md` when that bucket was split to recover its headroom.

**Prevention:** Before changing prose, a path, or an adjacent command, search the tests and durable semantic anchors for the exact old text; sibling parity proves agreement, not preservation of downstream contracts. Keep fixtures inside their consuming subtest. When fixture size feeds a derived assertion, recompute it with the production formula after every fixture edit. Update a contract only when product semantics change. Before drafting in a near-cap skill, measure the current word budget and pay for additions from unpinned text; before quoting a budget or score outcome, measure the exact sizes with the function the gate uses and state the margin.

Read Markdown helper signatures before calling them; a setup exception is not evidence that the intended contract is missing.

**What happened:** Removing one forbidden phrase and changing dashboard quality-report ownership failed two contract checks in the first full `npm test`: a skill-hardening contract still required the "hardening debt" evidence language, and a dashboard prompt-source assertion still expected the old relative quality-report path message. `test/contract/skill-hardening-shared-3.test.ts` (search: `hardening debt`).

**Root cause:** Wording cleanup and path-semantics changes were treated as local edits, but these surfaces are pinned by tests because agents consume the exact phrasing.

- **Recurrence 2026-05-17:** `test/smoke/dashboard-endpoints.test.ts` (search: `rejects missing and file project paths before PTY launch`) still
  asserted the old `Invalid project path` wording after `validateProjectPath` moved to the shared contract in `src/cli/server/local-paths.ts` (search:
  `Local path validation failed`).
- **Recurrence 2026-07-13:** A manual JSON probe assumed a root `groups` key instead of the implemented `surfaces` groups; the locked fixture was
  right and the probe was rewritten against `goat-flow.context-report.v1`. `test/unit/context-report.test.ts` (search: `renders parseable JSON without
  telemetry or provider state`).
- **Recurrence 2026-07-19:** A `setupPrompt` fixture landed in the preceding subtest, so RED failed with `setupPrompt is not defined` instead of the
  intended prompt-copy assertion. `test/contract/command-phrases.test.ts` (search: `keeps git-history correlations as candidates until semantic proof
  exists`).
- **Recurrence 2026-07-29:** Pins include adjacency: inserting an `## Effort Estimates` section between the illustrative-scenario label and `##
  Assumption Tracking` in `goat-plan/references/milestone-examples.md` failed `test/contract/skill-hardening-shared-3.test.ts` (search: `scenario
  label must immediately precede the assumption block`).
- **Recurrence 2026-08-03:** The first GREEN wording for oversized review scope and critique context merging pushed `goat-review` and `goat-critique`
  from 2495/2494 words to 2592/2531; budget-neutral rewrites finished at 2498/2495. `workflow/skills/goat-review/SKILL.md` (search: `never guess
  commit windows`), `workflow/skills/goat-critique/SKILL.md` (search: `never replace baseline context`),
  `test/contract/skill-hardening-review-1.test.ts` (search: `stops oversized inferred branch scopes before review begins`).
- **Recurrence 2026-08-09:** A new roadmap passed `plans check --strict` after six mid-proof estimates were fixed, while 24 `Read first` anchors still
  named stale paths or paraphrases; each validator proves only its named contract, so paths and semantic anchors need their own exact check.
  `src/cli/plans-check.ts` (search: `mid-proof item(s) missing an (est: ...) entry`), `test/unit/plans-check-lifecycle.test.ts` (search: `strict mode
  rejects unestimated testing and mid-proof work`).
- **Recurrence 2026-08-09 (goat-debug):** Qualifying a boundary command as `ALWAYS in Diagnose mode` passed the focused goat-debug contract but failed
  a shared contract that required the unqualified label; the shared contract now accepts the canonical label or that explicit qualifier.
  `workflow/skills/goat-debug/SKILL.md` (search: `ALWAYS in Diagnose mode`), `test/contract/skill-hardening-shared-1.test.ts` (search: `keeps
  canonical skill boundaries explicit and route-focused`).
- **Recurrence 2026-08-16:** A budget estimate from a glance ("~3,000 chars", reaching the 10/10 token tier) was wrong when measured: the two moved
  goat-security sections were 1,328 and 1,546 chars, the replacement pointers cut the net to 2,395, and the skill stayed at 5,151 tokens against a
  5,000 boundary, after the user had approved the plan on the estimate. `.goat-flow/learning-loop/footguns/skill-guidance.md` (search: `Dense
  functional skills satisfy the ADR-023 word cap`), `src/cli/quality/skill-quality-metrics.ts` (search: `tokens > 5000`).
- **Recurrence 2026-08-19:** Shortening the three instruction files passed parity and line-count checks, but `stats --check` rejected the removed
  durable anchor and full preflight failed 3 of 2,122 tests on the shortened external-write authorization sentence; both phrases were restored across
  the mirrors. `.goat-flow/learning-loop/lessons/agent-behavior.md` (search: `Coding agents never run`), `test/contract/command-phrases.test.ts`
  (search: `AUTHORIZATION_POLICY`).
- **Recurrence 2026-08-23:** Compressing the evidence matrix to restore its word budget changed a phrase cited by the new proof-boundary lesson;
  `stats --check` rejected the stale reference, retargeted to the live anchor. `.goat-flow/learning-loop/lessons/verification-gate-runs.md` (search:
  `Mid-implementation proof gates split edit batches`).
- **Recurrence 2026-08-23 (report schema):** The first full fast suite failed nine tests: one goat-qa contract still pinned the old gate sentence, and
  the shared dashboard capture fixture omitted the newly required `refuted_candidates` field. Updating the doctrine assertion and the one
  current-report fixture restored `# pass 2174`; legacy fixtures stay field-optional. `test/contract/skill-hardening-skills-1.test.ts` (search:
  `requires goat-qa Standard-mode gap output`), `test/unit/quality-draft-capture.test.ts` (search: `function validReport`).
- **Recurrence 2026-08-24:** Adding a heading to the INDEX unit fixture fixed the parser regression but changed the fixture's byte-derived token
  estimate from 70 to 80, failing the adjacent expectation; the first lesson record then cited the guessed field `tokenEstimate` until a source read
  gave the real name. `test/unit/learning-loop-index.test.ts` (search: `approxTokenEstimate`).
- **Recurrence 2026-08-24 (goat-plan):** A budget-neutral trim removed the adjacent Step 0 ordering contract's exact anchor; `Pick exactly one mode.
  First match:` restored both goat-plan contract files at 2,149 words, and the first evidence search omitted the Markdown bold boundary until narrowed
  to a raw-text substring. `workflow/skills/goat-plan/SKILL.md` (search: `Pick exactly one mode.`), `test/contract/skill-hardening-plan-1.test.ts`
  (search: `missing mode selection`).
- **Recurrence 2026-08-29:** Changing the code-comment playbook's tag doctrine failed one adjacent contract that required the superseded sentence; the
  first full suite then failed dashboard preset source/build parity until the dashboard build ran, and final preflight found an inherited Prettier
  failure in the unchanged doctrine contract. `workflow/skills/playbooks/code-comments.md` (search: `Preserve current valid tags`),
  `test/contract/comment-playbook-doctrine.test.ts` (search: `translates broad reviewability prompts into exhaustive diagnosis`),
  `scripts/build-dashboard-assets.mjs` (search: `preset-prompts.json`), `test/contract/skill-quality-testing-doctrine.test.ts` (search: `does not
  validate a specific skill`).
- **Recurrence 2026-08-29 (lesson anchor):** A recurrence cited `Score rationale`, absent from the target file in that case; `stats --check`
  rejected it, and the literal suite name restored the evidence chain. `test/unit/quality-diff-delta-tag.test.ts` (search: `quality diff score
  rationale`).

- **Recurrence 2026-09-08:** Clarity owner delegation missed public-reader assertions and the explicit selector exception in `docs/skills.md`; the
  optional catalogue rewrite was rewound. `test/contract/skill-hardening-clarity.test.ts` (search: `keeps the skill, reference, manifest, and public
  documentation aligned`) caught the mismatch. `stats --check` also caught a historical pointer to `workflow/skills/goat-clarity/SKILL.md` (search:
  `Added-test dispositions`); retain semantic anchors beside delegated owners and inspect every consumer before deleting its text.

- **Recurrence 2026-09-09:** The clarity dependency case passed a path to a helper that requires Markdown text and a source label. The missing-heading
  setup exception did not test the intended rule. Correct arguments exposed the actual missing instruction before guidance changed.
  `test/contract/skill-hardening.helpers.ts` (search: `readMarkdownSubsection`), `test/contract/skill-hardening-clarity.test.ts` (search: `uses
  drift-safe selector inventories and content identity`).

- **Recurrence 2026-09-09:** A claimed complete critique fixture omitted its second-pass prompt and clean marker. One original-loaded reader
  rejected it while another accepted it; rebuilding the control from a complete native return restored valid admission in four independent originals.
  The first new contract batch also exceeded the 1000-substantive-line limit; grouping unchanged assertions restored the size gate without removing
  a case. Owners: `workflow/skills/goat-critique/references/sub-agent-directives.md` (search: `Clean-result attestation`),
  `test/contract/skill-hardening-skills-2.test.ts` (search: `accepts verified clean goat-critique results without fabricated findings`),
  `.gruff-ts.yaml` (search: `size.file-length`).

- **Recurrence 2026-09-26:** Documenting the recovery guard changed the architecture claim path and the manifest's claim recovery wording. The full fast suite failed its local-data contract, which pins both phrases. Restoring the claim contract and adding guard detail beside it passed the focused contract. `test/contract/local-data-contract.test.ts` (search: `registers path-write claims as transient fail-closed coordination`), `.goat-flow/architecture.md` (search: `Local coordination state`), `workflow/manifest.json` (search: `exclusive path-write coordination`).

**Recurrence 2026-10-01:** A new Gruff test guessed the result label as `clean` instead of the observed `pass`, and native launch fixtures put `call` and `start` outside the explicit cmd body. The first assertions failed before proving the intended regressions. Read the result vocabulary and interpreter boundary before extending a fixture. For native WSL-to-cmd probes, inspect the transported bytes: argv quoting inserted backslashes into a quoted echo control, while stdin preserved the intended command and established the literal-caret result. A quality-diff wording change also left a row-integrity assertion matching the old prefix; preserve its control-character invariant while updating the displayed text. Owners: `test/integration/gruff-code-quality-contract.test.ts` (search: `deduplicates verified health when mkdir refuses absolute paths`), `workflow/hooks/deny-dangerous/deny-dangerous-self-test.sh` (search: `cmd caret-obfuscated publication`), and `test/unit/quality-diff-delta-tag.test.ts` (search: `keeps line-feed and carriage-return summaries on their own rows`).

**Recurrence 2026-10-01:** Three text assertions failed against the CLI's default JSON output. Read format defaults; explicit `--format text` restored the suite. `test/integration/quality-history-diff.test.ts` (search: `retains workspace conclusions`).

**Recurrence 2026-10-11:** Removing the runner's performance mode also rewrote the adjacent concurrency ternary; the first fast suite failed one source-regex pin that the grep for the removed mode's names could not find. Restoring the pinned line fixed it: search each adjacent edited line for its exact text. `scripts/run-tests.mjs` (search: `mode === "slow" ? "1" : mode === "fast" ? "8" : "8"`), `test/integration/preflight-progress.test.ts` (search: `keeps fast concurrency bounded`).
