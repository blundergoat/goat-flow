# Prompt: Guidelines Ownership Split

Paste this into your coding agent when your project has an existing shared guidelines file that overlaps with what CLAUDE.md will own.

---

## When to Use

Run this BEFORE creating or rewriting CLAUDE.md (before Phase 1a). Only needed if your project has a shared coding standards file like `ai-agent-guidelines.instructions.md`, `.github/instructions/guidelines.md`, or similar.

If your project uses only domain-specific `.github/instructions/` files (scoped per directory), skip this - domain files describe coding patterns, not workflow rules, so they don't overlap.

---

## The Prompt

```
This project has a shared guidelines file at [PATH TO YOUR GUIDELINES FILE].
I need to split ownership between this guidelines file and CLAUDE.md
before installing the workflow system.

Read the guidelines file completely. Then:

1. IDENTIFY OVERLAP - Find content that belongs in CLAUDE.md (workflow):
   - Execution loop / workflow steps
   - Definition of Done / "before marking done" checklists
   - Stop-the-line rules
   - Working memory / context management conventions
   - Autonomy tiers or permission rules
   - Log file references (lessons.md, footguns.md)
   - Testing workflow or verification steps

2. IDENTIFY WHAT STAYS - Content that belongs in guidelines (engineering):
   - Operating principles (correctness over cleverness, smallest change)
   - Engineering best practices (API discipline, testing, type safety)
   - Communication style (concise, one question, verification story)
   - Error handling patterns (triage checklist, safe fallbacks, rollback)
   - Task management templates
   - Git hygiene and commit conventions
   - Language/framework-specific conventions

3. REMOVE OVERLAP from the guidelines file:
   - Remove the sections identified in step 1
   - Do NOT remove engineering content (step 2)
   - If a section has mixed content, split it: keep the engineering
     parts, remove the workflow parts

4. CREATE the migration report:
   docs/guidelines-ownership-split.md with:

   # Guidelines Ownership Split

   ## Date
   [YYYY-MM-DD]

   ## What was moved to CLAUDE.md
   - [section name] - [reason it's workflow, not engineering]

   ## What was removed (redundant)
   - [section name] - [reason: will be replaced by the execution loop / DoD / etc.]

   ## What stayed in guidelines
   - [section name] - [reason it's engineering, not workflow]

   ## Line count change
   - Before: [N] lines
   - After: [N] lines
   - Reduction: [N] lines ([N]%)

VERIFICATION:
- Verify the guidelines file no longer contains DoD, execution loop,
  stop-the-line, working memory, or autonomy tier content
- Verify docs/guidelines-ownership-split.md exists with all 4 sections
- Verify no engineering content was accidentally removed
- Report the line count reduction
- Commit or stash the guidelines changes before proceeding to Phase 1a
```
