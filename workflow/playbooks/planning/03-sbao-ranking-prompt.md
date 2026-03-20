# Prompt: SBAO Ranking

> **When to use:** After writing your [feature brief](01-feature-brief-template.md) and optionally running [Mob Elaboration](02-mob-elaboration-prompt.md). Use this to generate and refine a technical plan before breaking it into [milestones](04-milestone-planning-prompt.md).

Signal-Based Adaptive Orchestration — ask multiple AI coding agents for competing plans, then have them rank and critique each other.

**Triangulation.** Triple check if the first two differ.
**Context sanitisation.** Asking the same question with no context, a litmus test for context rot.
**Adversarial cross-examination.** Best idea wins.

## Step 1: Generate competing plans

Use multiple AI agents (e.g., separate chat sessions, Cursor multi-agent mode, different providers) and ask each one:

```
Deeply review the codebase and the following requirements (attach `requirements-<feature-name>.md`), and give me a technical plan in this file `TODO_feature-name_{model}.md`
```

## Step 2: Rank the plans

Once all plan files have been created, ask the agents:

```
Rank each plan in a comparison table and rate them out of 100 with reasons.
```

## Step 3: Create the prime plan

Review their ideas and pick the best ones. Then ask your preferred agent to synthesize:

```
I've reviewed these competing plans. Here's what I like and don't like:

**Keep:** [list the ideas, approaches, or architectural choices you want to keep]
**Drop:** [list what you disagree with or want to change]
**Decide:** [list open questions or trade-offs you want the agent to weigh in on]

Create a best-of-all-ideas plan in `TODO_feature-name_prime.md` that incorporates the Keep items, avoids the Drop items, and makes a reasoned recommendation for each Decide item.
```

---
