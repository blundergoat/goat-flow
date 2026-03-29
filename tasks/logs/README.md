# Local Telemetry Logs

Local-only telemetry for tracking goat-flow setup quality over time. All data files are gitignored — only this README and `.gitignore` are tracked.

## Directory Structure

```
tasks/logs/
├── .gitignore              # Ignores everything except README.md
├── README.md               # This file (tracked)
├── scan-history.jsonl      # Appended by `goat-flow scan` (auto)
├── incidents.jsonl          # Appended by agents during VERIFY/LOG
└── sessions/               # One file per skill session
    └── YYYY-MM-DD-goat-{skill}.md
```

## scan-history.jsonl

Auto-appended by `goat-flow scan` after each run. One JSON line per agent per scan.

```jsonc
{
  "date": "2026-03-29T14:30:00.000Z",
  "agent": "claude",
  "grade": "A",
  "percentage": 100,
  "checks": { "pass": 90, "partial": 3, "fail": 2, "na": 3, "total": 98 },
  "deductions": 0,
  "tiers": {
    "foundation": { "earned": 43, "available": 43, "percentage": 100 },
    "standard":   { "earned": 62, "available": 62, "percentage": 100 },
    "full":       { "earned": 17, "available": 17, "percentage": 100 }
  },
  "packageVersion": "0.9.0",
  "rubricVersion": "0.9.0"
}
```

### Querying scan history

```bash
# All scans for claude agent
grep '"claude"' tasks/logs/scan-history.jsonl | jq .

# Score trend (date + percentage)
jq -r '[.date, .agent, .percentage] | @tsv' tasks/logs/scan-history.jsonl

# Only failing scans
jq 'select(.grade == "D" or .grade == "F")' tasks/logs/scan-history.jsonl
```

## incidents.jsonl

Appended by agents during VERIFY and LOG steps. Written when corrections happen, boundaries are crossed, or the two-corrections-rewind rule fires.

```jsonc
{
  "date": "2026-03-29T15:00:00.000Z",
  "trigger": "verify-failure",       // verify-failure | human-correction | boundary-crossed | two-corrections-rewind
  "step": "VERIFY",                  // READ | CLASSIFY | SCOPE | ACT | VERIFY | LOG
  "skill": "goat-debug",            // or "none" if bare execution loop
  "summary": "shellcheck failed on new hook script",
  "files": ["scripts/hooks/deny-dangerous.sh"],
  "logged_to": ["docs/lessons.md"],  // where the correction was recorded
  "boundary": null,                  // which boundary was crossed (if applicable)
  "correction_count": 1              // 1st or 2nd correction (for two-corrections tracking)
}
```

### Querying incidents

```bash
# All boundary crossings
jq 'select(.trigger == "boundary-crossed")' tasks/logs/incidents.jsonl

# Incidents by skill
jq 'select(.skill == "goat-refactor")' tasks/logs/incidents.jsonl

# Two-corrections events (agent was forced to rewind)
jq 'select(.trigger == "two-corrections-rewind")' tasks/logs/incidents.jsonl
```

## sessions/*.md

One file per skill session. Written by the agent at skill close.

```markdown
# Session: /goat-debug
**Date:** 2026-03-29
**Complexity:** Standard Feature
**Turns:** 7
**Boundaries touched:** none
**VERIFY outcomes:** pass

## Summary
Diagnosed race condition in auth middleware. Root cause was missing mutex
on shared token cache. Fix applied and verified with concurrent test.

## Incidents
none
```

If multiple sessions of the same skill occur on the same day, append a counter: `2026-03-29-goat-debug-2.md`.

## Notes

- `scan-history.jsonl` is written automatically by the CLI — no agent action needed
- `incidents.jsonl` and `sessions/` are written by agents following the execution loop and skill closing protocol
- This directory can be safely deleted (`rm -rf tasks/logs/*.jsonl tasks/logs/sessions/`) to reset telemetry
- The learning loop files (`docs/lessons.md`, `docs/footguns.md`) remain the canonical record; telemetry is supplementary structured data
