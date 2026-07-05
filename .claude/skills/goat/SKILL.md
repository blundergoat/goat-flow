---
name: goat
description: "Use when you describe an outcome and need the right goat-* workflow chosen for you."
goat-flow-skill-version: "1.13.1"
---
# /goat

## Shared Conventions

Read `.goat-flow/skill-docs/skill-preamble.md` for shared conventions.

Use when the user gives an outcome and needs the right goat-* route. **If the user names a skill explicitly (`/goat-debug`, `/goat-review`, etc.), route immediately - no classification, no GATHER.**

**If a symptom tempts code reading, STOP.** The dispatcher routes; the routed skill investigates.

| Excuse | Reality |
|--------|---------|
| "I can see it - routing is overhead" | You are dispatcher, not investigator. Route first. |
| "The user said 'just fix it'" | Pressure is not an override. Route to /goat-debug. |
| "Time pressure means investigate now" | Routing takes seconds; wrong routing wastes more. |
| "Multiple symptoms mean read files" | Split numbered intents; route each separately. |

## How It Works

1. **UNDERSTAND** - classify intent and target. If multiple intents, number each and route independently. Ask only if ordering matters.
2. **GATHER** - before routing, check:
   - Footgun matches: grep `.goat-flow/learning-loop/footguns/INDEX.md` for the target area; open entries only on hits
   - Ask-first boundaries: scan the active instruction file's Ask First boundaries for named files; if none are named, record `target-files=unknown`
   - If any check fails or is unavailable, note `gather-degraded` and route anyway
   - Do not emit the preamble's `Relevant prior learnings` line - that belongs to the routed skill's Step 0
3. **ROUTE** - dispatch using the route map. Emit a Route Snapshot (`Intent` / `Route` / `Rationale`), e.g.:

```
Intent: Diagnose a slow endpoint
Route: /goat-debug
Rationale: "slow" is a symptom to investigate; no file named -> target-files=unknown
```

## Route Map

| Intent | Route |
|--------|-------|
| Bug, failure, unexpected behaviour | `/goat-debug` |
| Verify a fix worked | `/goat-debug` (post-fix verification) |
| Browser-visible issue | Browser evidence first; `/goat-debug` Investigate if diagnosis needed |
| Understand, explain, explore unfamiliar code | `/goat-debug` (Investigate mode) |
| Quality review, audit, diff check | `/goat-review` |
| Verify a diff/PR before merge | `/goat-review` |
| Multi-perspective critique | `/goat-critique` |
| Security, compliance, dependency audit | `/goat-security` |
| Testing gaps, coverage, verification planning | `/goat-qa` |
| Verify test coverage | `/goat-qa` |
| Feature planning, milestones | `/goat-plan` |
| Bare task path (no action verb) | Bare or ambiguous task paths are read-only context. Do not update `.active`, milestone status, or code from a path alone |
| Build/plan verb + scope | `/goat-plan` (Step 0 handles complexity and mode) |
| Simple implementation (single-file, obvious) | No skill; use execution loop directly |
| Simple question | Answer directly |

**More examples:** `/goat-review this diff` -> `/goat-review` (explicit; no GATHER). `Look at auth` -> `/goat-security` (assume security audit; offer `/goat-review` re-route). `Debug login test then review fix` -> 1. `/goat-debug`; 2. `/goat-review`.

## Constraints

- MUST respect explicit skill invocations immediately - no reclassification
- MUST NOT inspect source code, read implementation files, or make changes before routing
- MUST understand intent conversationally, not via keyword lookup - 0-2 clarification questions max; route with stated assumption if still ambiguous
- MUST emit a Route Snapshot with every dispatch - Proof Gate applies to route claims
- MUST split multi-intent requests into numbered intents and route each
- MUST pass brief/depth to target skill and preserve context on re-route
