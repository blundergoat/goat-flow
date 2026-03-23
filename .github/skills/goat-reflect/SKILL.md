---
name: goat-reflect
description: "Propose instruction file edits based on session friction and observable signals"
---
# /goat-reflect

Instruction tuning skill. Identifies friction in instruction files and proposes specific edits for human approval. Does NOT auto-edit anything.

## When to Use

After a session or when instruction files feel stale. Use to tune CLAUDE.md, ai/instructions/, and local instruction files based on real friction. Good for periodic maintenance — when rules feel wrong, incomplete, or actively misleading.

---

## Step 0 — Gather Context

Ask the user before investigating:

1. **What went well?** (which instructions helped, what felt smooth)
2. **What was friction?** (where instructions were wrong, missing, or confusing)
3. **Any repeated mistakes?** (same error across multiple sessions or tasks)
4. **Which instruction files feel wrong or incomplete?** (specific files or "not sure, help me find them")

Do NOT start investigating until the user has answered. Agents cannot read their own conversation history — Step 0 is how the user transfers session knowledge into this skill.

---

## Phase 1 — Identify Friction Signals

Based on Step 0 answers PLUS observable signals:

### Observable Signals to Check

- `git log --oneline -20` — recent changes reveal what areas are active
- Changed files in recent commits — where work is happening
- Recent `docs/lessons.md` entries — behavioural mistakes already captured
- Recent `docs/footguns.md` additions — architectural traps already captured

### Pattern Identification

Cross-reference the user's described friction against observable signals. Look for:

- **Repeated wrong assumptions** — agent kept doing X when rule says Y
- **Missing context** — agent lacked information that instructions should provide
- **Misleading rules** — instructions say one thing, codebase reality is different
- **Stale references** — instructions point to files/paths that have moved or changed
- **Missing rules** — no instruction covers a common friction point

Present findings then let the human dig deeper on specific friction points or ask follow-up questions before proceeding.

**HUMAN GATE:** "Here are the friction signals I've identified. Want me to (a) dig deeper on a specific friction point, (b) check a specific instruction file, (c) skip to proposals, or (d) add more context?"

Do NOT auto-advance to Phase 2. Let the human steer which friction points matter most.

---

## Phase 2 — Audit Current Instructions

Read the instruction files that relate to identified friction:

- `CLAUDE.md` / `AGENTS.md` / `GEMINI.md` — top-level agent instructions
- `ai/instructions/` — local instruction files
- Any local `CLAUDE.md` files in subdirectories

### For Each Friction Point

1. Find the relevant section in the instruction file (or note it's missing)
2. Compare the instruction against what the code actually does
3. Identify what's **missing** (no rule covers this), **misleading** (rule implies wrong thing), or **outdated** (rule references old structure)

**HUMAN GATE:** "Here's what I found in the instruction files. Want me to (a) focus on a specific file, (b) expand to local instruction files, (c) proceed to proposals, or (d) drop a friction point?"

Do NOT auto-advance to Phase 3.

---

## Phase 3 — Propose Edits

For each identified gap, propose a specific edit in diff-like format:

```
### Proposal N: [short description]

**File:** [path]
**Section:** [section name or line range]

**Current:**
> [existing text, or "(missing — no rule exists)"]

**Proposed:**
> [new or revised text]

**Why:** [one sentence connecting this to the friction described in Step 0]
```

Present ALL proposals together. DO NOT auto-apply any edits.

**HUMAN GATE:** "Here are my proposed edits. (a) approve all, (b) approve some (tell me which), (c) revise a proposal, or (d) reject all"

Only apply edits the human explicitly approves. If the human says "approve all", apply them. If the human picks specific proposals, apply only those.

---

## Constraints

- MUST gather context before investigating (Step 0)
- MUST use observable signals (git log, file reads) not conversation history access
- MUST present proposals for human approval before any edits
- MUST NOT auto-edit any files
- MUST NOT edit `docs/footguns.md` or `docs/lessons.md` — those require file:line evidence and have their own update standards
- MUST NOT invent friction that wasn't described by the user or found in observable signals
- MUST NOT fabricate file paths or line numbers
- MUST stop and wait for human review between every phase

## Output Format

| File | Section | Current | Proposed | Why |
|------|---------|---------|----------|-----|
| `[path]` | `[section]` | [existing text or "(missing)"] | [proposed text] | [connection to friction] |

Detailed proposals use the diff-like format from Phase 3. The table is for summary when presenting multiple proposals.

## Severity Scale

SECURITY > CORRECTNESS > INTEGRATION > PERFORMANCE > STYLE

When multiple proposals exist, present them in severity order. A misleading security rule outranks a stale style guideline.

## Learning Loop

If this run uncovered a lesson or footgun during the audit:
- Behavioural mistake (agent pattern) → `docs/lessons.md`
- Architectural trap with file:line evidence → `docs/footguns.md`

Note: goat-reflect itself does NOT edit these files. Flag them for the user and suggest a follow-up if evidence meets the bar.

## Chains With

- goat-audit — audit may reveal instruction gaps that goat-reflect can address
- goat-investigate — investigate unfamiliar code to improve instructions
