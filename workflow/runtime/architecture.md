# Prompt: Generate System Architecture Doc

> **When to use:** When setting up context files, especially for multi-service or full-stack projects. Gives AI agents a visual map of how the system is wired before they make changes.
>
> **Output:** `docs/architecture.md` - reference this from your instruction file (CLAUDE.md / AGENTS.md).

```
Create docs/architecture.md with mermaid diagrams showing how this system works.
Include the following diagrams where applicable - skip any that don't apply to this project:
1. System overview: all major components and how they connect
2. Request flow: how a user request travels through the system
3. Authentication flow: how auth works end-to-end
4. Deployment flow: how code gets from dev to production
5. Data flow: how data moves between services/stores

Between each diagram, add 2-3 sentences explaining WHY things are wired that way, not just what the boxes are. Call out external services, cloud resources, and key infrastructure decisions.

The primary audience is an AI coding agent that needs to understand the system architecture before making changes. Optimize for scannability.
Keep it under 150 lines.
```
