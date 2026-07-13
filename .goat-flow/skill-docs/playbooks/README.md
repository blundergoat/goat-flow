---
goat-flow-reference-version: "1.13.1"
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
| [`code-comments.md`](./code-comments.md) | Writing or editing source code: user-perspective doc comments, self-documenting names, context comments above branches/loops/null checks, null/empty tag meaning, journey anchors, TODO/FIXME/HACK markers, and concise comment cleanup | n/a (commenting discipline) |
| [`gruff-code-quality.md`](./gruff-code-quality.md) | Running `gruff-go`, `gruff-rs`, `gruff-ts`, `gruff-php`, or `gruff-py`; triaging findings and verifying analyzer-driven cleanup without low-value comments or suppressions | gruff CLI family |
| [`hook-policy-testing.md`](./hook-policy-testing.md) | Verifying deny-hook policy, paired blocked/allowed command grammar, source/install parity, and central agent registration after hook changes | `deny-dangerous.sh --self-test` and `--check` |
| [`changelog.md`](./changelog.md) | Writing or editing `CHANGELOG.md`: Keep a Changelog categories, SemVer alignment, breaking-change markers and migration paths, write-at-commit vs write-at-release cadence, version-surface sync | n/a (changelog discipline) |
| [`release-notes.md`](./release-notes.md) | Writing a per-release narrative for end users (GitHub release body, blog post, email, in-app banner, social): theme identification, user-impact lens, inverted-pyramid structure, multi-surface consistency. Derives from `changelog.md` | n/a (release-notes discipline) |
| [`skill-playbook-authoring-sync.md`](./skill-playbook-authoring-sync.md) | Adding or materially editing a built-in playbook while keeping source/install mirrors, discovery, audit registration, and manifest ownership aligned | n/a (playbook-authoring discipline) |

## Adding a new playbook

Before adding or materially editing a built-in playbook, load
[`skill-playbook-authoring-sync.md`](./skill-playbook-authoring-sync.md). It owns
the frontmatter, first-H2, bundling, README, audit-registration, manifest, and
verification contract. Keep top-level progressive references below 3,000 body
words and add the discovery row above in both README mirrors.

## Admission checklist

Use the smallest artifact that fits the evidence:

| Candidate shape | Route to |
|---|---|
| First-class workflow with Step 0, modes, gates, or reports | goat-* skill |
| Tool or capability runbook loaded on demand | `.goat-flow/skill-docs/playbooks/<name>.md` |
| Shared doctrine every skill inherits | `.goat-flow/skill-docs/` |
| Real incident or permanent caution | `.goat-flow/learning-loop/lessons/` or `footguns/` |
| Short always-visible project rule | instruction file |
| Deterministic transform or validation | CLI/check/script |
| One-off or speculative advice | no new artifact yet |

## Why this index exists (provenance)

A 2026-05-03 downstream incident: an agent was asked to "use browser-use" to inspect a page; it ran `ToolSearch` looking for an MCP, found only auth tools, and declared "no browser MCP available, can't drive a browser session". The user pushed back with the literal path `.goat-flow/skill-docs/browser-use.md` (now `.goat-flow/skill-docs/playbooks/browser-use.md`), which documents the local availability check. Running `command -v browser-use` returned a user-local wrapper under `~/.local/bin/` - the tool was always installed.

This index plus a Router Table pointer in every supported instruction file is the structural fix: agents must read project-local capability playbooks before treating harness-tool absence as capability absence.
