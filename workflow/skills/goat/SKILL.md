---
name: goat
description: "Use when you describe an outcome and need the right goat-* workflow chosen for you."
goat-flow-skill-version: "1.11.0"
---
# /goat

## Shared Conventions

Read `.goat-flow/skill-docs/skill-preamble.md` for shared conventions.

Use when the user describes an outcome and wants the right workflow chosen. **If the user names a skill explicitly (`/goat-debug`, `/goat-review`, etc.), route to it immediately - no classification, no GATHER.**

**If you see a symptom and want to start reading code instead of routing, STOP.** The dispatcher classifies and routes; the routed skill investigates.

| Excuse | Reality |
|--------|---------|
| "I can see the issue - routing is overhead" | You are the dispatcher, not the investigator. Route first. |
| "The user said 'just fix it'" | Pragmatic pressure, not a routing override. Route to /goat-debug. |
| "Time pressure means investigate immediately" | Routing takes seconds. Investigating without routing risks the wrong problem. |
| "Multiple symptoms mean I should start reading files" | Multiple intents. Split into numbered intents, route each separately - do not collapse into one. |

## How It Works

1. **UNDERSTAND** - classify intent and target. If multiple intents, number each and route independently. Ask only if ordering matters.
2. **GATHER** - before routing, check:
   - Footgun matches: grep `.goat-flow/learning-loop/footguns/INDEX.md` for the target area; open entries only on hits
   - Ask-first boundaries: scan the active instruction file's Ask First boundaries for the target files
   - If any check fails or is unavailable, note `gather-degraded` and route anyway
3. **ROUTE** - dispatch using the route map. Emit a Route Snapshot:

```
Intent: [classified intent]
Route: [/goat-* or direct]
Rationale: [concrete signals that justified this route]
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

**Ambiguity examples:** "This endpoint is slow" → debug or review? "Check this code" → review or debug? "Look at auth" → security or review?

## Constraints

- MUST respect explicit skill invocations immediately - no reclassification
- MUST NOT inspect source code, read implementation files, or make changes before routing
- MUST understand intent conversationally, not via keyword lookup - 0-2 clarification questions max; route with stated assumption if still ambiguous
- MUST emit a Route Snapshot with every dispatch - Proof Gate applies to route claims
- MUST split multi-intent requests into numbered intents and route each
- MUST pass brief/depth to target skill and preserve context on re-route
