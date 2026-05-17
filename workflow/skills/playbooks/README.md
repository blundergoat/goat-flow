---
goat-flow-reference-version: "1.7.0"
---
# Skill Playbooks

This directory holds **standalone playbooks for tools and capabilities available to coding agents** in this project. Each playbook is self-contained — no skill composes them in. They are loaded on-demand by skills (or by you) when a tool is named.

For shared meta-references composed into every skill (preamble, conventions), see the sibling `skill-reference/` directory.

## How agents should use this directory

1. When the user asks to use a capability ("drive a browser", "screenshot pages", "test a skill"), check this index for a matching playbook.
2. Open the playbook. If it has an **Availability Check** section, run the exact `command -v <tool>` or equivalent it specifies before falling back.
3. Only after the availability check fails AND the playbook's fallback path also fails, declare the capability unavailable.

**Anti-pattern (don't do this):** spinning up `ToolSearch` or scanning the harness toolbox alone, finding nothing, and declaring "no tool available". That conflates "no harness tool" with "no tool". The playbooks here exist precisely to surface project-local tools the harness cannot see.

## Available playbooks

| Playbook | When to use | Tool / capability |
|---|---|---|
| [`browser-use.md`](./browser-use.md) | One-off browser observation: load a URL, screenshot, click, inspect DOM, capture state mid-investigation | `browser-use` CLI, typically at `~/.local/bin/browser-use` |
| [`page-capture.md`](./page-capture.md) | Batch capture: visit N known pages, screenshot each, emit one MD record per page, for documentation, before/after evidence, or audit snapshots | Playwright (MCP / Node / Python tier), or `browser-use` CLI as a downgrade |
| [`skill-quality-testing.md`](./skill-quality-testing.md) | Authoring or hardening a goat-flow skill (TDD-on-skills methodology). Load first when creating/editing a skill; routes into `skill-quality-testing/` topical files for the relevant phase | n/a (skill-authoring methodology) |

## Adding a new playbook

When you add a new tool to the project that future agents need to discover:

1. Drop a `<tool>.md` file in this directory.
2. Start with a YAML frontmatter block that includes `goat-flow-reference-version`.
3. **First section MUST be `## Availability Check`** for every new playbook. For runnable tools/capabilities, include an exact shell-runnable verification command; for non-runnable authoring references, state the load condition and why no CLI check applies. This is what agents grep for.
4. Add a row to the table above so the index stays complete.

## Why this index exists (provenance)

A 2026-05-03 downstream incident: an agent was asked to "use browser-use" to inspect a page; it ran `ToolSearch` looking for an MCP, found only auth tools, and declared "no browser MCP available, can't drive a browser session". The user pushed back with the literal path `.goat-flow/skill-reference/browser-use.md` (now `.goat-flow/skill-playbooks/browser-use.md`), which documents the local availability check. Running `command -v browser-use` returned a user-local wrapper under `~/.local/bin/` — the tool was always installed.

This index plus a Router Table pointer in every supported instruction file is the structural fix: agents must read project-local capability playbooks before treating harness-tool absence as capability absence.
