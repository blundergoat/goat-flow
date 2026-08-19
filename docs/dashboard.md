# Dashboard Reference

Launch: `npx @blundergoat/goat-flow@latest dashboard .` (or `npx @blundergoat/goat-flow@latest dashboard . --dev` for live reload)

## Local Access Boundary

The dashboard is a local privileged control plane. Each server process prints a URL containing an ephemeral token, injects that token into the browser boot payload, and clears it from the visible address bar after load. All `/api/*` requests and `/ws/terminal/:id` attaches require the current token; side-effectful HTTP routes also reject browser requests whose `Origin` is not the dashboard's own localhost origin. The token is process-local only and must not be written to dashboard state, terminal session metadata, localStorage, or PTY environment.

Read-only browsing and audit routes may still inspect arbitrary local paths selected in the UI after token authorization. Side-effectful routes are guarded by the same token boundary, and terminal creation still validates that the requested project path is an existing directory.

Successful dashboard operations append redacted evidence-envelope records to `.goat-flow/logs/events/*.jsonl`. The trace records terminal creation, prompt launch/send, audit runs, setup or quality prompt generation, and project-list changes without storing full prompt text, terminal scrollback, or uploaded file contents. Inspect it with `goat-flow events tail . --limit 20`.

## Views

The dashboard uses a persistent desktop side rail for primary navigation. It collapses to icons with tooltips, exposes the active plan while collapsed, and groups Projects, Prompts, and New Prompt. The main destinations are Home, Prompts, Workspace, Hooks, Plans, Skills, Projects, Quality, and Setup; Settings and About remain available as utility views. Every destination maps to a real view.

### Home

Overview landing page. Shows an active-sessions strip, a four-pill rollup for install, harness, learning-loop, and quality status, plus a priority-driven Next Action card based on the latest audit and quality history. The agent grid compares harness health across supported agents and expands per-agent details, including an advisory enforcement matrix for hard, limited, soft, missing, and unknown local enforcement evidence. The lower row summarizes install state with a health ring and lists recent lesson entries. Run a new audit or re-audit after changes without leaving the page; the healthy state still presents a Next Action card rather than replacing actions with a banner.

### Plans

Plans milestone browser for the selected project (route ID `plans`). Surfaces
`.goat-flow/plans/` plan directories, milestone status, and checkbox progress.
The plan list can update `.goat-flow/plans/.active` for the selected project.
The canonical backing endpoint is `/api/plans`; `/api/tasks` remains a
deprecated compatibility alias for older dashboard clients.

### Quality

Generate and view agent quality-assessment prompts. Select a target agent,
generate the prompt, and preview the full output with embedded audit results.
Passive view loads use cache-only audit enrichment when available; the
Regenerate action requests a fresh audit before composing the prompt.

### Setup

Guided setup flow. Detects your project stack and existing configuration, lets you pick a target agent from the manifest-backed registry, then generates a setup prompt you can preview and launch directly in a terminal session.

### Skills

Per-artifact quality view for installed skills and shared references. Shows deterministic structural scores, warning counts, subtype-aware metric profiles, and a detail panel for inspecting one artifact at a time. Use `Re-audit all` to refresh the cached scores or `Evaluate skill` to inspect uploaded skill/reference content before installing it.

### Hooks

Manage shipped guardrails and quality hooks for the selected project. Each agent row separates the desired toggle from its effective state across provider evidence, exact registration, current installed bytes, trusted paths, observed execution, delivered results, and configured scenarios. Only `effective` is green. Warning and danger rows name the first broken link and show a copyable repair command when Goat Flow owns one; provider evidence gaps stay explicit without an invented command. Toggles update `.goat-flow/config.yaml` and reconcile per-agent hook config files. The view uses the same registry labels as `goat-flow hooks list`, `audit`, and the `/api/hooks` response.

### Projects

Multi-project browser. Lists immediate non-hidden folders beside the launch project plus paths registered through Add Project. `Refresh Status` updates lightweight setup/version state without creating project identity markers. `Open audit` switches to Home for the full report. Archive hides a project from the active table while retaining its checkout-local identity, title, and aliases; expand Archived to Restore it. Explicitly registered projects follow a stable identity where possible: git remote hash first, then a local `.goat-flow/project-id` marker for non-git goat-flow projects, then absolute path fallback. The marker and archive state remain gitignored local dashboard state.

### Prompts

Dedicated prompt library. Two-pane layout: left pane is the list with search, category filters, favorites strip, and grouped-by-category rendering; right pane is the full prompt preview with search-match highlighting. Primary actions are `Copy`, `Launch in new terminal`, and `Send to active terminal`. The last one is project-scoped and only appears when the current project has at least one active session; multiple sessions show a picker. Keyboard: `/` focuses search, `↑` / `↓` navigate, `Enter` launches the selected prompt, `Esc` clears the search or selection.

Good default presets to start with:

- `Debug UI in Browser` routes to `/goat-debug` and diagnoses browser-visible bugs with live browser evidence. It checks for `browser-use`, asks for the URL and symptom, captures page state and screenshots, then maps the evidence back to source before proposing a fix.
- `Fix Bug` runs `/goat-debug` from diagnosis through a minimal fix and post-fix verification, pausing for your approval before the fix plan and again before implementation.
- `Review Uncommitted` runs `/goat-review` as a pre-commit gate for MUST-level findings only.
- `Pre Walk-Through with Draft Targeted Testing` turns a PR and issue into reviewer questions plus targeted local UI test tasks.
- `Test Plan vs Code Changes` compares a proposed test plan against the actual diff and calls out coverage gaps.
- `Break Into Milestones` turns a feature brief into testable `/goat-plan` milestones.
- `Security Assessment` runs a full `/goat-security` threat assessment across the repo, runtime surface, and dependencies.

### Workspace

Split layout focused on terminal work. The left **Sessions rail** lists all running terminal sessions (up to 10) grouped by current project first then other projects, with single-click session switching, runner/age/idle/detached indicators, inline-confirm `End`, an `End all` footer, and a `+ New session` shortcut that jumps to Prompts. The right pane is the active xterm.js terminal. The rail uses `x-transition` on collapse/expand, supports collapsed-state tooltips, and exposes per-agent class hooks plus an active-session pip with status tone for accessibility. Drag and drop images onto the terminal pane to attach them to the next prompt (uploads go through `/api/terminal/:id/upload-image`).

### Settings

Configuration view. Manage registered project paths, dashboard preferences, and agent runtime settings.

### About

Getting-started page for new users. Explains what goat-flow is, the audit/quality model, what skills and hooks do, the learning loop, and the execution loop. Accessible from the side menu or the header "?" button.

## Terminal

- Supports runners from `workflow/manifest.json`; terminal binary names, setup surfaces, and prompt invocation style are injected from the manifest-backed agent registry
- WebSocket-based PTY sessions via xterm.js
- 480-minute idle timeout (8 hours) with auto-kill
- Maximum 10 concurrent sessions
- Session state: running / ended / error
- Presets with `mayWriteFiles: false`, unclassified launches, and investigator sessions request reporting access; explicit builders and ordinary sessions use workspace access.
- Codex reporting sessions use a native read-mostly profile with narrowly writable ignored paths. Quality writes belong to the controlling workspace for process/skills mode and the selected target for agent-setup/harness mode.
- Claude reporting sessions use an isolated permission overlay: reads remain available, tracked edits and write-capable shell commands are denied, and finalized quality reports are deny-listed against agent edits.
- Claude quality persistence uses one draft under the report owner's gitignored `.goat-flow/logs/quality/staging/` directory. The server claims the draft, validates and scrubs it through the `quality save` core, persists the report, deletes the draft, and writes a receipt.
- Competing dashboard processes skip live draft claims. Stale claims produce rejection receipts, and shutdown removes only claims owned by that process.
- Unsupported Claude controls fail closed instead of reopening workspace access. Other runners rely on their available prompt and hook guardrails.

## API Endpoints

All `/api/*` requests require the dashboard token described in [Local Access Boundary](#local-access-boundary). POST routes additionally enforce the same-origin Origin check.

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/health` | GET | Health check |
| `/api/audit` | GET | Run audit and return JSON results, including effective `hookCoverage` and per-agent advisory enforcement matrices |
| `/api/setup` | GET | Generate setup prompt |
| `/api/setup/detect` | GET | Detect project stack and agents |
| `/api/quality` | GET | Generate quality-assessment prompt, including `auditCacheStatus` (`hit`, `miss`, or `bypass`) for dashboard cache visibility |
| `/api/quality/history` | GET | Persisted quality-history rows and latest trend summary |
| `/api/quality/evaluate` | POST | Score uploaded markdown (skill or shared-reference) and return a deterministic report plus improvement tips. Read-only; canonical from v1.6.0. |
| `/api/quality/analyse` | POST | Deprecated alias for `/api/quality/evaluate`. Returns the same body with `Deprecation: true` and `Link: </api/quality/evaluate>; rel="successor-version"` headers. |
| `/api/skill-quality/inventory` | GET | List installed skill/reference artifacts the dashboard can score |
| `/api/skill-quality` | GET | Score one installed skill/reference artifact and return the metric breakdown plus a runner-prompt preview |
| `/api/agents/installed` | GET | Detect installed agent runtimes |
| `/api/browse` | GET | Directory browsing for the dashboard's path picker (project directories only, no hidden entries) |
| `/api/plans` | GET | Plan milestone state for the selected project |
| `/api/plans` | POST | Set the selected project's active plan in `.goat-flow/plans/.active` |
| `/api/tasks` | GET/POST | Deprecated alias for `/api/plans` |
| `/api/projects/list` | GET | List registered projects from saved dashboard state, including identity-keyed project records |
| `/api/projects/list` | POST | Save the dashboard's registered project list and migrate it to identity-keyed records |
| `/api/projects/status` | GET | Project state classification (`bare`/`partial`/`v0.9`/`outdated`/`current`/`error`) plus dashboard project identity |
| `/api/hooks` | GET | Desired and effective hook state for the selected project, including per-agent severity, first broken link, and repair guidance |
| `/api/hooks/:hookId/toggle` | POST | Enable or disable one hook; updates `.goat-flow/config.yaml` and reconciles per-agent hook config files |
| `/api/terminal/create` | POST | Start a terminal session; accepts `accessMode: "workspace" \| "reporting"`, applies supported runner-specific reporting enforcement, and defaults omitted values to `workspace` |
| `/api/terminal/list` | GET | List active terminal sessions |
| `/api/terminal/sessions` | GET | Session metadata |
| `/api/terminal/:id` | DELETE | End a terminal session |
| `/api/terminal/:id/upload-image` | POST | Upload one or more images attached to an active session; persists to `.goat-flow/logs/uploads/<session>/` and returns an attachment note for the runner |

## Design ethos: utilitarian, not decorative

The dashboard is a local operations console for AI coding workflows, not a landing page or marketing surface. When adding or changing UI, run through this anti-convergence checklist before declaring done. Apply only the parts that fit a utilitarian operations tool.

- **Purpose** - what operational decision does this view support? If it has no decision, it is documentation; consider whether it belongs in `docs/` instead.
- **Density** - every panel earns its space. Default to a denser layout than a typical SaaS landing page; whitespace is for separating noisy regions, not framing single elements.
- **Scannability** - operators arrive mid-task. Place the highest-signal data top-left, and use letter grades, badges, or counts before paragraphs.
- **Differentiation** - the dashboard's job is to surface goat-flow's audit/harness/quality state. Generic AI-assistant UI patterns (chat bubbles, animated typing, illustrative empty states) usually pull the eye away from that data.
- **Tone** - neutral, technical, lower-case status words ("audited just now", "12 skills audited"). Avoid celebratory copy ("Awesome!", "All set!") and apology copy ("Oops!").
- **Constraints** - `.gf-*` CSS classes, theme variables (`--surface-base`, `--surface-elevated`, `--text-primary`), and Alpine for interactivity. No new heavy dependencies, no decorative motion, no framework swap "while we're in here".
- **Typography / colour / motion fit** - typography is monospace-leaning for evidence, sans-serif for status; colour is reserved for severity (`is-a`/`is-b`/.../`is-f`, `is-low`); motion is restricted to load spinners and disabled-button feedback. Anything else needs a justification tied to an operator decision.

When in doubt, look at the Skills page or the Home view as the reference shape - both are operations-first. Imitate them; do not import a marketing-site shape.
