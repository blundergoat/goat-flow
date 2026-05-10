---
goat-flow-reference-version: "1.6.0"
---
# Skill Quality Testing

Read on full-depth skill-authoring work. Covers how to write, test, and harden a goat-flow skill so it holds up under pressure.

Companion to `skill-preamble.md` (what every skill loads on every invocation) and `skill-conventions.md` (entry formats, task tracking, recovery - loaded on full-depth work).

The authoring methodology is split across three topical files in the sibling `skill-quality-testing/` directory. Load only the file(s) relevant to the skill type you are authoring - agents should not read all three unless the task genuinely spans review-class work, deployment finalisation, and TDD iteration.

## Which file to load

| File | Content | Load when |
|------|---------|-----------|
| `skill-quality-testing/tdd-iteration.md` | The iron law, TDD loop (RED/GREEN/REFACTOR), pressure types, scenario design, rationalisation table, bulletproofing techniques, persuasion principles, meta-testing, dispatch protocol, iteration log, worked example, empirical grounding | Creating or hardening any skill. Load first. |
| `skill-quality-testing/adversarial-framing.md` | Cynical-reviewer role prompt, zero-findings HALT rule, parallel reviewer pattern, structured finding schema | Authoring or hardening a review-class skill (goat-review, goat-critique, goat-qa) |
| `skill-quality-testing/deployment.md` | Skip-testing rationalisations, deployment checklist (RED/GREEN/REFACTOR phases + quality checks + deployment gates), STOP-before-next-skill rule | Finalising any skill before merge |

## The iron law (always-loaded anchor)

> **No skill without a failing test first.**

This applies to NEW skills AND to EDITS of existing skills. Writing a skill before watching an agent fail produces documentation of what you think needs preventing, not what actually needs preventing. See `skill-quality-testing/tdd-iteration.md` for the full methodology.

## Verification claim evidence

Use this table when a skill or agent needs to substantiate a generic verification claim (tests, build, fix, regression). It is the concrete-example companion to the Proof Gate in `skill-preamble.md`. Sourced from goat-flow's verification lessons + the prime corpus's verification-before-completion checklist; do not add a row without a verbatim source.

| Claim | Requires | Not Sufficient |
|---|---|---|
| Tests pass | Test command output: 0 failures, 0 errored, full suite name copied verbatim | Previous run, "should pass", partial run |
| Linter / typecheck clean | Tool exit 0, full output read in this session | Linter passing implies typecheck; partial scan |
| Build succeeds | Build command exit 0, artifact written | Logs look good, last green CI |
| Bug fixed | Re-run the reproduction that originally failed; observe pass | Code changed, "probably fixed" |
| Regression test works | RED → revert fix → RED → restore → GREEN cycle | Test passes once after the fix |
| Sub-agent finished | VCS diff shows expected changes, re-read by you | Agent self-reports "success" |
| Requirements met | Line-by-line checklist against the plan or milestone | Tests passing, "feature complete" |

The Excuse / Reality rationalisation table in `skill-preamble.md` covers HOW the wrong claim slips out; this table covers WHAT each claim actually demands.

## Pattern: consumer-project domain skill (small-root + scoped-references)

When a consumer project authors a domain-specific skill (database guidance, framework conventions, payments-API procedures, etc.), prefer a compact root SKILL.md that routes to subdomain reference files instead of one monolithic skill body. Pattern observed in the prime corpus's MySQL skill (search: `Workflow` in `.goat-flow/scratchpad/skills-example-prime/mysql/SKILL.md`); generalise it provider-neutrally.

Outline:

- **Root trigger + Step 0** — frontmatter `description: "Use when working with <domain>"`, then a short workflow (define constraints, propose smallest change, validate with evidence). Include version-specific caveats and destructive-action approval rules at the top.
- **Subdomain sections** — one `##` per area (e.g. Schema, Indexing, Query, Transactions). Each section: 3-6 imperative bullets that capture the local rules.
- **Per-section references** — each section ends with a `References:` list pointing to scoped sub-files. Mark these as "read only the relevant references" so agents do not pre-load the whole pack.
- **Evidence commands** — name the production-safe commands that prove a change works (`EXPLAIN`, `EXPLAIN ANALYZE`, `SHOW INDEX FROM …`, lock metrics, rollout checklist).
- **Production rollback** — for any destructive or schema change, require a rollback step and post-deploy verification.

This is a pattern for consumer-project skills only — goat-flow core does not ship a MySQL skill. When advising a consumer project, share the outline and the principle ("small root, route to references, evidence-and-rollback before declaring done") rather than copying the prime SKILL.md wholesale.

## Pattern: API-backed skill guardrails

When a skill orchestrates a third-party API (search providers, payment gateways, model APIs, observability backends), the authoring rules tighten beyond the generic skill checklist. Pattern observed in the prime corpus's Valyu skill (search: `Use Official Valyu SDK Libraries` in `.goat-flow/scratchpad/skills-example-prime/valyu/SKILL.md`); generalise it provider-neutrally:

- **Prefer the official SDK over raw HTTP.** If the vendor ships an SDK in the project's language, use it. Raw `fetch`/`curl` snippets become quickly obsolete and miss SDK-side retries, pagination, error mapping, and observability hooks. The skill should default to the SDK and only fall back to HTTP when the API has no supported SDK or the user has explicitly opted into a custom client.
- **Authentication: name the env var explicitly.** The skill body must say which env var carries the API key (`VALYU_API_KEY`, `STRIPE_SECRET_KEY`, etc.) and refuse to run if it is missing. Never paste secret values into prompts, logs, or examples. Cite `.goat-flow/skill-reference/skill-preamble.md`'s Evidence Standard for redaction rules.
- **Surface citation / source requirements.** When the API returns search results, model outputs, or research data that the user will incorporate into their own work, the skill must require source URLs or IDs in the output so claims remain traceable.
- **Version-pin the API surface.** Mention the API version the skill was authored against (e.g. `v2`, `2024-10-01`). When a vendor ships a breaking change, this is the anchor that tells the next agent the body needs review before it is trusted.
- **Cost / rate-limit reality check.** If the API has non-trivial per-call cost or strict rate limits, surface the budget up front (calls per task, dollars per call) so the agent can ask before fanning out.

The deterministic skill-quality scorer does not currently flag raw-HTTP usage in API skills — provider-specific regexes are too brittle. Treat this as authoring guidance only until a consumer project surfaces a real need for detection.

## Cross-references

- `.goat-flow/skill-reference/skill-preamble.md` - Proof Gate, evidence standard, ceremony level (always-loaded layer); Excuse/Reality rationalisation table
- `.goat-flow/skill-reference/skill-conventions.md` - Rationalisation table definition, task tracking, recovery protocols
