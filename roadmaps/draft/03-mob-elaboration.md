# Mob Elaboration - @blundergoat/ai-workflow-goat

**Source:** Feature brief v1 (2026-03-19)
**Method:** Category-first clarifying questions from multiple perspectives

---

## Architecture & Technical Design

### Q1. Single entry point or modular scanner architecture?

The brief says "single entry point `bin/goat.js`" but 50+ checks across 3 tiers, anti-patterns, shape detection, prompt generation, and 4 output formats is a lot of surface area. Should the internal architecture be:

- **(a)** Monolithic - one file with all checks inline (simplest, matches "zero deps" ethos)
- **(b)** Modular - `src/checks/`, `src/formatters/`, `src/prompts/` with each check as a function (easier to maintain, test, extend)
- **(c)** Plugin-style - checks registered in a manifest so users could add custom checks later

Recommendation: **(b)** - modular internals, single compiled entry point. You'll want to test individual checks against your 8 repos. A monolith makes that painful.

### Q2. How does the scanner read instruction file content?

Several checks need to parse *sections* of CLAUDE.md (the autonomy tier block, the DoD block, the router table). Plain regex against the whole file works for presence checks ("does it mention footguns.md?") but section-level analysis ("how many gates does the DoD have?") needs the content between two headings.

Options:
- **(a)** Regex only - simpler, faster, but section boundary detection is fragile
- **(b)** Lightweight markdown heading parser - split file into sections by `##` headings, then regex within sections
- **(c)** Full markdown AST parser - accurate but either adds a dependency or requires writing one

Recommendation: **(b)** - a 20-line heading splitter is sufficient and keeps the zero-dep constraint. You only need to identify sections by heading text, not parse inline markdown.

### Q3. How does settings.json parsing work without jq?

The checklist references `jq` for parsing `.claude/settings.json`. TypeScript has native `JSON.parse()` which is cleaner, but the file might not exist, might be malformed, or might have comments (JSON5-style). How strict?

- **(a)** `JSON.parse()` with try/catch - malformed = anti-pattern deduction, move on
- **(b)** Strip comments first, then parse - more forgiving for projects with `//` comments in settings
- **(c)** Read as text and regex for specific keys - avoid parsing entirely

Recommendation: **(a)** - strict JSON.parse. If settings.json has comments, it's already broken for Claude Code (which expects valid JSON). The anti-pattern deduction is correct.

### Q4. Should the auditor detect the project's stack (languages, build/test/lint/format commands)?

The prompt generator needs stack info to pre-fill prompts. Two approaches:
- **(a)** Detect from filesystem signals (package.json, composer.json, Cargo.toml, pyproject.toml, etc.) - automatic but heuristic
- **(b)** Require a stack definition in CLAUDE.md/AGENTS.md and score it as a check - more reliable but adds a scoring dependency
- **(c)** Both - detect heuristically, validate against declared stack if present, use detected stack for prompt generation

Recommendation: **(c)** - detect for prompt generation, but don't make declared stack a scored check in v1. That's a new requirement the plan doesn't mandate.

---

## Scoring & Rubric

### Q5. How should N/A checks affect the score?

Libraries don't need confusion-log.md, permission profiles, or (sometimes) /research and /code-review skills. Currently these are just "skip for libraries" but the scoring math matters:

- **(a)** N/A checks reduce the available points (score is earned/available, denominator shrinks)
- **(b)** N/A checks auto-PASS (denominator stays 100, free points for not needing them)
- **(c)** N/A checks are hidden entirely (denominator shrinks, but reported as "X/Y where Y varies by shape")

Recommendation: **(a)** - reduce available points. A library shouldn't get a lower max score just because it's simpler. A perfect library and a perfect app should both be able to score 100. Report as "72/85 available (85%)" and grade on percentage.

**If (a):** Does this mean the letter grade is percentage-based, not absolute? A library with 70/80 (87.5%) gets a B, while an app with 70/100 gets a C?

### Q6. Should the rubric be configurable per-project?

Open question 5 from the brief: `.goatrc` or `.workflow-audit.json` for overrides. Specific cases:
- A project deliberately skips PostToolUse hooks (no formatter) - currently docked points unless CLAUDE.md notes "no formatter"
- A project uses a different line target (team standard is 80 lines, not 100)
- A project acknowledges a known anti-pattern and wants to suppress the deduction

Scope question: is per-project config an M1 feature, a later milestone, or never?

### Q7. How does dual-agent scoring work in practice?

The brief says "score both independently, report side by side." But:
- Many checks apply to both (footguns.md, lessons.md, architecture.md are shared files)
- Some checks are agent-specific (settings.json is Claude Code, scripts/deny-dangerous.sh is Codex)
- The overall score: is it one score or two? If a project has a great CLAUDE.md and a mediocre AGENTS.md, is it 90 and 55, or averaged to 72?

Recommendation: Two independent scores with a summary noting which shared files benefit both. Don't average - the user cares about each agent's setup independently.

### Q8. How strict should the "project-specific boundaries" check be?

Check 1.3 scores whether Ask First boundaries are "project-specific, not generic template." Detection method: "doesn't match generic template text." But:
- What counts as "generic template text"? The examples in the plan (auth, routing, deployment, API contracts, DB) are illustrative - a real project using those exact terms is being specific, not generic
- A project that says "Ask First: auth, routing, deployment" with no further detail - generic or specific?
- Should the check compare against the actual plan template text, or use a length/specificity heuristic?

Recommendation: Length heuristic (Ask First section > 5 lines with at least one project-specific term like a filename, class name, or technology name) is more robust than template matching. Template matching produces false positives on projects that legitimately use the same boundary names.

---

## Prompt Generator

### Q9. Self-contained prompts or plan-referencing prompts?

Open question 8 from the brief. The prompt generator needs to decide:
- **(a)** Self-contained - every generated prompt includes full instructions inline. Works without the plan file. Longer prompts, more maintenance when plan evolves
- **(b)** Plan-referencing - prompts say "Read ai-workflow-improvement-plan-prime.md, then fix X." Shorter, always current with plan. Requires user to have the plan file
- **(c)** Adaptive - check if the plan file exists in the project. Self-contained if missing, plan-referencing if present

Recommendation: **(c)** - adaptive. Check for the plan file, branch accordingly. Most users who ran the implementation prompts will have the plan file. New users who just ran the auditor won't.

### Q10. One prompt per failure or batched by phase?

Open question 7. Related failures often map to the same phase:
- Missing execution loop + missing autonomy tiers + missing DoD = all Phase 1a
- Missing skills = Phase 1b
- Missing hooks = Phase 1c

Options:
- **(a)** One prompt per failure - granular, but 10 failures = 10 prompts to paste
- **(b)** Batched by phase - one prompt per phase that covers all failures in that phase. Fewer prompts, more practical
- **(c)** Both - `--prompts` gives batched (default), `--prompts --granular` gives per-failure

Recommendation: **(b)** - batched by phase. If someone is missing the execution loop, they need to run Phase 1a anyway - giving them 5 separate prompts for each loop step is worse than one prompt that says "build the whole loop." Granular mode can come later if needed.

### Q11. How does the prompt generator handle partial failures?

A check can PARTIAL (e.g., "DoD exists but only has 4 gates instead of 6"). The prompt needs to:
- Acknowledge what already exists (don't regenerate the whole DoD)
- Target only what's missing (add gates 5 and 6)
- Avoid clobbering existing content

This is harder than generating prompts for total failures. Should the prompt generator:
- **(a)** Treat PARTIAL as FAIL and regenerate the whole section - simpler prompts but risks overwriting good content
- **(b)** Generate targeted "add to existing" prompts - more precise but harder to template
- **(c)** Generate the full prompt but note "this section partially exists - review what's already there before running"

Recommendation: **(c)** for M1 - full prompt with a warning. Targeted patches are a refinement.

---

## Output & Distribution

### Q12. HTML report: inline template or external template file?

The HTML report needs CSS, possibly JS for expandable sections. Options:
- **(a)** Template as a TypeScript string literal - everything in one file, no asset management
- **(b)** Template as a separate `.html` file with placeholders - easier to design and iterate on
- **(c)** Template compiled into the build output - separate source file, bundled at build time

Recommendation: **(b)** or **(c)** - keep the template as a separate file in `src/templates/report.html` for easy iteration, compile it into the JS bundle at build time. Editing HTML inside a TypeScript string literal is painful.

### Q13. Should `--format html` write a file or output to stdout?

Text, JSON, and markdown all go to stdout. HTML could too, but:
- HTML to stdout requires `> report.html` redirect (friction)
- Writing directly to `workflow-audit.html` in the project directory breaks the "read-only" principle
- Writing to a temp location and opening in browser adds OS-specific complexity

Recommendation: stdout by default (consistent with other formats), with `--output report.html` flag for file writing. The user decides where it goes.

### Q14. npm package scoping and naming?

`@blundergoat/ai-workflow-goat` requires an npm org. Confirm:
- Is `@blundergoat` already claimed on npm? If not, create the org first
- Alternative: `ai-workflow-goat` (unscoped) - simpler npx invocation but risk of name collision
- The `npx` command: `npx @blundergoat/ai-workflow-goat .` is long. Should there be an alias? `npx goat-audit .`?

### Q15. What does the `--min-score` CI mode actually do?

The brief says "exit code 1 if below threshold." Specifics:
- Does it suppress all output and just exit? Or output normally plus set exit code?
- Should it support `--min-grade B` as an alternative to numeric threshold?
- Should it produce a one-line summary suitable for CI log output?

Recommendation: Output text format normally plus set exit code. CI wants both the report and the gate. `--min-grade` is a nice-to-have alias.

---

## Scope & Prioritisation

### Q16. What's the MVP milestone boundary?

The brief has: scanner core + 4 output formats + prompt generator + anti-patterns + CI mode + shape detection + dual-agent support. For a weekend-sized M1, what ships first and what waits?

Proposed M1/M2/M3 split:

| M1 (ship it) | M2 (make it real) | M3 (make it shine) |
|--------------|-------------------|-------------------|
| Scanner core (all 50+ checks) | Prompt generator | HTML report |
| Text output | Markdown output | CI mode (--min-score) |
| JSON output | --shape override | Per-project config (.goatrc) |
| Agent detection | Anti-pattern deductions | Dual-agent side-by-side |
| Shape detection (auto) | npm publish | awesome-claude-code listing |

Does this split match your instincts, or would you reorder?

### Q17. Should v1 only score the BlunderGOAT workflow system?

The brief is explicit: "scoring rubric derived from ai-workflow-improvement-plan-prime v1.5." But a project with a perfectly structured CLAUDE.md using a different methodology (e.g., Bruniaux's six-layer framework, BMad Method, or their own system) will score poorly because it doesn't have the specific patterns the rubric looks for (five-step loop, autonomy tiers with micro-checklist, etc.).

Is this:
- **(a)** Fine - this tool audits implementations of YOUR specific system. Be explicit about it. The README says "scores against the ai-planning-playbook methodology"
- **(b)** A problem to address later - v2 could have pluggable rubrics or a "generic" mode that checks for common best practices without methodology-specific checks
- **(c)** A problem to address now - the foundation tier should be methodology-agnostic (does it have commands? is it sized right?) and only standard/full should be methodology-specific

Recommendation: **(a)** for v1. Be honest about what it is. The tool name already signals it's opinionated (it's got GOAT in the name). Pluggable rubrics are a v2 conversation.

### Q18. Testing strategy for the auditor itself?

The brief says "test against 8+ real repos." Specifics:
- Unit tests for individual check functions (given this file content, expect this score)?
- Integration tests against fixture directories (synthetic projects at each grade level)?
- Regression tests against actual BlunderGOAT repos (git submodules or snapshots)?
- Should the auditor have its own CLAUDE.md and AI workflow setup? (Dogfooding inception)

Recommendation: Unit tests for check functions + 3-4 fixture directories (one per grade band). Real repo testing is manual validation, not automated tests - repo contents change over time.

---

## Answer These

Respond to each question with your decision. Quick one-liners are fine - I'll carry the decisions into the SBAO planning phase.
