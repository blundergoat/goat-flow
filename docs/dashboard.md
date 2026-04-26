# Dashboard Reference

Launch: `npx goat-flow dashboard .` (or `npx goat-flow dashboard . --dev` for live reload)

## Views

### Home

Overview landing page. Shows an active-sessions strip, a four-pill rollup for install, harness, learning-loop, and quality status, plus a priority-driven Next Action card based on the latest audit and quality history. The agent grid compares harness health across supported agents and expands per-agent details. The lower row summarizes install state with a health ring and lists recent lesson entries. Run a new audit or re-audit after changes without leaving the page; the healthy state still presents a Next Action card rather than replacing actions with a banner.

### Quality

Generate and view agent quality-assessment prompts. Select a target agent, generate the prompt, and preview the full output with embedded audit results.

### Setup

Guided setup flow. Detects your project stack and existing configuration, lets you pick a target agent (Claude, Codex, Gemini, Copilot), then generates a setup prompt you can preview and launch directly in a terminal session.

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

### Help

Getting-started page for new users. Explains what goat-flow is, the audit/quality model, what skills and hooks do, the learning loop, and the execution loop. Accessible from the "?" button in the nav bar.

## Terminal

- Supports Claude, Codex, Gemini, and Copilot runners from `workflow/manifest.json` in v1.2.0
- WebSocket-based PTY sessions via xterm.js
- 60-minute idle timeout with auto-kill
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
