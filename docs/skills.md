# Skills

Seven focused capabilities (six plus dispatcher) loaded on demand. Each skill has a distinct artifact, a hard quality gate, and a repeatable output. Skills don't load unless invoked - they stay out of the instruction budget.

All skills use the `goat-` prefix to avoid conflicts with built-in agent commands.

```mermaid
flowchart LR
    User["User input"] --> Dispatcher["/goat\n(dispatcher)"]
    Dispatcher --> Debug["/goat-debug"]
    Dispatcher --> Plan["/goat-plan"]
    Dispatcher --> Review["/goat-review"]
    Dispatcher --> Critique["/goat-critique"]
    Dispatcher --> QA["/goat-qa"]
    Dispatcher --> Security["/goat-security"]
```

| Skill | Purpose | Hard Gate | When to Use |
|-------|---------|-----------|-------------|
| [/goat](#goat--dispatcher) | Route to the right skill | -- | When intent is ambiguous; skip for simple implementations (the no-skill fast path in `skill-preamble.md`) |
| [/goat-debug](#goat-debug) | Diagnosis-first debugging + investigate mode + browser evidence | No fixes until human reviews diagnosis | Bug or test failure, UI issues, exploring unfamiliar code |
| [/goat-plan](#goat-plan) | Milestone planning with testing gates | Human approval between milestones | Before non-trivial implementation |
| [/goat-review](#goat-review) | Structured code review + quality audit | Negative verification before presenting findings | Before merging, quality audits |
| [/goat-critique](#goat-critique) | Multi-perspective critique of any artifact | Runs only with delegated sub-agents; blocks on unresolved disputes before synthesis | High-stakes decisions, plans, assessments |
| [/goat-security](#goat-security) | Threat-model-driven security assessment | MUST re-check framework/tooling mitigations before flagging findings | Before releases, after dependency changes, during audits |
| [/goat-qa](#goat-qa) | Testing gap analysis and verification planning | Does not run or write tests; generates gap analysis and testing plan | After a milestone or 30-60 min of coding |

---

## Choosing the Right Skill

| Situation | Skill | Why not the others |
|-----------|-------|--------------------|
| "Are there security issues?" | /goat-security | Threat-model-driven scan with framework verification |
| "This test is failing, why?" | /goat-debug | Need diagnosis before fixing |
| "How healthy is this module?" | /goat-review (audit mode) | Systematic scan, not a single bug |
| "How does this subsystem work?" | /goat-debug (investigate mode) | Understanding before changing |
| "I'm new to this project" | /goat-debug (investigate mode) | Progressive depth reading + orientation |
| "How should we build this feature?" | /goat-plan | Planning before implementing |
| "Are these changes safe to merge?" | /goat-review | Reviewing changes, not finding new issues |
| "How do we verify coverage for this work?" | /goat-qa | Risk-based testing gap analysis (planning, not execution) |
| "The UI is broken / rendering wrong" | /goat-debug | Browser evidence capture via browser-use CLI |
| "Is this bug fix verified?" | /goat-debug | Re-run the original repro and adjacent regressions |
| "Is this diff/PR verified?" | /goat-review | Two-pass review with Review Integrity |
| "Is this plan/assessment sound?" | /goat-critique | Multi-perspective critique before shipping |

---

## /goat - Dispatcher

Route to the right skill in one step. Type `/goat` followed by what you need.

```mermaid
flowchart TD
    Input["User input"] --> Understand["Classify intent"]
    Understand --> Gather["Gather context\nAsk First boundaries\nFootgun matches\nRecent git"]
    Gather --> Route{"Route to\nskill"}
    Route --> Announce["Announce: Routing to /goat-X\nOne-line rationale"]
    Announce --> Execute["Load target skill's Step 0"]
```

The dispatcher classifies intent conversationally - not by keyword lookup. It asks 0-2 clarification questions max and routes with a stated assumption if still ambiguous.

| Intent | Skill |
|--------|-------|
| Bug, error, symptom, crash | /goat-debug (diagnose) |
| UI bug, rendering issue, browser-visible symptom | /goat-debug (diagnose + browser evidence) |
| Explore, understand, new to this | /goat-debug (investigate) |
| Review changes, PR, diff | /goat-review (quick review) |
| Quality sweep, audit | /goat-review (audit) |
| Security, vulnerability, compliance | /goat-security |
| Plan, design, build a feature | /goat-plan (via Planning Route) |
| Test gaps, coverage, verification planning | /goat-qa |
| Critique a plan/assessment | /goat-critique |

**Planning Route:** For planning requests, the dispatcher routes intent only: Hotfix → direct execution; anything larger with a clear build/plan verb → `/goat-plan`. Bare or ambiguous task paths are read-only context, not planning or implementation requests. `/goat-plan` owns `.goat-flow/tasks/.active` lookup, existing-plan discovery, complexity classification, and milestone-mode selection. `/goat-plan` defaults to File-Write at Standard+ scope only when a clear build objective exists; analysis signals ("break this down for me", "how would you approach") trigger Read-Only Analysis mode instead.

**Task path classifier examples:**

| Input | Expected mode |
|-------|---------------|
| `.goat-flow/tasks/64272_voice-chat` | Read-only orientation; no writes |
| `.goat-flow/tasks/64272_voice-chat start M01` | Implementation may start after normal gates |
| `resume .goat-flow/tasks/64272_voice-chat` | Confirm current milestone unless the plan clearly records one |
| `update M01 in .goat-flow/tasks/64272_voice-chat` | Update the named milestone file only |
| `implement M01 from .goat-flow/tasks/64272_voice-chat` | Code implementation may proceed after reading gates |

---

## /goat-debug

Diagnosis-first debugging and codebase investigation.

| Mode | Trigger | What it does |
|------|---------|-------------|
| **Diagnose** | bug, error, crash, symptom | Hypothesis-driven debugging with confidence-gated fixes |
| **Diagnose (UI)** | UI bug, rendering issue, browser-visible symptom | Browser evidence capture via `browser-use` CLI, then hypothesis-driven debugging |
| **Investigate** | explore, understand, how does, new to this | Deep codebase reading with progressive depth and evidence tags |

**Diagnose mode:**

```mermaid
flowchart TD
    S0["Step 0\nGather context\nFootgun check\nUI bug detection"] --> D1

    subgraph Diagnose["Diagnose Mode"]
        D1["D1: Investigate\nHypotheses (2+ categories)\nTrace code paths"] --> BrowserCheck{UI bug?}
        BrowserCheck -->|Yes| Browser["Browser evidence\nbrowser-use open/state/screenshot\nOBSERVED data"]
        BrowserCheck -->|No| D2
        Browser --> D2["D2: Diagnosis\nConfidence: HIGH/MEDIUM/LOW"]
    end

    D2 -->|"BLOCKING GATE"| Decision{Human decision}
    Decision -->|"Fix it"| D3["D3: Fix Plan"]
    Decision -->|"Go deeper"| D1
    Decision -->|"Just report"| Close
    D3 --> D4["D4: Post-Fix Verification\n+ browser re-verification for UI bugs"]
    D4 -->|"CHECKPOINT"| Close["Closing\nLearning loop"]
```

No fixes until human reviews diagnosis. Confidence levels: HIGH = reproduced, MEDIUM = traced but not reproduced, LOW = inferred from code reading. For UI bugs, Step 0 detects browser-visible symptoms and loads `references/browser-use.md` on-demand. D1 uses browser evidence (screenshots, DOM state) to confirm or eliminate hypotheses after initial code reading. D4 reruns the browser reproduction post-fix as proof. Browser evidence is OBSERVED data; interpretations remain INFERRED until mapped to `file:line`. When `browser-use` is unavailable, the reference includes a manual fallback using OS screenshot tools and browser DevTools.

**Investigate mode:**

```mermaid
flowchart TD
    S0["Step 0\nGather context"] --> I1

    subgraph Investigate["Investigate Mode"]
        I1["I1: Scope & Plan\nDeclare in/out of scope\nRead estimate"]
        I1 -->|"BLOCKING GATE"| I2["I2: Read (Progressive Depth)\nEntry points → Critical path → Supporting"]
        I2 -->|"3x estimate?"| Check{"Re-scope?"}
        Check -->|Yes| I1
        Check -->|No| I3["I3: Report\n'What I Didn't Read' (required)"]
    end

    I3 -->|"BLOCKING GATE"| Close["Go deeper / Switch to diagnose / Close"]
```

For onboarding ("I'm new to this project"), use investigate mode - covers stack detection and codebase orientation through progressive depth reading.

---

## /goat-plan

Milestone planner and manager. It breaks work into testing-gated milestones, routing through five modes based on scope and user signals: Path-Only Intake (bare task path, read-only orientation), Named-File Update (explicit plan-file edit verb), Read-Only Analysis (analysis signals detected), Inline-Then-Write (Hotfix/Small Feature), or File-Write (clear Standard+ build objective). Files are written to `.goat-flow/tasks/` only in File-Write and explicit Named-File Update modes; Path-Only Intake and Read-Only Analysis never write.

```mermaid
flowchart TD
    S0["Step 0\nCheck existing milestones\nIdentify riskiest part\nKill criteria"] --> P1

    subgraph Plan["Milestone Breakdown"]
        P1["Phase 1: Break into milestones\nArchetypes: Prove It Works → Make It Real\n→ Make It Solid → Make It Shine"]
    end

    P1 -->|"CHECKPOINT"| P2["Phase 2: Output per mode\n(inline, file-write, or read-only)"]
    P2 -->|"CHECKPOINT"| P3["Phase 3: Between milestones\nAI verification gate\nHuman verification gate"]
    P3 -->|"BLOCKING GATE"| Next{"Next milestone?"}
    Next -->|Yes| P3
    Next -->|No| P4["Phase 4: Plan Complete\nAI verification gate\nHuman verification gate"]
    P4 -->|"BLOCKING GATE"| Close["Complete"]
```

**Milestone archetypes:** Prove It Works (spike the riskiest part first) → Make It Real (end-to-end working) → Make It Solid (edge cases, security) → Make It Shine (polish, optional). Each milestone has kill criteria, assumption tracking, and a dual AI + human verification gate (BLOCKING) before the next begins. Read-Only Analysis mode is available at any complexity level via analysis signals ("break this down for me", "how would you approach").

**Plan completion (Phase 4):** When all milestones are done, the agent runs an AI verification gate (every milestone complete, every task ticked, every exit criterion evidenced, every testing gate passed with current-session proof) then presents results at a blocking human verification gate. Plan artifacts must not include self-destruct instructions, and agents must not delete or archive plan files without human approval.

**Key constraints:** MUST check for existing milestone files before creating new ones. MUST include testing gates on every milestone. MUST NOT continue building on an invalidated assumption. MUST pick exactly one mode in Step 0 and stay in it - cross-mode drift is the failure the mode-picker exists to prevent.

---

## /goat-review

Structured code review and quality audit with negative verification.

| Mode | Trigger | What it does |
|------|---------|-------------|
| **Quick Review** | review, PR, diff | Severity-ordered scan of changes with negative verification |
| **Audit** | audit, quality sweep | Systematic codebase area scan - findings only, no fixes |

**Quick Review:**

```mermaid
flowchart TD
    S0["Step 0\nAuto-detect scope\nFootgun check"] --> R1

    subgraph Review["Quick Review"]
        R1["Severity-Ordered Scan\nSecurity > Correctness > Integration > Performance > Style"]
        R1 --> R2["Negative Verification\nAttempt to DISPROVE each finding\nRemove false positives"]
        R2 --> R3["Present Findings\nMUST / SHOULD / MAY Fix"]
    end

    R3 -->|"BLOCKING GATE"| DoD["DoD Gate Check"]
    DoD -->|"CHECKPOINT"| Close["Closing"]
```

MUST NOT flag pre-existing issues as part of this change. MUST attempt to disprove each finding before presenting it.

**Audit mode:** For codebase areas (not a diff). Scan using severity ordering, run negative verification, group 3+ related findings as systemic patterns. MUST NOT propose fixes in audit mode - findings only.

---

## /goat-critique

Multi-perspective critique for a concrete artifact (plan, security assessment, debug hypothesis set, review findings, architecture proposal). goat-critique runs in one mode: full delegated, 3 sub-agents, 5 phases. Rationale: `.goat-flow/decisions/ADR-021-goat-critique-full-mode-only.md`.

| Sub-agents | Phases |
|------------|--------|
| 3 delegated agents (Agent-tool calls, isolated contexts) | 5: Generate → Rank → Cross-Examine → Clarify → Synthesise |

```mermaid
flowchart TD
    S0["Step 0\nConfirm artifact"] --> P1

    subgraph Generate["Phase 1: Generate"]
        A["Agent A (Risk Focus)\nSKEPTIC/ANALYST/STRATEGIST\n+ footguns + lessons"]
        B["Agent B (Alternatives Focus)\nSKEPTIC/ANALYST/STRATEGIST\n+ git history + config"]
        C["Agent C (Fresh Eyes)\nArtifact + evaluation criteria ONLY\nNo project context"]
    end

    P1 --> Generate
    Generate --> P2["Phase 2: Rank & Compare\nConsensus / Split / Unique"]
    P2 --> P3["Phase 3: Cross-Examine\nSplit findings get a tiebreaker agent"]
    P3 --> P4["Phase 4: Clarify\nPresent disputes to human"]
    P4 -->|"BLOCKING GATE"| P5["Phase 5: Synthesise\nConsensus + Resolved + Verified + Retracted\n+ Open Questions + What Wasn't Critiqued"]
```

**Key constraints:** MUST use Agent tool calls for sub-agents, not inline role-play. MUST restrict the fresh-eyes pass to artifact + evaluation criteria only (no project context). MUST include "What Wasn't Critiqued" section (never empty). MUST put low-confidence recommendation candidates under Open Questions until evidence supports them.

---

## /goat-security

Threat-model-driven security assessment with framework-aware verification. For CLI, tooling, and setup repos, prioritise shell execution, hooks, filesystem access, PTY/session management, local HTTP/WebSocket surfaces, prompt generation, and dependency supply-chain risk before defaulting to web-app categories.

| Mode | Trigger | What it does |
|------|---------|-------------|
| **Threat model** | security, vulnerability, OWASP | Full threat surface scan with exploitability ranking |
| **Dependency audit** | dependencies, CVEs, supply chain | Focused dependency vulnerability scan |
| **Compliance** | HIPAA, GDPR, compliance | Regulation-specific controls assessment |

**Threat model mode:**

```mermaid
flowchart TD
    S0["Step 0\nFramework auto-detect\nFootgun check"] --> P1

    subgraph ThreatModel["Threat Model Mode"]
        P1["Phase 1: Threat Surface Scan\nPick only categories that fit this repo:\nshell/hooks • secrets/filesystem • PTY/dashboard • prompt generation • dependencies"]
        P1 --> P2["Phase 2: Framework-Aware Verification\nFor each finding, check:\n(a) installed? (b) configured? (c) applied?"]
    end

    P2 -->|"BLOCKING GATE"| P3["Phase 3: Exploitability Ranking\nCritical → High → Medium → Low\nAttack scenario for each"]
    P3 --> P4["Phase 4: Self-Check\nRe-read cited code\nRemove unverified findings"]
    P4 -->|"BLOCKING GATE"| Close["Present final report"]
```

MUST check built-in mitigations before flagging. A finding mitigated by the framework, runtime, or CLI guardrails is a false positive, not a finding. Confidence classification: CONFIRMED (entry-to-sink traced), PROBABLE (plausible, missing source trace), THEORETICAL (policy gap, no exploit path).

| Repo type | Check these mitigations first |
|-----------|------------------------------|
| Web app / API | CSRF/auth middleware, ORM parameterization, rate limiting, escaping defaults |
| CLI / tooling repo | deny hooks, shell quoting, PTY/session limits, filesystem scope checks, local-server bind defaults |
| Docs / setup framework | read-only defaults, no-write planning paths, prompt wording drift, installer no-clobber behavior, cross-reference checks |

---

## /goat-qa

Testing gap analyser. Compares code changes against testing coverage to find undertested risks and misaligned test effort. Does not write test code - hands off to the coding agent.

| Mode | Trigger | What it does |
|------|---------|-------------|
| **Standard** | test gaps, verify coverage, what's risky | Risk-based gap analysis for recent changes |
| **Audit** | test audit, coverage | Audit existing test coverage for a codebase area |
| **Regression Guard** | after bug fix | Define invariants and assess coverage for a specific fix |

```mermaid
flowchart TD
    S0["Step 0\nGather scope\nConfirm mode"] --> P1

    subgraph GapAnalysis["Gap Analysis"]
        P1["Phase 1: Change Risk Map\nRead actual diff, not just file names\nClassify: CRITICAL / HIGH / MEDIUM / LOW\nTrace blast radius for CRITICAL/HIGH"]
        P1 -->|"CHECKPOINT"| P2["Phase 2: Gap Analysis\nCompare risk vs coverage\nUndertested risks + Misaligned effort"]
        P2 -->|"BLOCKING GATE"| P3["Phase 3: Targeted Testing Plan\nMust test / Should test / Safe to skip\nTime estimates for manual items"]
    end

    P3 -->|"CHECKPOINT"| Close["Closing"]
```

---

## Shared Conventions

Every skill shares:
- **Step 0** - context gathering before any work begins
- **BLOCKING GATEs** - agent stops and waits for human decision
- **CHECKPOINTs** - agent reports status and continues unless interrupted
- **Footgun check** - cross-reference `.goat-flow/footguns/` for known traps
- **Learning loop** - log lessons and footguns after completion
- **Ceremony scaling** - hotfixes skip ceremony, system changes get full treatment

See `.goat-flow/skill-reference/skill-preamble.md` (installed) or `workflow/skills/reference/skill-preamble.md` (source template) for the canonical shared conventions.

## Where Skills Live

| Agent | Path |
|-------|------|
| Claude Code | `.claude/skills/goat-{name}/SKILL.md` |
| Codex | `.agents/skills/goat-{name}/SKILL.md` |
| Gemini CLI | `.agents/skills/goat-{name}/SKILL.md` |
| Copilot CLI | `.github/skills/goat-{name}/SKILL.md` |

Skills are created during step 03 of the GOAT Flow setup. The skill templates in `workflow/skills/` document the prompts used to create them. A skill may also ship a nested `references/` directory; install and parity checks treat those files as part of the skill surface.

> **Consolidation history (v0.8.0-v1.1.0):** Nine skills were consolidated into the current seven. See ADR-009 for the full rationale. goat-critique was extracted as a standalone critique skill in v1.1.0, then renamed from goat-sbao in v1.2.0 (ADR-019).
