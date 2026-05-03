---
goat-flow-reference-version: "1.4.2"
---
# Skill Reference Index

This directory holds **playbooks for tools and capabilities available to coding agents** in this project. Read these BEFORE declaring any tool or capability unavailable - the harness toolbox (agent tool list, MCP servers, etc.) is NOT the only surface; project-local CLI tools at `~/.local/bin/` are equally valid.

## How agents should use this directory

1. When the user asks to use a capability ("drive a browser", "screenshot pages", "test coverage analysis"), check this index for a matching reference file.
2. Open the reference file. If it has an **Availability Check** section, run the exact `command -v <tool>` or equivalent it specifies before using fallback guidance.
3. Only after the availability check fails AND the doc's fallback path also fails, declare the capability unavailable.

**Anti-pattern (don't do this):** spinning up `ToolSearch` or scanning the harness toolbox alone, finding nothing, and declaring "no tool available". That conflates "no harness tool" with "no tool". The reference docs in this directory exist precisely to surface project-local tools the harness cannot see.

## Available references

| Reference | When to use | Tool / capability |
|---|---|---|
| [`browser-use.md`](./browser-use.md) | One-off browser observation: load a URL, screenshot, click, inspect DOM, capture state mid-investigation | `browser-use` CLI, typically at `~/.local/bin/browser-use` |
| [`page-capture.md`](./page-capture.md) | Batch capture: visit N known pages, screenshot each, emit one MD record per page, for documentation, before/after evidence, or audit snapshots | Playwright (MCP / Node / Python tier), or `browser-use` CLI as a downgrade |
| [`skill-conventions.md`](./skill-conventions.md) | Authoring goat-flow skills: footgun/lesson entry shapes, frontmatter contracts, status / created / evidence blocks | n/a (authoring guide) |
| [`skill-preamble.md`](./skill-preamble.md) | Shared preamble loaded by every `/goat-*` skill: Proof Gate, OBSERVED/INFERRED tagging, evidence discipline | n/a (skill convention) |
| [`skill-quality-testing.md`](./skill-quality-testing.md) | Authoring or hardening a goat-flow skill (TDD-on-skills methodology). Load first when creating/editing a skill; routes into `skill-quality-testing/` topical files for the relevant phase | n/a (skill-authoring methodology) |

## Adding a new reference

When you add a new tool to the project that future agents need to discover:

1. Drop a `<tool>.md` file in this directory.
2. Start with a YAML frontmatter block that includes `goat-flow-reference-version`.
3. **First section MUST be `## Availability Check`** for every new reference file. For runnable tools/capabilities, include an exact shell-runnable verification command; for non-runnable authoring references, state the load condition and why no CLI check applies. This is what agents grep for.
4. Add a row to the table above so the index stays complete.

## Why this index exists (provenance)

A 2026-05-03 downstream incident: an agent was asked to "use browser-use" to inspect a page; it ran `ToolSearch` looking for an MCP, found only auth tools, and declared "no browser MCP available, can't drive a browser session". The user pushed back with the literal path `.goat-flow/skill-reference/browser-use.md`, which documents the local availability check. Running `command -v browser-use` returned a user-local wrapper under `~/.local/bin/` - the tool was always installed.

This index plus a Router Table pointer in every supported instruction file is the structural fix: agents must read project-local capability playbooks before treating harness-tool absence as capability absence.
