# Dashboard Reference

Launch: `goat-flow dashboard .` (or `goat-flow dashboard . --dev` for live reload)

## Views

### Home

Overview landing page. Shows "What to do next" action cards based on your latest audit results, per-agent status indicators, and quick-launch buttons for the setup wizard and terminal. When all agents pass audit, the action cards are replaced with a success banner.

### Audit

Audit results in a single scrollable page. Each scope (GOAT Flow Setup, Agent Setup, AI Harness Completeness) shows pass/fail status and can be expanded inline for details. Per-agent cards show individual pass/fail results. Failures include actionable fix instructions. Run a new audit or re-audit after changes without leaving the page. Also accessible from action cards on the Home view.

### Critique

Generate and view agent critique prompts. Select a target agent, generate the critique, and preview the full prompt with embedded audit results.

### Setup

Guided setup flow. Detects your project stack and existing configuration, lets you pick a target agent (Claude, Codex, Gemini), then generates a setup prompt you can preview and launch directly in a terminal session.

### Projects

Multi-project browser. Lists all registered project paths with their latest audit status. "Audit All" re-audits every project in one click. Select a project to switch context and view its results in the Audit view.

### Workspace

Split-pane layout. The left panel is a prompt library with category filters and search -- select a prompt to preview it or send it straight to the terminal. The right panel is a live terminal session (xterm.js over WebSocket) where you run agent commands. On mobile the panels collapse into a tab toggle.

### Settings

Configuration view. Manage registered project paths, dashboard preferences, and agent runtime settings.

### Help

Getting-started page for new users. Explains what goat-flow is, the audit/critique model, what skills and hooks do, the learning loop, and the execution loop. Accessible from the "?" button in the nav bar.

## Terminal

- Supports Claude, Codex, Gemini runners
- WebSocket-based PTY sessions via xterm.js
- 60-minute idle timeout with auto-kill
- Maximum 3 concurrent sessions
- Session state: running / ended / error

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/audit` | GET | Run audit, return JSON results |
| `/api/setup` | GET | Generate setup prompt |
| `/api/critique` | GET | Generate critique prompt |
| `/api/setup/detect` | GET | Detect project stack and agents |
| `/api/health` | GET | Health check |
| `/api/agents/installed` | GET | Detect installed agent runtimes |
| `/api/projects/list` | GET | List registered projects |
| `/api/projects/status` | GET | Project state classification |
| `/api/terminal/create` | POST | Start a terminal session |
| `/api/terminal/list` | GET | List active terminal sessions |
| `/api/terminal/sessions` | GET | Session metadata |
| `/api/terminal/:id` | DELETE | End a terminal session |
