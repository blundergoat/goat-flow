# Prompt: Generate Code Map

> **When to use:** When setting up context files for a new or existing project. Creates a scannable reference for AI agents and developers to quickly understand the repo layout.
>
> **Output:** `docs/code-map.md` — reference this from your [hot-path context file](08-claude-md-hot-path-prompt.md).

```
Create docs/code-map.md: a quick-reference tree map of the repository layout.
Use this format:

project-name/
├── file.yaml        = brief description
├── dir/
│   ├── subdir/      = brief description
│   └── file.go      = brief description
└── other/           = brief description

Rules:
- Explore the full directory structure before writing
- One-line "= description" for every entry
- Call out generated/never-edit files explicitly
- Group related items but don't go deeper than 3-4 levels (summarize beyond that)
- Include key files by name when they're important (e.g. router.go, api.ts)
- Note ports, stack choices, and tools inline where relevant
- Keep it scannable: someone should understand the project layout in 30 seconds
```
