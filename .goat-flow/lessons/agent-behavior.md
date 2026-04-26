---
category: agent-behavior
last_reviewed: 2026-04-26
---

## Lesson: Retrieval terms must name the concrete failure class

**Created:** 2026-04-18

**What happened:** During the M10 retrieval proof, the plan-oriented query `support matrix|agent matrix|registry canonicality` returned zero learning-loop hits for M12 work even though the relevant trap already existed in `.goat-flow/footguns/hooks.md`. Rewording the search to the concrete platform limitation - `Codex has no compaction notification hook` - found the entry immediately.

**Root cause:** The first query mirrored the milestone title instead of the language used by the stored incident. The learning-loop buckets are written around concrete symptoms, platform limits, and file/tool names; abstract planning vocabulary is too detached from that corpus.

**Why this matters:** Search-first retrieval only works if the first query is grounded enough to overlap with the recorded evidence. Weak cues do not just miss a convenience result; they create false confidence that "nothing relevant exists" unless the protocol forces a reword or an explicit miss.

**Prevention:** Build the first retrieval query from target area + symptom + named file/tool, not from milestone names or architecture abstractions. If the first pass is abstract, reword toward the concrete failure class before concluding miss.

---
## Lesson: Confused install-copy path pair for a directory move

**Created:** 2026-04-18

**What happened:** User proposed `.goat-flow/skill-reference/` as a new installed-state location for the three reference files currently at `workflow/skills/reference/` (`skill-preamble.md`, `skill-conventions.md`, `skill-quality-testing.md`) - intended as part of goat-flow's install-copy flow, grouping the trio alongside `.goat-flow/footguns/`, `.goat-flow/lessons/`, `.goat-flow/decisions/`. The agent read the proposal as "move/rename `workflow/skills/reference/` → `.goat-flow/skill-reference/`" and framed the change as a restructure that would leave `workflow/skills/reference/` depopulated. User had to restate the install relationship explicitly: *"workflow contains all the files for the goat-flow system installation ... .goat-flow/skill-reference/ would be used to copy those three files for the goat-flow system itself"*.

**Root cause:** Agent collapsed the `workflow/` vs `.goat-flow/` distinction when reading the proposal. goat-flow's architecture has a load-bearing split - `workflow/` is template source (what the goat-flow package ships), `.goat-flow/` is installed state (what exists in a consumer project after install) - and the install script copies from the former to the latter. When the user names a path under each, the default reading should be "install-copy relationship" (both paths exist; one populated from the other at install time), not "rename" (one replaces the other).

**Why it matters:** Proposing a rename out of `workflow/` would have stripped goat-flow of its template source. A consumer project has no `workflow/` directory; any SKILL.md cross-reference that points there is broken post-install. The user had to correct the misreading before any implementation could start - at real cost in turn-count and user frustration.

**Prevention:** When the user proposes a new path under `.goat-flow/` that co-exists with an existing path under `workflow/`, default to reading it as "both paths exist, with install-time copy between them". Before recommending any move, ask whether the template source at `workflow/...` should remain populated. The invariant to preserve: `workflow/` stays as template source; `.goat-flow/` is populated from it at install time.

---
## Lesson: When deny hook blocks a command, use the unblocked equivalent

**Created:** 2026-03-28

**What happened:** Agent needed to delete `.github/skills/goat-onboard/` and `.github/skills/goat-reflect/` directories. Used `rm -rf` which was blocked by deny-dangerous.sh. Instead of using `rm file && rmdir dir` (which is not blocked), the agent asked the user to delete manually - wasting a round trip on something trivially solvable.
**Root cause:** Agent defaulted to `rm -rf` out of habit and treated the deny hook block as a dead end instead of thinking about alternatives for 2 seconds.
**Fix:** When a command is blocked, think about the unblocked equivalent. `rm -rf dir/` → `rm dir/file && rmdir dir/`. `mv old new` → `mv -n old new`. The deny hook blocks dangerous patterns, not all file operations.

---
## Lesson: Version bumps require explicit confirmation

**Created:** 2026-03-29

**What happened:** While cleaning up zero-point rubric checks, the agent also bumped `package.json`, `RUBRIC_VERSION`, and skill frontmatter above the current `0.8.0` line. The user had not asked for a release/version bump and corrected it immediately.

**Prevention:** Treat version changes as a separate decision from rubric or content changes. Do not bump package, rubric, or template versions unless the user explicitly requests the new version or the release plan says to do it.

---
## Lesson: "Update the plan" means write the plan, not execute it
**Created:** 2026-04-04

**What happened:** User asked to "create M31 plan" and then later to "update this plan" with a detailed design spec. The agent wrote the plan file, then immediately launched a sub-agent to rewrite `index.html` - implementing the plan without being asked. User had to interrupt and correct: "dont change anything. just update this plan."

**Why it matters:** The user controls when code changes happen. Writing a plan and executing a plan are two completely separate actions. The user may want to review, share with others, or revise before any code is touched.

**Prevention:** Listen for the verb. "update the plan", "create M31", "write a plan" = write markdown only. "execute", "implement", "do it", "fix it" = make code changes. When in doubt, write the plan and ask if they want it executed. Never auto-execute a plan the user just asked you to write.

---
## Lesson: Installed skill files are not templates
**Created:** 2026-04-04

**What happened:** Scanner flagged AP18 (ADAPT comments in installed skills) causing a -2pt deduction on all 3 agents. Instead of fixing the installed files, the agent dismissed the failure as "expected for a template repo" and proposed suppressing AP18 when scanning the goat-flow repo. The user corrected this: `.claude/skills/`, `.agents/skills/`, `.github/skills/` are real project files that must pass the scanner at 100% - they are not templates. The templates live in `workflow/skills/` where ADAPT markers belong.

**Why it matters:** The entire point of the scanner is to validate installed files. Dismissing scanner failures on installed files undermines the tool's purpose. The distinction between template source (`workflow/skills/`) and installed copies (`.claude/skills/`, `.agents/skills/`, `.github/skills/`) is fundamental to goat-flow's architecture.

**Prevention:** Never dismiss scanner failures on installed skill files as "expected." If the scanner flags something in `.claude/skills/`, `.agents/skills/`, or `.github/skills/`, fix it. Only `workflow/skills/` (the distribution templates) should have ADAPT markers. When the scanner reports a deduction, the default response is "fix the file" not "suppress the check."

---
## Lesson: When a mockup exists, match it element-for-element
**Created:** 2026-04-05

**What happened:** User provided an HTML mockup with exact structure (`.left` div containing title + agent strip + detected config, `.right` div with prompt card) and screenshots. The agent interpreted the layout its own way - putting the title above both columns, the agent strip full-width, and the left column as plain text without a card background. This required 6+ correction rounds to get right: moving the title into the left column, moving the agent strip into the left column, adding the card background, fixing the width from 340px to 50%, adding `align-self: flex-start` so the card doesn't stretch full height. Every one of these was visible in the mockup from the start.

**Why it matters:** Each round of "fix this one thing" costs the user time and patience. The mockup HTML was a working reference with every structural decision already made. The agent's job was to wire up Alpine.js data bindings to the mockup's DOM structure - not to redesign the layout.

**Prevention:** When a mockup HTML file exists, open it and copy the structure directly. Map mockup CSS classes to existing `gf-*` classes or create matching ones. Do not reorganize the DOM structure based on what "seems right." The mockup is the spec - match it element-for-element, then add the dynamic bindings.

---
## Lesson: Mockup parity includes visible copy and live bindings
**Created:** 2026-04-26

**What happened:** In M05b Home redesign, the first implementation copied the broad section order but missed the mockup's top rollup identity row. The shipped Home started with "Home readiness" and subtitle text instead of the project name plus audit age. It also used a non-existent Alpine helper (`agentLabel(...)`) where the dashboard already exposes `agentName(...)`, so the project-title expression silently failed in the browser and the top section looked missing in user screenshots.

**Root cause:** The implementation treated the mockup as layout inspiration instead of a binding-level spec. Verification checked that there was one Home root and that the API returned data, but did not compare the rendered first viewport against the reference screenshots or exercise every dynamic expression used in the top section.

**Prevention:** For UI work backed by screenshots/mockup HTML, verify three layers before calling it done:

- Structure: sections appear in the same order as the mockup.
- Copy/data: key visible text such as project name, audit age, pill labels, and CTA labels matches the mockup intent.
- Bindings: every new Alpine helper used in markup is either local to `x-data` or exists on `app()`; grep for helper names and smoke the rendered browser view after rebuilding `dist/dashboard`.

**Evidence:** `src/dashboard/views/home.html` (search: `rollup-heading`) now renders the project name row; `src/dashboard/app.ts` (search: `agentName(agentId`) is the existing helper used by Home bindings.

---
## Lesson: UI state matrices must include partial data states
**Created:** 2026-04-26

**What happened:** The M05b Home view treated every non-passing setup audit as the same "not installed" state. A project with a partial goat-flow install (`1 of 13` setup components present) rendered the fresh-install top section, disabled preview cards, and "Not installed" label even though the audit response included partial setup evidence and agent scores.

**Root cause:** Verification covered the fully installed and fresh-install branches, but not the intermediate state where setup fails while some checks and agent audit data are present. The view used a broad `setupFailed()` predicate for identity, preview copy, and learning-loop visibility instead of explicit `setupMissing()`, `setupPartial()`, and `setupComplete()` branches.

**Prevention:** For dashboard status UIs, enumerate each meaningful state before testing the rendered screen: missing, partial, complete, stale, and unavailable. Verify that visible labels, project identity, card data source, and CTAs all use the same state model; broad failure helpers are acceptable only for actions that truly apply to every failure mode.

**Evidence:** `src/dashboard/views/home.html` (search: `setupPartial()`) now distinguishes partial setup from missing setup; `src/dashboard/views/home.html` (search: `showPreviewAgents()`) uses real agent audit data when present instead of disabling cards solely because setup failed.

---
## Lesson: Agent used setup script as source of truth instead of package.json
**Created:** 2026-04-05

**What happened:** When investigating CI test failures on Node 20, the agent read `setup-initial.sh` (which checks for Node 22+) and concluded the project requires Node 22 - contradicting `package.json` `engines.node: ">=20.11.0"`. The agent then suggested updating CI to Node 22 instead of fixing the scripts. The user corrected this: `package.json` is the canonical source of truth for the Node version requirement. Three shell scripts (`setup-initial.sh`, `dependency-install.sh`, `start-dev.sh`) all had the wrong version check.

**Why it matters:** Derived artifacts (scripts, docs, CI) can drift from the canonical source. When they conflict, the agent must identify which source is authoritative rather than picking whichever it read first. For Node version requirements, `package.json` `engines` is always canonical - it's what npm enforces, what CI reads, and what downstream consumers see.

**Prevention:** When version requirements conflict across files, check `package.json` first. It's the published contract. Scripts and docs are derived from it, not the other way around.

---

---
## Lesson: Don't overcomplicate clear requests - a spec is not ambiguous

**Created:** 2026-04-14

**What happened:** User asked to list all audit checks in config.yaml. Simple task. Instead of writing it once correctly, the agent: (1) added preflight checks the user never asked for, (2) used wrong section names that didn't match the dashboard, (3) put it in config.yaml as comments, (4) tried to move it into an existing doc instead of the requested new file, (5) entered plan mode for a follow-up dashboard task where the user had already given the exact spec, (6) wrote a memory file while still in plan mode. A task that should have been one turn took 5-10 turns and multiple corrections.

**Root cause:** The agent treated a clear directive as ambiguous. The user said "add all the checks" - the agent added checks the user didn't ask for (preflight). The user pasted an exact 3-section dashboard mockup - the agent entered plan mode instead of implementing. Each time the user corrected, the agent made a different wrong assumption instead of asking or doing exactly what was said.

**Prevention:**
1. When the user gives a clear spec, implement it literally. Don't add scope. Don't reinterpret.
2. A detailed mockup IS the plan. Don't enter plan mode when the user already told you what to build.
3. If you're unsure what the user wants, ask one question. Don't guess across multiple turns.
4. Never edit files in plan mode (except the plan file).

---
## Lesson: Agreeing with contradictory statements instead of holding a position

**Created:** 2026-04-14

**What happened:** User said preflight-checks.sh shouldn't validate goat-flow audit checks. Agent agreed and suggested moving them to the CLI audit. User said they don't belong in the CLI either. Agent immediately reversed and agreed they belong in preflight after all - contradicting what it said 1 message earlier. The agent had no position; it just agreed with whatever the user last said.

**Why this matters:** The user was making a specific point: preflight is a repo-level dev script (shellcheck, TypeScript, tests, formatting). The goat-flow-specific checks in preflight (doc/code drift, dashboard concern sync, architecture counts, skill version matching) are internal consistency checks for the goat-flow repo - they validate that the framework's own docs match its own code. That IS a preflight concern because preflight gates commits to this repo. The CLI audit validates consumer project installs - completely different scope. Both statements were correct but the agent couldn't hold both in its head.

**The correct answer was:** Preflight is the right place for goat-flow repo internal consistency checks. The CLI audit is the right place for consumer project validation. These are different scopes serving different users. The user's point was that the CLI shouldn't contain repo-internal checks - not that preflight was wrong to have them.

**Prevention:** When the user corrects you, understand what they're actually saying before reversing. If you already had the right answer, don't abandon it just because the user pushed back on a different claim. Ask for clarification instead of reflexively agreeing.

---
## Lesson: Session-log contract is conditional, not per-skill-invocation

**Created:** 2026-03-30 | **Updated:** 2026-04-19

**What happened:** Earlier skill templates said "If `.goat-flow/logs/` exists → write session summary" in a closing protocol that fired after every skill run. A goat-review audit ran the full skill process but no session log was written. 0% compliance. The instruction fired at the END of a skill - after the agent had already delivered output and was mentally "done."

**Current contract** (per `skill-preamble.md` + `skill-conventions.md`, post-2026-04-18): session logs are OPTIONAL continuity notes. Write one only when (a) `/compact` fires without an active milestone file, or (b) a milestone sequence completes. Otherwise skip - the old blanket "every invocation" rule is retired.

**Prevention:** Do not put a "write a session log" bullet in every skill's closing protocol. Keep the conditional phrasing in `skill-preamble.md` / `skill-conventions.md` and let skills opt in via the Milestone Retrospective pattern. The Notification/compact hook that was meant to mechanize this was silently dead (see `.goat-flow/footguns/hooks.md` Resolved Entries 2026-04-19) - don't revive that approach.

---
## Lesson: Dispatcher keeps getting excluded from patterns and glob matches

**Created:** 2026-04-01

**What happened:** Three separate incidents where the dispatcher was missed by glob/iteration patterns: `find -name 'goat-*.md'` skipped `goat.md`, CI template `for skill in ...; do goat-$skill` produced `goat-goat`, v0.9.3 consolidation missed counting the dispatcher.

**Prevention:** Always use `goat*` (no dash) for glob patterns. Always iterate literal canonical names, never derive by prefixing. Test the dispatcher first in any skill enumeration.

---
## Lesson: Verification prompts must not assume goat skills are the only skills

**Created:** 2026-04-01

**What happened:** M1 human testing gate prompt said "List all directories in .claude/skills/. The ONLY dirs should be: goat, goat-debug, ..." This would fail any project with non-goat project-specific skills. The instruction would cause a verifier to report project-specific skills as violations.

**Prevention:** Verification prompts and audit checks must scope to goat-flow's domain: "List all goat-* directories..." not "List all directories..." Project-specific skills are not goat-flow's business.

---
## Lesson: Scanner 100% does not mean the project is correct

**Created:** 2026-03-31

**What happened:** goat-flow scored 100% on its own scanner while preflight-checks.sh failed with 8 errors. Scanner checked structural presence (files exist, have right headings). Preflight checked functional correctness (commands work, paths resolve, versions match).

**Prevention:** Don't treat scanner score as a quality gate for the whole project. Use it for what it checks (structure) and preflight for what it checks (function). When they disagree, investigate.

---
## Lesson: Single-source-of-truth claims need a cold-path review pass

**Created:** 2026-04-18

**What happened:** M12 moved agent support metadata into `workflow/manifest.json`, but a follow-up code review still found residual parallel authority surfaces: Codex was given a fictional `post_turn: "Stop"` event in the manifest, the dashboard frontend narrowed injected agent ids back to `claude | codex | gemini`, and `.goat-flow/config.yaml` unknown `agents:` ids only produced warnings so audit status stayed green.

**Prevention:** When claiming "single writable authority", run a cold-path pass that searches for hardcoded enums, literal allowlists, and docs/templates restating the same contract. The migration is not complete until manifest, installer, config validation, audit failures, and frontend payload readers all agree on the same authority.

---
## Lesson: Sanitizing shell variable capture breaks `set -u` when variable is scoped inside a conditional

**Created:** 2026-04-21

**What happened:** `preflight-checks.sh` had a flaky test: `node --input-type=module` commands occasionally emitted stray diagnostic output containing `[` characters, which `grep` interpreted as regex, producing `grep: Unmatched [` errors. The fix added `| grep -oE '^[0-9]+$' | tail -1` to strip non-numeric output and switched to `grep -Fq` for fixed-string matching. But the sanitization pipeline returned empty when the node command failed in the temp fixture (no working `dist/`), causing `build_count=""`. The outer `if [[ -n "$build_count" ]]` correctly skipped the architecture checks - but `setup_count` was only assigned inside that `if` block. A downstream `if [[ -n "$setup_count" ]]` outside the block hit `set -u` (`unbound variable`) and crashed the script.

**Root cause:** Variable scoping assumption. `setup_count` was set on a line that only executes when `build_count` is non-empty, but was referenced unconditionally later. The original code never triggered this because without sanitization the node command always produced *some* stdout (even if it included garbage), so `build_count` was never empty - it was just wrong. The sanitization made the empty case reachable for the first time.

**Prevention:** When adding a filter that can turn non-empty output into empty output, trace every downstream reference to the captured variable. In `set -u` scripts, any variable set inside a conditional must either be initialized before the conditional or only referenced inside the same branch.

---
## Lesson: Quality findings must respect local-state and reporting-only contracts

**Created:** 2026-04-22

**What happened:** During a quality follow-up, the agent treated `.goat-flow/tasks/.active` pointing at a missing subdir as a MAJOR setup defect. The user corrected that the active marker is local working state: its target can disappear when a project completes, can change multiple times a day as users switch projects, or can be irrelevant when the user is only using goat-flow for bug work. The same review treated `/goat-critique` writing gitignored critique logs as a read-only violation. The user corrected the contract: read-only/reporting work means no committed-file changes and no implementation, not "never write gitignored continuity logs or task checkboxes."

**Root cause:** The agent applied generic quality-report assumptions without first checking goat-flow's persistence tiers and local-state semantics. It judged stale local pointers and gitignored continuity writes as setup defects instead of asking whether the skill handles them gracefully and whether committed state changes.

**Prevention:** Before reporting findings about `.goat-flow/tasks/`, `.goat-flow/logs/`, scratchpad files, or other gitignored state, classify the artifact as committed knowledge vs local session state. For local state, review behavior and fallback handling, not existence alone. In goat-flow quality reviews, "read-only", "reporting-only", "no-write", and "no implementation" mean no committed-file changes and no implementation; gitignored logs, scratchpad notes, critique snapshots, quality reports, and task-local state do not count as writes.

---
## Lesson: "Add a footgun" means a documentation entry, not runtime code

**Created:** 2026-04-25

**What happened:** In the healthkit project, the user asked to "add a footgun" documenting a Mercure CORS trap. The agent interpreted this as a request for runtime diagnostic code and added TypeScript console logging to `assets/entrypoints/chat-assistant.ts`. The user had to correct the agent, the code change was reverted, and the correct Mercure footgun entry was created in that project's goat-flow docs.

**Root cause:** The agent did not know that "footgun" in a goat-flow project means a documentation artifact under `.goat-flow/footguns/`. It defaulted to the general-English meaning ("something that will hurt you") and implemented a runtime warning. The routing was not documented prominently enough - the learning-loop section described what footguns ARE, but not what to do when the user says "add one."

**Why it matters:** The user had to intervene twice (once to stop the code change, once to redirect to the correct directory). The mistake class is dangerous because it produces a plausible-looking deliverable (runtime logging IS useful) that is completely wrong in context (the user wanted a knowledge-base entry, not code).

- Evidence: `.goat-flow/footguns/README.md` (search: `Traps in the code itself`) defines footguns as documentation artifacts
- Evidence: `.goat-flow/lessons/README.md` (search: `Mistakes the agent made`) defines lessons as documentation artifacts
- Evidence: Artifact Routing section now added to all four instruction files (CLAUDE.md, AGENTS.md, GEMINI.md, `.github/copilot-instructions.md`)

**Prevention:** The Artifact Routing section in instruction files and skill-preamble.md now explicitly maps user requests to target directories. When the user says "add a footgun," open `.goat-flow/footguns/README.md` and create/update a bucket entry. Do not write runtime code unless the user separately asks for a code change.

---
## Lesson: Line-number evidence in footguns/lessons creates silent maintenance debt

**Created:** 2026-04-24

**What happened:** Three independent Gemini quality reports in one session flagged stale `file:line` references across footgun entries. `hooks.md` cited `deny-dangerous.sh:88-96` for the read-only whitelist (actually at line 491+), `skills.md` cited `skill-preamble.md:77-79` for the Step 0 budget (actually at 95-97). Nine active line references across 3 footgun files had drifted. The framework's README and CLAUDE.md already said "line numbers are advisory" but evaluation templates said "RECOMMENDED," so agents kept using them.

**Root cause:** Line numbers shift on every edit to the target file. Unlike stale file paths (which `stats --check` catches), stale line numbers point at valid-but-wrong code and pass all mechanical checks. The guidance was contradictory: README discouraged them while the evaluation template encouraged them.

**Prevention:** Use grep-friendly semantic anchors (`(search: "pattern")`, function names, section headings) instead of line numbers. Per ADR-024, line numbers are now discouraged in evaluation templates and instruction files. `stats --check` validates `(search: ...)` anchors against actual file content, giving mechanical enforcement that line numbers never had.

---
## Lesson: Mockup parity includes visible copy and live bindings

**Created:** 2026-04-26

**What happened:** A static HTML mockup defined the exact visual design for the dashboard homepage. The implementation diverged: subtitle `<p>` elements were added under section and panel headings that do not exist in the mockup, section margins (rollup `margin-bottom: 12px`, next-action `margin-bottom: 20px`, section-head `margin: 0 0 10px`, agent-grid `margin-bottom: 22px`) were missing, padding values differed (`next-action` 16px vs mockup's 18px 22px), font families were wrong (section/panel titles used mono instead of sans-serif), and sizing was off (ring 128px vs 92px, grade-letter 24px/800 vs 18px/600). The first fix round only addressed fonts and sizes but missed the structural HTML additions and the spacing model entirely.

**Root cause:** The agent treated the mockup as a loose visual guide rather than a pixel-level spec. It compared individual CSS properties in isolation instead of doing a full structural diff (HTML elements, margin/padding on every section, font-family on every text element). Adding "helpful" subtitles that weren't in the mockup violated the spec without being flagged.

**Prevention:** When a static mockup defines the target, diff the mockup HTML structure against the live HTML element-by-element before touching CSS. Every element in the live page that doesn't exist in the mockup is a removal candidate. Every margin, padding, font-family, and font-size value in the mockup CSS is a hard spec, not a suggestion. Do not add content (text, elements, wrappers) that the mockup does not contain.

---
## Lesson: CLI agents cannot diagnose rendered CSS - ask for browser inspection

**Created:** 2026-04-26

**What happened:** The dashboard's donut chart had a dark hairline border that the user asked to remove. The agent added `border: none` to the `.ring` CSS rule but the hairline persisted. Multiple rounds of CSS changes failed because the agent was guessing at the cause from source code alone. The actual problem was a Tailwind v4 `.ring` utility injecting `box-shadow` onto the element - a class-name collision invisible in source. The user had to use a browser extension (Claude browser) to inspect the rendered computed styles and identify the `box-shadow` from Tailwind's generated CSS. Only then was the real fix clear: rename the class from `ring` to `ring-chart`.

**Root cause:** The agent cannot render CSS or inspect computed styles. It can only read source files. When a visual bug comes from framework-generated CSS (Tailwind, PostCSS, CSS-in-JS) colliding with custom styles, the source code shows no conflict. The agent kept applying source-level fixes (`border: none`, adding properties) that couldn't work because the wrong property was being targeted and the collision was in generated output.

**Prevention:** When a CSS visual bug persists after a source-level fix that should have worked, stop guessing. Tell the user: "I can't see the rendered styles from here. Can you inspect the element's computed styles in devtools and tell me what properties are applied?" One browser inspection gives more diagnostic value than five rounds of blind CSS edits. For Tailwind projects specifically, check whether custom class names collide with Tailwind utility names before writing the CSS rule.

---
## Lesson: Explicit skill invocation IS delegation consent - never ask again

**Created:** 2026-04-26

**What happened:** User invoked `/goat-critique` which requires spawning three sub-agents (Phase 1). The agent asked "Can I proceed with spawning the three critique agents?" despite the skill file explicitly stating "Explicit invocation is explicit consent to the full critique protocol." This wasted a turn and frustrated the user, who had already given consent by typing the command.

**Root cause:** The skill's Step 0 had a "Delegation consent gate" that said "when the active runner requires explicit user consent for delegated sub-agents and that consent is not present in the current user request or caller context, stop and ask before Phase 1." The agent interpreted this as always needing to ask, even though the preceding paragraph said explicit invocation is consent. The two clauses contradicted each other and the agent chose the more cautious (wrong) interpretation.

**Prevention:** When a user explicitly invokes a skill that spawns sub-agents as its core protocol, that invocation IS the consent. Do not re-ask. The skill file has been updated to make this unambiguous. For any skill with delegated agents: if the user typed the command, proceed. The only time to ask is when the skill was auto-routed by the dispatcher and the user didn't explicitly request it.

---
## Lesson: Respect punctuation preferences immediately

**Created:** 2026-04-26

**What happened:** The agent restored em dashes in several text files while cleaning up verification side effects, even though the user's preference is to use plain hyphens instead. The user had to interrupt and explicitly say they hate em dashes and want them changed to `-`.

**Root cause:** The agent treated punctuation restoration as preserving prior file style instead of recognizing a strong user preference. The local editing default already favors ASCII unless there is a clear reason otherwise, but the agent allowed existing prose punctuation to override the user's preference.

**Prevention:** When the user states a formatting or punctuation preference, apply it immediately and consistently within the requested scope. Prefer ASCII hyphens over em dashes in generated or edited prose unless the user explicitly asks for typographic punctuation.
