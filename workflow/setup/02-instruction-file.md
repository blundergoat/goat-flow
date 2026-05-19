# Step 02 - Instruction File

Create or update the agent's instruction file (CLAUDE.md / AGENTS.md / GEMINI.md / `.github/copilot-instructions.md`).

## First: detect the stack

1. Detect the project's languages, build/test/lint/format commands by reading package.json, Cargo.toml, go.mod, composer.json, pyproject.toml, Gemfile, *.csproj, or equivalent. List what you find.
2. Check for other agent instruction files. If multiple exist, this is a multi-agent project - only modify the one specified in your agent config file.
3. Check for existing `.goat-flow/` content - note what already exists so later steps merge, not replace.

## Then: check if the instruction file exists

### Path A - No instruction file exists (create new)

Create the instruction file at the path specified in your agent config file. Include all required sections listed below. Adapt all examples and boundaries for THIS project using the stack you just detected.

Target: under 125 lines. Hard limit: 150. Keep it concise - the instruction file is loaded every turn.

### Path B - Instruction file already exists (update)

Read it completely before changing anything. Then:

1. **Do not change the existing content** unless it's obviously an existing goat-flow instruction file from a previous setup. The user wrote this file - respect it.
   - **NEVER delete existing instruction files** (`.github/instructions/`, `docs/`) to satisfy the auditor or avoid "duplicate surfaces." If the auditor flags duplicate surfaces, add the existing surface to the goat-flow router table instead of deleting it. Existing instruction files are likely higher quality than anything setup can generate.
2. **Add a goat-flow section at the top** with any missing required sections from the list below. The existing content stays below it unchanged. Top-of-file survives context compaction.
3. If the existing file mixes project/domain knowledge into the hot path, move that material to `.goat-flow/architecture.md` and/or `.goat-flow/glossary.md`. Keep behavioral rules in the instruction file.
4. If it IS an existing goat-flow instruction file (has execution loop, autonomy tiers, router table already), update it in place - fix stale paths, update version header, add missing sections.
5. **If the existing Execution Loop uses legacy steps**, rewrite it. Specifically: if the section lists `CLASSIFY` or trailing `LOG` (the v1.0 `READ → CLASSIFY → SCOPE → ACT → VERIFY → LOG` pattern), replace the whole Execution Loop block with the current four-step version from `workflow/setup/reference/execution-loop.md` (`READ → SCOPE → ACT → VERIFY`). This is the canonical v1.2 loop every goat-* skill assumes. Applies to ALL instruction files - CLAUDE.md, AGENTS.md, GEMINI.md, and `.github/copilot-instructions.md` - no agent keeps the legacy loop. After rewriting, grep the rest of the file for residual `CLASSIFY` / `LOG` references in Router Table, DoD, or prose and remove them.
6. **If the existing file references legacy task-state files**, remove those references. goat-flow uses `.goat-flow/logs/sessions/` for session state - not legacy task-state files.
7. **After adding goat-flow sections, check total length.** If over 125 lines, compress: move domain knowledge to `.goat-flow/architecture.md` and/or `.goat-flow/glossary.md`, remove redundant sections, tighten prose. "Compress" means relocate verbose material, not delete it - the user's content is preserved in `.goat-flow/` files, just not in the hot-path instruction file.
8. Do NOT create "original-*" backup files. Git history preserves the original.

## Required sections (both paths)

The instruction file MUST include these sections. Use `workflow/setup/reference/execution-loop.md` as the template:

- (a) Project identity + version header - Start with 1-2 lines describing what the project is: name, domain, core technology, and the primary invariant or constraint. Example: `BlunderGoat - chess PGN analyzer producing XLSX reports. Core invariant: all engine evaluations use actor-POV.` Set the version header to the current goat-flow release version (match the `goat-flow-skill-version` in the installed skill files).
- (b) Truth Order
- (c) Autonomy Tiers: Always / Ask First / Never
- (d) Hard Rules
- (e) Key Resources
- (f) Essential Commands
- (g) Execution Loop: READ → SCOPE → ACT → VERIFY with `### READ`, `### SCOPE`, `### ACT`, and `### VERIFY` subsections
- (h) Definition of Done
- (i) Artifact Routing: map "add a footgun/lesson/decision/pattern" to the correct `.goat-flow/` directory
- (j) Router Table as the final section
- (k) Quality Bar: every line must fit one of: behavioral rule, scope boundary, command, verification gate, router pointer, composition rule. Domain knowledge belongs in cold-path files. For strict constraints, state whether prose-only or mechanically enforced.

Also include path-agnostic workspace boundary guidance. It may be a short `Workspace Boundary` section or one sentence in Project identity / Key Resources, but it must distinguish the controlling goat-flow workspace from the selected target project without hardcoding machine-specific absolute paths.

Adapt all examples, Ask First boundaries, and essential commands for THIS project's real codebase. Use real file paths, real commands, real boundaries. Preserve the composition rule: when a goat-* skill is active, the skill's Step 0 satisfies READ/SCOPE and the instruction file resumes at ACT.

## Canonical audit snippets

The setup audit requires these phrases. Paste or adapt them with the required words intact.

READ step:

> Before declaring any tool or capability unavailable, read the matching playbook in `.goat-flow/skill-playbooks/` (e.g. `browser-use.md`, `page-capture.md`) and run that doc's "Availability Check" section verbatim - project-local CLI tools at `~/.local/bin/` are valid; do not conflate "no harness/MCP tool" with "no tool".

Router Table row:

| Resource | Path |
|----------|------|
| Tool playbooks (CLI/MCP availability checks: browser-use, page-capture, skill-quality-testing) | `.goat-flow/skill-playbooks/` - read BEFORE declaring a tool unavailable |

## Optional: project infrastructure

Add a brief section documenting deployment platform, branch conventions, and required runtime versions - only if this information isn't already captured elsewhere in the project.

If `.github/` exists, `.github/git-commit-instructions.md` must contain this project's commit rules. Do not copy goat-flow's own commit policy into consumer projects. When creating the file for the first time, use goat-flow's git-history detector: sample `git -C <target> log -n 100 --pretty=%s`, classify subjects as conventional commits, ticket-prefixed, or free-form, and only name a dominant style when one class is at least 70% of the sample. If the installer already generated the file, review and keep it. If history is unavailable or has fewer than 10 commits, keep the generated stub header (`goat-flow: generated stub - insufficient git history`) and note that the project owner should edit it later. The harness `commit-guidance` check expects commit guidance at `.github/git-commit-instructions.md` when `.github/` exists.

## Housekeeping

After writing/updating the instruction file:

- Add `node_modules/` and agent-local settings to `.gitignore` if not already there (e.g., `.claude/settings.local.json`)
- If the project uses a code formatter (prettier, biome, etc.), add `.goat-flow/**/*.md` to the formatter's ignore file (`.prettierignore`, `biome.json` ignores, etc.)
- Keep the goat-flow section concise. Fold compression and RFC 2119 cleanup into this step instead of creating a separate polish pass.

---

**Verification gate:**
- [ ] Instruction file exists at the correct path
- [ ] All sections (a) through (k) are present
- [ ] Router Table is the final section
- [ ] Examples and boundaries reference real project files
- [ ] Workspace boundary guidance distinguishes controlling goat-flow workspace from selected target project without hardcoded absolute paths
- [ ] READ step keeps the canonical skill-playbooks phrases: "Before declaring any tool or capability unavailable", `.goat-flow/skill-playbooks/`, and "Availability Check"
- [ ] Router table includes the canonical `.goat-flow/skill-playbooks/` tool playbooks row
- [ ] If `.github/` exists, `.github/git-commit-instructions.md` exists with project-specific commit guidance or the generated insufficient-history stub header
- [ ] Every line fits the Quality Bar: behavioral rule, scope boundary, command, verification gate, router pointer, or composition rule. Domain knowledge and project history are routed to cold-path files, not inlined.
- [ ] If Path B: no useful existing content was lost
- [ ] If Path B: Execution Loop is the four-step v1.2 version; `rg 'CLASSIFY|→\s*LOG|->\s*LOG' <instruction-file>` returns zero hits
- [ ] `.gitignore` includes `node_modules/` and agent-local files

**Progress marker:** Append one line to the shared setup session log:
- `Step 02 complete: instruction file created/updated`

NEXT: proceed to `03-install-skills.md`
