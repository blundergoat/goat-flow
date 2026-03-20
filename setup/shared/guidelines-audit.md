# Before You Start: Guidelines Ownership Audit

If your project has a shared coding standards file (e.g., `ai-agent-guidelines.instructions.md`), audit it FIRST. Remove any content that overlaps with what the instruction file (CLAUDE.md / AGENTS.md) will own.

**Remove from guidelines (instruction file will own these):**

- Execution loop / workflow steps
- Definition of Done
- Stop-the-line rules
- Working memory / context management conventions
- Autonomy tiers or permission rules
- Log file references (lessons.md, footguns.md)

**Keep in guidelines (these stay):**

- Operating principles (correctness over cleverness, smallest change, etc.)
- Engineering best practices (API discipline, testing, type safety)
- Communication style (concise, one question, verification story)
- Error handling patterns (triage checklist, safe fallbacks, rollback)
- Task management templates
- Git hygiene

Do this manually before running any setup prompts. The prompts assume the split is already clean.

**No shared guidelines file?** If your project uses domain-specific `.github/instructions/` files instead of a single shared file, skip this audit. Domain files describe coding patterns per domain, not workflow rules - they don't overlap with the instruction file.

**Commit or stash first.** The setup prompts may overwrite your instruction file. Run `git stash` or `git commit` before starting. If the output is wrong, `git checkout` restores the original.
