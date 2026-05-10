# Dashboard Reference

Launch: `npx goat-flow dashboard .` (or `npx goat-flow dashboard . --dev` for live reload)

## Local Access Boundary

The dashboard is a local privileged control plane. Each server process prints a URL containing an ephemeral token, injects that token into the browser boot payload, and clears it from the visible address bar after load. All `/api/*` requests and `/ws/terminal/:id` attaches require the current token; side-effectful HTTP routes also reject browser requests whose `Origin` is not the dashboard's own localhost origin. The token is process-local only and must not be written to dashboard state, terminal session metadata, localStorage, or PTY environment.

Read-only browsing and audit routes may still inspect arbitrary local paths selected in the UI after token authorization. Side-effectful routes are guarded by the same token boundary, and terminal creation still validates that the requested project path is an existing directory.

## Views

### Home

Overview landing page. Shows an active-sessions strip, a four-pill rollup for install, harness, learning-loop, and quality status, plus a priority-driven Next Action card based on the latest audit and quality history. The agent grid compares harness health across supported agents and expands per-agent details. The lower row summarizes install state with a health ring and lists recent lesson entries. Run a new audit or re-audit after changes without leaving the page; the healthy state still presents a Next Action card rather than replacing actions with a banner.

### Quality

Generate and view agent quality-assessment prompts. Select a target agent, generate the prompt, and preview the full output with embedded audit results.

### Setup

Guided setup flow. Detects your project stack and existing configuration, lets you pick a target agent (Claude, Codex, Gemini, Copilot), then generates a setup prompt you can preview and launch directly in a terminal session.

### Skills

Per-artifact quality view for installed skills and shared references. Shows deterministic structural scores, warning counts, subtype-aware metric profiles, and a detail panel for inspecting one artifact at a time. Use `Re-audit all` to refresh the cached scores or `Evaluate skill` to inspect uploaded skill/reference content before installing it.

### Projects

Multi-project browser. Lists all registered project paths with their latest audit status. "Audit All" re-audits every project in one click. Select a project to switch context and view its results on the Home view.

### Prompts

Dedicated prompt library. Two-pane layout: left pane is the list with search, category filters, favorites strip, and grouped-by-category rendering; right pane is the full prompt preview with search-match highlighting. Primary actions are `Copy`, `Launch in new terminal`, and `Send to active terminal` -- the last one is project-scoped and only appears when one or more active sessions exist for the current project (a picker is shown when multiple). Keyboard: `/` focuses search, `↑` / `↓` navigate, `Enter` launches the selected prompt, `Esc` clears the search or selection.

Good default presets to start with:

- `Debug UI in Browser` routes to `/goat-debug` and diagnoses browser-visible bugs with live browser evidence. It checks for `browser-use`, asks for the URL and symptom, captures page state and screenshots, then maps the evidence back to source before proposing a fix.
- `Fix Bug` runs `/goat-debug` from diagnosis through a minimal fix and post-fix verification.
- `Review Uncommitted` runs `/goat-review` as a pre-commit gate for MUST-level findings only.
- `Pre Walk-Through with Draft Targeted Testing` turns a PR and issue into reviewer questions plus targeted local UI test tasks.
- `Test Plan vs Code Changes` compares a proposed test plan against the actual diff and calls out coverage gaps.
- `Break Into Milestones` turns a feature brief into testable `/goat-plan` milestones.
- `Security Assessment` runs a full `/goat-security` threat assessment across the repo, runtime surface, and dependencies.

### Workspace

Split layout focused on terminal work. The left **Sessions rail** lists all running terminal sessions (up to 10) grouped by current project first then other projects, with single-click session switching, runner/age/idle/detached indicators, inline-confirm `End`, an `End all` footer, and a `+ New session` shortcut that jumps to Prompts. The right pane is the active xterm.js terminal. The rail uses `x-transition` on collapse/expand.

### Settings

Configuration view. Manage registered project paths, dashboard preferences, and agent runtime settings.

### About

Getting-started page for new users. Explains what goat-flow is, the audit/quality model, what skills and hooks do, the learning loop, and the execution loop. Accessible from the "?" button in the nav bar.

## Terminal

- Supports Claude, Codex, Gemini, and Copilot runners from `workflow/manifest.json`
- WebSocket-based PTY sessions via xterm.js
- 480-minute idle timeout (8 hours) with auto-kill
- Maximum 10 concurrent sessions
- Session state: running / ended / error

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/audit` | GET | Run audit, return JSON results |
| `/api/setup` | GET | Generate setup prompt |
| `/api/quality` | GET | Generate quality-assessment prompt |
| `/api/setup/detect` | GET | Detect project stack and agents |
| `/api/health` | GET | Health check |
| `/api/agents/installed` | GET | Detect installed agent runtimes |
| `/api/projects/list` | GET | List registered projects |
| `/api/projects/status` | GET | Project state classification |
| `/api/terminal/create` | POST | Start a terminal session |
| `/api/terminal/list` | GET | List active terminal sessions |
| `/api/terminal/sessions` | GET | Session metadata |
| `/api/terminal/:id` | DELETE | End a terminal session |

## Design ethos: utilitarian, not decorative

The dashboard is a local operations console for AI coding workflows, not a landing page or marketing surface. When adding or changing UI, run through this anti-convergence checklist before declaring done. The list is harvested from the prime corpus's frontend-design skill (search: `Design Thinking` in `.goat-flow/scratchpad/skills-example-prime/frontend-design/SKILL.md`); apply only the parts that fit a utilitarian operations tool.

- **Purpose** — what operational decision does this view support? If it has no decision, it is documentation; consider whether it belongs in `docs/` instead.
- **Density** — every panel earns its space. Default to a denser layout than a typical SaaS landing page; whitespace is for separating noisy regions, not framing single elements.
- **Scannability** — operators arrive mid-task. Place the highest-signal data top-left, and use letter grades, badges, or counts before paragraphs.
- **Differentiation** — the dashboard's job is to surface goat-flow's audit/harness/quality state. Generic AI-assistant UI patterns (chat bubbles, animated typing, illustrative empty states) usually pull the eye away from that data.
- **Tone** — neutral, technical, lower-case status words ("audited just now", "12 skills audited"). Avoid celebratory copy ("Awesome!", "All set!") and apology copy ("Oops!").
- **Constraints** — `.gf-*` CSS classes, theme variables (`--surface-base`, `--surface-elevated`, `--text-primary`), and Alpine for interactivity. No new heavy dependencies, no decorative motion, no framework swap "while we're in here".
- **Typography / colour / motion fit** — typography is monospace-leaning for evidence, sans-serif for status; colour is reserved for severity (`is-a`/`is-b`/.../`is-f`, `is-low`); motion is restricted to load spinners and disabled-button feedback. Anything else needs a justification tied to an operator decision.

When in doubt, look at the Skills page or the Home view as the reference shape — both are operations-first. Imitate them; do not import a marketing-site shape.
