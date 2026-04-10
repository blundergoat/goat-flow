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

- `.goat-flow/decisions/` — for architecture decision records
- `.goat-flow/decisions/ADR-000-template.md` — copy from `workflow/setup/reference/ADR-000-template.md`
- `.goat-flow/tasks/` — for milestone and task tracking files
- `.goat-flow/logs/sessions/` — for session logs (if not already created by step 01)
- `.goat-flow/playbooks/` — copy from `workflow/playbooks/` verbatim. These contain detailed procedures (SBAO, Mob Elaboration, milestone planning, testing workflow) that skills reference on demand.

## Shared rules

- Document the current implementation, not roadmap ideas
- Read source files, config, and deployment assets before writing either file
- Keep both files concise and scannable
- Every path mentioned in either file must exist on disk

---

**Verification gate:**
- [ ] `.goat-flow/architecture.md` exists with real content (not template fill)
- [ ] `.goat-flow/code-map.md` exists
- [ ] `.goat-flow/decisions/ADR-000-template.md` exists
- [ ] `.goat-flow/decisions/`, `.goat-flow/tasks/`, `.goat-flow/logs/sessions/`, `.goat-flow/playbooks/` directories exist
- [ ] `.goat-flow/playbooks/planning/` and `.goat-flow/playbooks/testing/` contain copied playbook files
- [ ] architecture.md mentions at least 2 real components by name
- [ ] Every path mentioned in code-map.md actually exists

**Progress marker:** Append one line to the shared setup session log:
- `Step 04 complete: architecture + code map updated`

NEXT: proceed to `05-customise-to-project.md`
