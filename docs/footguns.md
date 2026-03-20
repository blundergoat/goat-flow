# Footguns

Cross-domain gotchas confirmed in this codebase. Add entries only when the repo itself demonstrates the behaviour. Every entry MUST include file:line evidence.

## Footgun: Cross-reference fragility across docs

**Symptoms:** A renamed or moved file breaks links in multiple documents. Users following getting-started.md hit dead references.

**Why it happens:** Documentation files reference each other by relative path. The project has 60+ markdown files with dense cross-referencing. Renaming one file can break references in 5-10 others.

**Evidence:**
- `docs/getting-started.md:162` → references `workflow/_reference/system-spec.md` (stale path, file is at `docs/system-spec.md`)
- `docs/getting-started.md:163` → references `workflow/_draft/00-1-ai-workflow-ARTICLE-prime_v1.5.md`
- `docs/getting-started.md:15` → references `workflow/_draft/00-1-ai-workflow-ARTICLE-prime_v1.5.md`
- `docs/five-layers.md:274` → references `FIVE_LAYER_SYSTEM.md` (old filename)

**Prevention:** After any file rename or move, grep the entire repo for the old path. Use `grep -r "old-filename" --include="*.md"` before declaring done. This is DoD gate #6.

## Footgun: Concept duplication across core docs

**Symptoms:** A user reads conflicting descriptions of the same concept in different files. An agent follows a rule from one file that contradicts another.

**Why it happens:** The execution loop, autonomy tiers, anti-pattern table, and other core concepts are described in `docs/system-spec.md`, `docs/five-steps.md`, `docs/five-layers.md`, `docs/getting-started.md`, and `docs/design-rationale.md`. Updating one without updating the others creates drift.

**Evidence:**
- `docs/system-spec.md:126` → execution loop definition
- `docs/five-steps.md:7` → execution loop definition (detailed version)
- `docs/getting-started.md:10` → execution loop summary
- `docs/design-rationale.md:194` → execution loop rationale with repeated content

**Prevention:** When editing a core concept, grep for the concept name across all docs and update every occurrence. `docs/system-spec.md` is the canonical source of truth.

## Footgun: Line target inconsistency for project shapes

**Symptoms:** A user gets different advice about their target line count depending on which doc they read.

**Why it happens:** Line budget targets for project shapes appear in multiple files and have drifted apart during edits.

**Evidence:**
- `docs/examples.md:218` → shows devgoat-bash-scripts target as "80" for Collection shape
- `docs/five-layers.md:201` → shows "~100" for Script Collection shape
- `docs/system-spec.md:104` → shows "~100" for libraries/collections

**Prevention:** Line targets MUST only be authoritatively stated in `docs/system-spec.md`. Other files should reference the spec rather than restate the numbers.

## Footgun: Stale references from old project structure

**Symptoms:** Settings, paths, or documentation reference `ai-workflow-framework` (the old project name) instead of `goat-flow`.

**Why it happens:** The project was renamed from `ai-workflow-framework` to `goat-flow`. Not all references were updated.

**Evidence:**
- `.claude/settings.local.json:4` → references `/home/devgoat/projects/ai-workflow-framework/`
- `.claude/settings.local.json:28` → references `//home/devgoat/projects/ai-workflow-framework/**`

**Prevention:** After any project-level rename, run `grep -r "old-name" --include="*.md" --include="*.json"` across the entire repo.
