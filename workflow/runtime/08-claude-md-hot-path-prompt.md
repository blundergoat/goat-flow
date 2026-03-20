# Prompt: Generate CLAUDE.md Hot-Path Structure

> **When to use:** After creating your [code map](05-code-map-prompt.md), [architecture diagrams](06-system-architecture-prompt.md), and [domain instruction files](07-domain-instruction-files-prompt.md). This prompt creates the lean router that ties them together.
>
> **What it creates:** Your project's hot-path context file (CLAUDE.md / AGENTS.md / GEMINI.md — whichever your AI tool uses). This file is loaded into every AI conversation, so every line must earn its place.

```
Create a lean context file (~75 lines) that acts as a hot-path router.
Use the appropriate filename for your AI tool: CLAUDE.md / AGENTS.md / GEMINI.md.

This file is loaded into every AI conversation, so every line must earn its
place. Structure it as:

1. **Project identity** (3-5 lines): stack, ports, one-sentence description
2. **Essential commands** (4-6 lines): only the commands needed every session (start dev, run checks, connect to DB)
3. **Hard rules** (8-12 lines): things that cause real breakage if violated. Only include rules where getting it wrong breaks the build, corrupts data, or causes production issues
4. **Common workflows** (8-12 lines): the 2-3 most frequent multi-step tasks as compressed numbered steps
5. **Commit message format** (3-5 lines)
6. **Router table** (~25 lines): three-column table mapping file paths to "read when..." triggers, grouped into:
  - Domain guides (.github/instructions/)
  - Architecture & reference (docs/, config files)
  - Operations (runbooks, deployment, troubleshooting)

Rules for the router table:
- Use task-language in "read when..." ("Writing Go code", not "Go conventions")
- Every referenced file must actually exist
- Group by: domain guides, architecture, operations

Do NOT include in the context file:
- Directory structure (belongs in docs/code-map.md)
- Detailed command lists (belongs in domain .instructions files)
- Full pattern explanations (belongs in .instructions files)
- Authentication details (belongs in dedicated auth docs)
- Troubleshooting tables (belongs in runbooks or .instructions files)

Explore the codebase and existing docs first. Cross-reference with .github/instructions/ and docs/ to avoid duplication.
```
