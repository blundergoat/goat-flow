---
goat-flow-reference-version: "1.10.1"
---
# Skill Playbooks

This directory holds **standalone playbooks for tools and capabilities available to coding agents** in this project. Each playbook is self-contained - no skill composes them in. They are loaded on-demand by skills (or by you) when a tool is named.

For shared meta-references composed into every skill (preamble, conventions), see the parent `skill-docs/` directory.

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
| [`observability.md`](./observability.md) | Instrumenting code with logs, metrics, span events, or trace context: severity, structured fields, naming, cardinality budget, sensitive-data rules, and the log-vs-metric decision | n/a (instrumentation discipline) |
| [`code-comments.md`](./code-comments.md) | Writing or editing source code: which inline comments earn their place, the mandatory doc-comment contract on every function/class/file, TODO/FIXME/HACK marker rules, and whether existing comments should be kept, rewritten, or deleted | n/a (commenting discipline) |
| [`gruff-code-quality.md`](./gruff-code-quality.md) | Running `gruff-go`, `gruff-rs`, `gruff-ts`, `gruff-php`, or `gruff-py`; triaging findings and verifying analyzer-driven cleanup without low-value comments or suppressions | gruff CLI family |
| [`changelog.md`](./changelog.md) | Writing or editing `CHANGELOG.md`: Keep a Changelog categories, SemVer alignment, breaking-change markers and migration paths, write-at-commit vs write-at-release cadence, version-surface sync | n/a (changelog discipline) |
| [`release-notes.md`](./release-notes.md) | Writing a per-release narrative for end users (GitHub release body, blog post, email, in-app banner, social): theme identification, user-impact lens, inverted-pyramid structure, multi-surface consistency. Derives from `changelog.md` | n/a (release-notes discipline) |

## Adding a new playbook

When you add a new tool to the project that future agents need to discover:

1. Drop a `<tool>.md` file in this directory.
2. Start with a YAML frontmatter block that includes `goat-flow-reference-version`.
3. **First section MUST be `## Availability Check`** for every new playbook. For runnable tools/capabilities, include an exact shell-runnable verification command; for non-runnable authoring references, state the load condition and why no CLI check applies. This is what agents grep for.
4. Add a row to the table above so the index stays complete.

## Why this index exists (provenance)

A 2026-05-03 downstream incident: an agent was asked to "use browser-use" to inspect a page; it ran `ToolSearch` looking for an MCP, found only auth tools, and declared "no browser MCP available, can't drive a browser session". The user pushed back with the literal path `.goat-flow/skill-docs/browser-use.md` (now `.goat-flow/skill-docs/playbooks/browser-use.md`), which documents the local availability check. Running `command -v browser-use` returned a user-local wrapper under `~/.local/bin/` - the tool was always installed.

This index plus a Router Table pointer in every supported instruction file is the structural fix: agents must read project-local capability playbooks before treating harness-tool absence as capability absence.
