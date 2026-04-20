# Step 02 - Instruction File

Create or update the agent's instruction file (CLAUDE.md / AGENTS.md / GEMINI.md / `.github/copilot-instructions.md`).

## First: detect the stack

1. Detect the project's languages, build/test/lint/format commands by reading package.json, Cargo.toml, go.mod, composer.json, pyproject.toml, Gemfile, *.csproj, or equivalent. List what you find.
2. Check for other agent instruction files. If multiple exist, this is a multi-agent project - only modify the one specified in your agent config file.
3. Check for existing `.goat-flow/` content - note what already exists so later steps merge, not replace.

## Then: check if the instruction file exists

### Path A - No instruction file exists (create new)

Create the instruction file at the path specified in your agent config file. Include all required sections listed below. Adapt all examples and boundaries for THIS project using the stack you just detected.

Target: under 120 lines. Hard limit: 150. Keep it concise - the instruction file is loaded every turn.

### Path B - Instruction file already exists (update)

Read it completely before changing anything. Then:

1. **Do not change the existing content** unless it's obviously an existing goat-flow instruction file from a previous setup. The user wrote this file - respect it.
   - **NEVER delete existing instruction files** (`.github/instructions/`, `docs/`) to satisfy the auditor or avoid "duplicate surfaces." If the auditor flags duplicate surfaces, add the existing surface to the goat-flow router table instead of deleting it. Existing instruction files are likely higher quality than anything setup can generate.
2. **Add a goat-flow section at the top** with any missing required sections from the list below. The existing content stays below it unchanged. Top-of-file survives context compaction.
3. If the existing file mixes project/domain knowledge into the hot path, move that material to `.goat-flow/architecture.md` and/or `.goat-flow/glossary.md`. Keep behavioral rules in the instruction file.
4. If it IS an existing goat-flow instruction file (has execution loop, autonomy tiers, router table already), update it in place - fix stale paths, update version header, add missing sections.
5. **If the existing Execution Loop uses legacy steps**, rewrite it. Specifically: if the section lists `CLASSIFY` or trailing `LOG` (the v1.0 `READ → CLASSIFY → SCOPE → ACT → VERIFY → LOG` pattern), replace the whole Execution Loop block with the current four-step version from `workflow/setup/reference/execution-loop.md` (`READ → SCOPE → ACT → VERIFY`). This is the canonical v1.2 loop every goat-* skill assumes. Applies to ALL instruction files - CLAUDE.md, AGENTS.md, GEMINI.md, and `.github/copilot-instructions.md` - no agent keeps the legacy loop. After rewriting, grep the rest of the file for residual `CLASSIFY` / `LOG` references in Router Table, DoD, or prose and remove them.
6. **If the existing file references legacy task-state files**, remove those references. goat-flow uses `.goat-flow/logs/sessions/` for session state - not legacy task-state files.
7. **After adding goat-flow sections, check total length.** If over 120 lines, compress: move domain knowledge to `.goat-flow/architecture.md` and/or `.goat-flow/glossary.md`, remove redundant sections, tighten prose. "Compress" means relocate verbose material, not delete it - the user's content is preserved in `.goat-flow/` files, just not in the hot-path instruction file.
8. Do NOT create "original-*" backup files. Git history preserves the original.

## Required sections (both paths)

The instruction file MUST include these sections. Use `workflow/setup/reference/execution-loop.md` as the template:

- (a) Project identity - Start with 1-2 lines describing what the project is: name, domain, core technology, and the primary invariant or constraint. Example: `BlunderGoat - chess PGN analyzer producing XLSX reports. Core invariant: all engine evaluations use actor-POV.`
- (b) Version header - set to the current goat-flow release version (match the `goat-flow-skill-version` in the installed skill files)
- (c) Execution loop: READ → SCOPE → ACT → VERIFY
- (d) Autonomy tiers: Always / Ask First / Never
- (e) Definition of Done
- (f) Router table
- (g) Essential commands

Adapt all examples, Ask First boundaries, and essential commands for THIS project's real codebase. Use real file paths, real commands, real boundaries. Preserve the composition rule: when a goat-* skill is active, the skill's Step 0 satisfies READ/SCOPE and the instruction file resumes at ACT.

## Optional: project infrastructure

Add a brief section documenting deployment platform, branch conventions, and required runtime versions - only if this information isn't already captured elsewhere in the project.

## Housekeeping

After writing/updating the instruction file:

- Add agent-local settings to `.gitignore` if not already there (e.g., `.claude/settings.local.json`)
- If the project uses a code formatter (prettier, biome, etc.), add `.goat-flow/**/*.md` to the formatter's ignore file (`.prettierignore`, `biome.json` ignores, etc.)
- Keep the goat-flow section concise. Fold compression and RFC 2119 cleanup into this step instead of creating a separate polish pass.

---

**Verification gate:**
- [ ] Instruction file exists at the correct path
- [ ] All sections (a) through (g) are present
- [ ] Examples and boundaries reference real project files
- [ ] If Path B: no useful existing content was lost
- [ ] If Path B: Execution Loop is the four-step v1.2 version; `rg 'CLASSIFY|→\s*LOG|->\s*LOG' <instruction-file>` returns zero hits
- [ ] `.gitignore` updated for agent-local files

**Progress marker:** Append one line to the shared setup session log:
- `Step 02 complete: instruction file created/updated`

NEXT: proceed to `03-install-skills.md`
