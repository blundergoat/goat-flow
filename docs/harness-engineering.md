# AI Harness Engineering - The Five Harness Concerns

Harness engineering is the practice of shaping what an AI coding agent sees, what it may do, how its work is checked, how state survives failure, and how recurring mistakes become structural fixes. The model is not the product. The harness around it is.

goat-flow organises its audit surface around five concerns. Every harness check belongs to exactly one. Each concern has a conceptual definition, a set of failure modes, and a concrete goat-flow approach. This doc defines the concepts; the check inventory with per-concern IDs and semantics lives in [harness-audit.md](harness-audit.md).

| Concern | One-line definition | Primary failure mode |
|:--------|:--------------------|:---------------------|
| Context | What the agent reads before it acts | Wrong files, missing files, prose bloat |
| Constraints | What the agent may never do | Destructive or irreversible actions |
| Verification | How work is checked after the agent acts | Silent regressions, unverified claims |
| Recovery | How state survives failure | Lost plot after compaction, crash, or resume |
| Feedback | How recurring mistakes become permanent fixes | Same bug, different day |

---

## 1. Context

The agent acts on what it reads. If the reading is wrong, the acting is wrong, and no amount of downstream verification will rescue a plan built on the wrong files. Context is the highest-leverage concern because everything else inherits from it.

Three failure modes recur: agents read the first file that matches a keyword and stop, they over-read low-signal boilerplate and miss the one doc that mattered, and they get handed a sprawling instruction file that tells them everything and therefore nothing.

**goat-flow's approach.** A small hot-path router (the top-level agent instruction file) points at cold-path domain docs on demand. The execution loop is explicit - READ → SCOPE → ACT → VERIFY - so the agent is structurally required to read before it plans, and plan before it writes. File references in the router must resolve; a broken link is an integrity failure, not a warning. Shared skill preamble and conventions live in extracted reference files at `.goat-flow/skill-docs/skill-preamble.md` (loaded on every skill invocation) and `skill-conventions.md` (loaded at full depth); each skill points at these rather than duplicating the same rules inline. The references are installed alongside the skills that read them, so cross-project portability holds without the copy-paste drift inlining would invite.

**Sources:**
- [OpenAI](https://openai.com/index/harness-engineering/): "Give Codex a map, not a 1,000-page instruction manual"
- [Anthropic](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents): structured progress artifacts carry work between fresh context windows

---

## 2. Constraints

Constraints are actions the agent must never take, enforced by something other than prose. Instruction text can be skipped or misapplied under pressure; a tool-layer deny blocks the covered call before it completes.

The distinction matters: "don't push" in an instruction file is advisory. A registered deny hook blocks covered `git push` calls before execution.

**goat-flow's approach.** Constraints are enforced structurally through deny hooks registered with the runner's tool-call lifecycle (PreToolUse for Claude Code, equivalents for other runners). Default deny patterns cover destructive filesystem operations, history-rewriting git commands, permission changes, pipe-to-shell installs, and common secret formats. Prose rules still appear in the instruction file for agent self-correction, but the audit grade comes from the structural enforcement, not the prose. If a runner has no deny mechanism, the check reports that as an integrity gap rather than pretending the prose rule is equivalent.

**Sources:**
- [OpenAI](https://openai.com/index/harness-engineering/): custom linters and structural tests enforce repository invariants
- [Birgitta Böckeler](https://martinfowler.com/articles/harness-engineering.html): computational feedforward controls steer an agent before it acts
- [HumanLayer](https://www.humanlayer.dev/blog/skill-issue-harness-engineering-for-coding-agents): hooks add deterministic control flow and back-pressure

---

## 3. Verification

Verification is the check that runs after the agent acts. Agents claim work is done; verification is how the claim becomes trustworthy. The HumanLayer observation is the operative one: an agent's likelihood of success correlates strongly with its ability to verify its own work, not its ability to produce it.

The failure mode is the agent declaring a task complete based on having written code, without having run the code, the tests, or the types. "It compiles in my head" is a real failure pattern.

**goat-flow's approach.** Deterministic audit checks verification wiring: hook registrations, commit guidance, and post-turn hook integrity where the selected agent runtime exposes a post-turn event. The default `post-turn-safety` hook is universal changed-content safety scanning; it does not claim builds, tests, linters, or typecheckers ran. goat-flow no longer ships a project-validation Stop hook; project-specific command selection and whether validation output is sufficient are quality/release questions, not install drift. Material skill behaviours use RED-GREEN-REFACTOR pressure trials. One passing trial supports only that scenario; three pre-registered passes support only the named failure class and recorded provider/model/config. Commit guidance is checked because the git log is the last-resort verification trail when in-session checks were skipped.

**Sources:**
- [Mitchell Hashimoto](https://mitchellh.com/writing/my-ai-adoption-journey): recurring mistakes should become harness changes
- [OpenAI](https://openai.com/index/harness-engineering/): structural tests and custom linters enforce invariants
- [HumanLayer](https://www.humanlayer.dev/blog/skill-issue-harness-engineering-for-coding-agents): back-pressure ties success to an agent's ability to verify its work
- [Birgitta Böckeler](https://martinfowler.com/articles/harness-engineering.html): computational and inferential feedback observes work after an agent acts

---

## 4. Recovery

Recovery is what happens after state is lost. The distinction worth holding: *preventing* state loss by keeping critical info in the always-loaded surface is a Context concern. Recovery is the restoration path when prevention fails - compaction runs lossily, a session crashes, a new laptop boots up, tomorrow arrives.

The naive approach is a compaction hook that re-injects rules at the compaction boundary. In practice these hooks fire unreliably, behave differently across runners, and only address one of several failure modes. The durable approach is file-based: artefacts that exist independently of the session, written during work, read at resume.

**goat-flow's approach.** Task state lives in milestone files with trackable checkboxes - an agent resuming a session can reconstruct what was done and what's next by reading them (the handoff concept was deprecated in v1.1.0 in favour of ticked checkboxes as the continuity mechanism; see `.goat-flow/glossary.md`). Session logs provide an optional raw trail when milestone files are absent or not granular enough; agents write them on `/compact` without an active milestone file or when the human asks for a session summary. The hot-path instruction file must reference these artefacts explicitly, because a recovery artefact nothing points at is inert - the same cold-path drift pattern seen elsewhere in the harness. A user-invokable re-orientation command is more reliable than any automatic hook, because the user can trigger it whenever drift is sensed rather than waiting for a boundary event that may never fire cleanly.

**Sources:**
- [Anthropic](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents): structured handoff artifacts preserve progress across sessions
- [Anthropic Managed Agents](https://www.anthropic.com/engineering/managed-agents): recovery and context interfaces remain stable while harness assumptions change
- [LangChain](https://www.langchain.com/blog/improving-deep-agents-with-harness-engineering): loop-detection middleware interrupts repeated failed approaches

---

## 5. Feedback Loop

The feedback loop is how mistakes become fixes. Mitchell Hashimoto's framing is the whole game: when the agent makes a mistake, engineer a solution such that the agent never makes that mistake again. Without a loop, the harness runs at a constant quality level. With a loop, it compounds.

The failure mode is logging mistakes in a lessons file and then forgetting they exist. A prevention mechanism buried in a file the agent doesn't read is not a prevention mechanism - it's a diary.

**goat-flow's approach.** Three directories carry the loop: `footguns/` for cross-domain pitfalls worth warning future agents about, `lessons/` for recurring mistakes and their fixes, and `decisions/` (ADRs) for choices and their rationale. The `feedback-loop-active` and `decisions-tracked` harness checks confirm the directories exist, and `stats --check` fails when an entry's file references no longer resolve - a lesson that points at a moved file is decorative. The structural principle: prevention mechanisms documented in lessons should graduate to preflight checks, CI gates, or deny hooks over time. If the same mistake appears in the lessons file twice, the lesson didn't take, and the fix needs to move up the stack from prose to structure. `goat-flow stats` operationalises this: active entries carrying a line-start `**Recurrence update` marker surface in the report as graduation candidates with per-entry recurrence counts (report-only - never a `stats --check` failure, so the signal cannot decay into ignorable warning noise).

**Sources:**
- [Mitchell Hashimoto](https://mitchellh.com/writing/my-ai-adoption-journey): encode fixes when an agent repeats a mistake
- [OpenAI](https://openai.com/index/harness-engineering/): recurring background tasks scan for drift from repository principles
- [Birgitta Böckeler](https://martinfowler.com/articles/harness-engineering.html): feedback from observed work drives the next harness change

---

## Further reading

The five concerns synthesize recurring themes from these sources; none defines goat-flow's exact taxonomy:

- [Mitchell Hashimoto, "My AI Adoption Journey"](https://mitchellh.com/writing/my-ai-adoption-journey) - harness changes as the response to recurring agent mistakes
- [OpenAI, "Harness engineering: leveraging Codex in an agent-first world"](https://openai.com/index/harness-engineering/) - repository context, mechanical constraints, verification, and recurring cleanup
- [Birgitta Böckeler, "Harness engineering for coding agent users"](https://martinfowler.com/articles/harness-engineering.html) - feedforward and feedback controls around coding agents
- [HumanLayer, "Skill Issue: Harness Engineering for Coding Agents"](https://www.humanlayer.dev/blog/skill-issue-harness-engineering-for-coding-agents) - configuration surfaces, progressive disclosure, hooks, and back-pressure
- [Anthropic, "Effective harnesses for long-running agents"](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents) - durable progress and session-to-session handoff
- [LangChain, "Improving Deep Agents with harness engineering"](https://www.langchain.com/blog/improving-deep-agents-with-harness-engineering) - trace-driven recovery from repeated failed approaches
