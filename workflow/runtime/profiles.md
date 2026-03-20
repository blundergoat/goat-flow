# Prompt: Create Permission Profiles

Paste this into your coding agent to create per-role permission profiles.

---

## When to Use

Run this in Phase 2 (after the base workflow is established). Permission profiles are useful when:
- Different parts of the codebase have different risk levels (frontend vs backend vs infra)
- Multiple developers or agents work on different areas
- You want to restrict file access per task type

---

## The Prompt

```
Create per-role permission profiles for this project. These restrict
which files the agent can edit and which commands it can run, based
on the current task.

This project is a [APP TYPE - e.g., Tauri app, web app, API service].

The codebase has these major areas:
- [area 1, e.g., frontend - src/components/, src/pages/]
- [area 2, e.g., backend - src/api/, src/services/]
- [area 3, e.g., infrastructure - docker/, .github/, terraform/]

Create .claude/profiles/ directory with one JSON file per role:

1. .claude/profiles/frontend.json
   - Edit: [frontend paths only]
   - Bash: [frontend build/test commands only]
   - Read: ** (always full read access)

2. .claude/profiles/backend.json
   - Edit: [backend paths only]
   - Bash: [backend build/test commands only]
   - Read: ** (always full read access)

3. .claude/profiles/infra.json
   - Edit: [infrastructure paths only]
   - Bash: [infrastructure commands only]
   - Read: ** (always full read access)

Adapt the number and names of profiles to match THIS project's actual
architecture. Don't create profiles for areas that don't exist.

Each profile JSON should follow this structure:
{
  "permissions": {
    "allow": [
      "Read(**)",
      "Edit([paths for this role])",
      "Bash([commands for this role])"
    ]
  }
}

After creating profiles:
- Update the CLAUDE.md router table to reference .claude/profiles/
- Add a one-line note in CLAUDE.md: "Permission profiles available
  in .claude/profiles/ - load per task type"

VERIFICATION:
- Verify each profile JSON is valid
- Verify all profiles have Read: ** (never restrict reading)
- Verify profiles reference paths that actually exist in the codebase
- Verify CLAUDE.md router table mentions profiles
- Report: number of profiles created and which areas they cover
```
