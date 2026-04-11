# Step 04 — Architecture + Code Map

Create or enhance `.goat-flow/architecture.md` and `.goat-flow/code-map.md`.

## Architecture

Read the codebase before writing. The audience is an agent or engineer who needs a fast, accurate model of how the system is wired before making changes.

Include these sections where applicable:

- **System Overview** — Major services/components and their boundaries. 2-4 sentences on why they are separated that way.
- **Request Flow** — One representative request path: entrypoint, middleware, app/service layer, data store, response.
- **Auth / Trust Boundaries** — How authentication and authorization work end-to-end.
- **Data Flow** — Where durable state lives, how data moves between stores/services. Queues, caches, third-party APIs.
- **Deployment / Operations** — How code moves from local dev to runtime. CI, hosting, key infra.

## Code map

Create `.goat-flow/code-map.md` as a quick-reference tree map of the repository layout.

Rules:

- Explore the real directory structure before writing
- Map the hot paths first: entrypoints, `src/`, `tests/`, `scripts/`, `docs/`, config, deployment assets
- One short `= description` for every included entry
- Call out generated, vendored, build-output, or never-edit paths explicitly
- Do not recurse into dependency caches (`node_modules/`, `vendor/`, `dist/`, `build/`, `.git/`); summarize instead
- Go 2-4 levels deep where that improves understanding, then summarize
- Current-state only — do not list planned directories

## Scaffolding

Create these directories and files if they don't already exist:

- `.goat-flow/decisions/` — for architecture decision records when needed. Do not pre-fill with a blank template.
- `.goat-flow/tasks/` — for milestone and task tracking files
- `.goat-flow/logs/sessions/` — for session logs (if not already created by step 01)
- `.goat-flow/templates/` — copy from `workflow/templates/` verbatim. **Verify source exists before copying** — if `workflow/templates/` is missing from the goat-flow release, fail fast and report the missing source rather than silently skipping. These contain prompt templates for feature briefs, milestone planning, requirements tracking, refactor planning, and manual multi-session SBAO. Some skills reference specific templates on their full-depth path (e.g., feature-brief.md, compliance-checklist.md, flow-diagram-guide.md) — these must be installed.

## Shared rules

- Document the current implementation, not roadmap ideas
- Read source files, config, and deployment assets before writing either file
- Keep both files concise and scannable
- Every path mentioned in either file must exist on disk

---

**Verification gate:**
- [ ] `.goat-flow/architecture.md` exists with real content (not template fill)
- [ ] `.goat-flow/code-map.md` exists
- [ ] `.goat-flow/decisions/`, `.goat-flow/tasks/`, `.goat-flow/logs/sessions/`, `.goat-flow/templates/` directories exist
- [ ] `.goat-flow/templates/` contains copied template files
- [ ] architecture.md mentions at least 2 real components by name
- [ ] Every path mentioned in code-map.md actually exists

**Progress marker:** Append one line to the shared setup session log:
- `Step 04 complete: architecture + code map updated`

NEXT: proceed to `05-customise-to-project.md`
