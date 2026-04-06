# Dashboard Reference

Launch: `goat-flow dashboard` (or `goat-flow dashboard --dev` for live reload)

## Views

### Home
- Action-driven cards: "What to do next" based on scan results
- Per-agent scanner cards with tier score bars
- Agent terminal launcher

### Scanner
- Single-page scan results with inline detail expansion
- Per-check pass/fail with severity badges
- Clickable recommendations linking to setup guidance

### Workspace
- Terminal panel for running agent sessions
- Prompt library with category filters and run states
- Session output with copy/paste support

### Setup Wizard
- Detected project configuration
- Agent selector
- Setup prompt preview with "Run in Terminal" launcher

### Settings
- Project path configuration
- User role selection (developer/investigator/tester)
- Dark/light theme toggle

## Terminal

- Supports Claude, Codex, Gemini, Copilot runners
- WebSocket-based PTY sessions via xterm.js
- 60-minute idle timeout with auto-kill
- Maximum 3 concurrent sessions
- Session state: running / ended / error

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/scan` | GET | Run scan, return JSON results |
| `/api/setup` | POST | Generate setup prompt |
| `/api/terminal/create` | POST | Start a terminal session |
| `/api/terminal/kill` | POST | End a terminal session |
| `/api/config` | GET/POST | Read/update project config |
