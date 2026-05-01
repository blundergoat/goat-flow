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

The failure modes are well-documented: agents read the first file that matches a keyword and stop, they over-read low-signal boilerplate and miss the one doc that mattered, and they get handed a sprawling instruction file that tells them everything and therefore nothing.

**goat-flow's approach.** A small hot-path router (the top-level agent instruction file) points at cold-path domain docs on demand. The execution loop is explicit - READ → SCOPE → ACT → VERIFY - so the agent is structurally required to read before it plans, and plan before it writes. File references in the router must resolve; a broken link is an integrity failure, not a warning. Shared skill preamble and conventions live in extracted reference files at `.goat-flow/skill-reference/skill-preamble.md` (loaded on every skill invocation) and `skill-conventions.md` (loaded at full depth); each skill points at these rather than duplicating the same rules inline. The references are installed alongside the skills that read them, so cross-project portability holds without the copy-paste drift inlining would invite.

**Sources:**
- Every source agrees context quality matters
- OpenAI: "Give Codex a map, not a 1,000-page instruction manual"
- ETH Zurich study: LLM-generated agentfiles hurt performance; concise, human-written ones help
- Anthropic: progress file pattern for structured context handoff

---

## 2. Constraints

Constraints are the set of actions the agent must never take, enforced by something other than prose. A rule written in a markdown file has roughly a 30% bypass rate under pressure - the agent will find a path around it when the user's request seems to require one. A rule enforced at the tool layer has a 0% bypass rate because the tool call never completes.

The distinction matters: "don't push" in CLAUDE.md is a hope. A deny hook that blocks `git push` at the PreToolUse layer is a guarantee.

**goat-flow's approach.** Constraints are enforced structurally through deny hooks registered with the runner's tool-call lifecycle (PreToolUse for Claude Code, equivalents for other runners). Default deny patterns cover destructive filesystem operations, history-rewriting git commands, permission changes, pipe-to-shell installs, and common secret formats. Prose rules still appear in the instruction file for agent self-correction, but the audit grade comes from the structural enforcement, not the prose. If a runner has no deny mechanism, the check reports that as an integrity gap rather than pretending the prose rule is equivalent.

**Sources:**
- OpenAI Codex team: custom linters with error messages that include remediation instructions
- Birgitta Böckeler: computational feedforward controls - deterministic rules that steer the agent before it acts
- Han Heloir Yan (5-layer model): L1 Constraint as the skeleton - "the highest marginal return on a managed platform"

---

## 3. Verification

Verification is the check that runs after the agent acts. Agents claim work is done; verification is how the claim becomes trustworthy. The HumanLayer observation is the operative one: an agent's likelihood of success correlates strongly with its ability to verify its own work, not its ability to produce it.

The failure mode is the agent declaring a task complete based on having written code, without having run the code, the tests, or the types. "It compiles in my head" is a real failure pattern.

**goat-flow's approach.** A toolchain test command (when the project defines one) is the primary source of truth; instruction-file commands are the fallback. Post-turn hooks can run lint, types, or tests deterministically where the runner supports them. Skills are pressure-tested using the RED-GREEN-REFACTOR pattern - a skill that passes its own pressure test is evidence it will hold up under real use. Commit guidance is checked because the git log is the last-resort verification trail when in-session checks were skipped. Executable claim verification - the agent proves the claim by running it - is the direction the framework is heading.

**Sources:**
- Mitchell Hashimoto: "anytime you find an agent makes a mistake, you take the time to engineer a solution such that the agent never makes that mistake again"
- OpenAI: structural tests and pre-commit hooks on every code generation output
- HumanLayer: back-pressure mechanisms - "your likelihood of success is strongly correlated with the agent's ability to verify its own work"
- Birgitta Böckeler: feedback sensors - computational and inferential checks that observe after the agent acts

---

## 4. Recovery

Recovery is what happens after state is lost. The distinction worth holding: *preventing* state loss by keeping critical info in the always-loaded surface is a Context concern. Recovery is the restoration path when prevention fails - compaction runs lossily, a session crashes, a new laptop boots up, tomorrow arrives.

The naive approach is a compaction hook that re-injects rules at the compaction boundary. In practice these hooks fire unreliably, behave differently across runners, and only address one of several failure modes. The durable approach is file-based: artefacts that exist independently of the session, written during work, read at resume.

**goat-flow's approach.** Task state lives in milestone files with trackable checkboxes - an agent resuming a session can reconstruct what was done and what's next by reading them (the handoff concept was deprecated in v1.1.0 in favour of ticked checkboxes as the continuity mechanism; see `.goat-flow/glossary.md`). Session logs provide the raw trail when milestone files aren't granular enough, and are written on `/compact` without an active milestone or after completed milestone sequences. The hot-path instruction file must reference these artefacts explicitly, because a recovery artefact nothing points at is inert - the same cold-path drift pattern seen elsewhere in the harness. A user-invokable re-orientation command is more reliable than any automatic hook, because the user can trigger it whenever drift is sensed rather than waiting for a boundary event that may never fire cleanly.

**Sources:**
- Anthropic: session durability and checkpoint-resume with external event log
- harness-engineering.ai (Dr. Sarah Chen): lifecycle management - startup, health monitoring, crash recovery
- LangChain: LoopDetectionMiddleware for detecting doom loops

---

## 5. Feedback Loop

The feedback loop is how mistakes become fixes. Mitchell Hashimoto's framing is the whole game: when the agent makes a mistake, engineer a solution such that the agent never makes that mistake again. Without a loop, the harness runs at a constant quality level. With a loop, it compounds.

The failure mode is logging mistakes in a lessons file and then forgetting they exist. A prevention mechanism buried in a file the agent doesn't read is not a prevention mechanism - it's a diary.

**goat-flow's approach.** Three directories carry the loop: `footguns/` for cross-domain pitfalls worth warning future agents about, `lessons/` for recurring mistakes and their fixes, and `decisions/` (ADRs) for choices and their rationale. The scanner checks that these directories exist and have entries, and that the entries' file references still resolve - a lesson that points at a moved file is decorative. The structural principle: prevention mechanisms documented in lessons should graduate to preflight checks, CI gates, or deny hooks over time. If the same mistake appears in the lessons file twice, the lesson didn't take, and the fix needs to move up the stack from prose to structure.

**Sources:**
- Mitchell Hashimoto: the core principle - "never make that mistake again"
- OpenAI: "garbage collection" agents that scan for stale patterns and drift
- Birgitta Böckeler: the steering loop - iterating on the harness whenever issues recur

---

---

## Further reading

The harness engineering field is emerging. These are the primary sources behind the 5-concern model:

- Mitchell Hashimoto, "My AI Adoption Journey" (Feb 2026) - coined "harness engineering," established the core principle
- OpenAI, "Harness engineering: leveraging Codex in an agent-first world" (Feb 2026) - most detailed case study of building a fully agent-generated product
- Birgitta Böckeler, "Harness Engineering" on martinfowler.com (Apr 2026) - feedforward/feedback taxonomy, harnessability concept
- Vivek Trivedy, "The Anatomy of an Agent Harness" on LangChain Blog (Mar 2026) - derived harness components from what models can't do natively
- Kyle, "Skill Issue: Harness Engineering for Coding Agents" on HumanLayer Blog (Mar 2026) - most practical configuration guide
- Dr. Sarah Chen, "The Complete Guide to Agent Harness" on harness-engineering.ai (Mar 2026) - six core components overview
- Anthropic Engineering, "Scaling Managed Agents" (Apr 2026) - brain/hands decoupling, session durability
- Han Heloir Yan, "Anthropic Just Shipped Three of the Five Harness Layers" (Apr 2026) - 5-layer stack synthesis
