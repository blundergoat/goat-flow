# /goat-plan

Structured planning for features and cross-file refactoring.

## Modes

| Mode | Trigger | What it does |
|------|---------|-------------|
| **Plan** | plan, design, architect, build | 4-phase feature planning with human gates |
| **Refactor** | rename, move, extract, restructure | Blast radius analysis with grep-after-every-rename |

## Plan Mode

```mermaid
flowchart TD
    S0["Step 0\nContinuation check\nConcurrent work check\nKill criteria"] --> P1

    subgraph Plan["Plan Mode"]
        P1["Phase 1: Feature Brief\n8 sections, one at a time"]
        P1 -->|"BLOCKING GATE"| P2["Phase 2: Mob Elaboration\n3-5 sharp questions per round\nDo NOT self-answer"]
        P2 -->|"CHECKPOINT"| P3["Phase 3: SBAO\nSub-agents use Core Trio\n(SKEPTIC/ANALYST/STRATEGIST)"]
        P3 -->|"BLOCKING GATE"| P4["Phase 4: Milestones\nExit criteria + kill criteria per milestone"]
    end

    P4 -->|"BLOCKING GATE"| Decision{Approve?}
    Decision -->|Yes| Implement["Phase 5: Execute\n(per milestone)"]
    Decision -->|Adjust| P4
```

**Key constraint:** Human approval between phases. Hotfixes skip Phases 2-3 and get a compressed 3-5 line brief.

## Refactor Planning Mode

```mermaid
flowchart TD
    S0["Step 0\nFootgun check"] --> R1

    subgraph Refactor["Refactor Mode"]
        R1["R1: Blast Radius Analysis\nDeclare scope\nRead BOTH sides of every interface\nAuto-detect with grep"]
        R1 -->|"BLOCKING GATE"| R2["R2: Execution Sequence\nOne layer at a time\nLint/test after each step"]
        R2 --> R3["R3: Verification Plan\nGrep old names (target: ZERO)\nBuild check + doc cross-refs"]
    end

    R3 -->|"BLOCKING GATE"| Execute["Execute refactor"]
```

**Key constraint:** MUST read both sides of every interface before changing. MUST grep after every rename. MUST check docs, not just source.

**Source:** `workflow/skills/goat-plan.md`
