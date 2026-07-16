---
name: goat
description: "Use when you describe an outcome and need the right goat-* workflow chosen for you."
goat-flow-skill-version: "1.14.0"
---
# /goat

## Shared Conventions

Read `.goat-flow/skill-docs/skill-preamble.md` for shared conventions.

## Boundary Commands

- **NEVER:** Investigate or implement before routing.
- **ALWAYS:** Honor explicit invocations; otherwise split intents and emit Route Snapshots.
- **DEFER TO:** Routed skills, direct execution for simple changes, or direct answers.

**If a symptom tempts code reading, STOP.** The dispatcher routes; the routed skill investigates.

| Excuse | Reality |
|--------|---------|
| "I can see it - routing is overhead" | Route before investigation. |
| "The user said 'just fix it'" | Route to /goat-debug. |

## How It Works

0. **EXPLICIT PASS-THROUGH** - named goat-* invocation: dispatch immediately with the remaining text as its brief; skip UNDERSTAND, GATHER, and reclassification. The target skill owns Step 0.
1. **UNDERSTAND (inferred only)** - classify intent; split multiple intents; ask only if order matters.
2. **GATHER (inferred routing only)** - before routing, check:
   - Footgun matches: grep `.goat-flow/learning-loop/footguns/INDEX.md` for the target area; open entries only on hits
   - Ask-first boundaries: scan the active instruction file's Ask First boundaries for named files; if none are named, record `target-files=unknown`
   - If any check fails or is unavailable, note `gather-degraded` and route anyway
   - Do not emit the preamble's `Relevant prior learnings` line - that belongs to the routed skill's Step 0
3. **ROUTE (inferred only)** - dispatch using the map. Emit a Route Snapshot:

```
Intent: <classified user intent>
Route: </goat-* skill or direct path>
Rationale: <verified routing rule and boundary state>
```

## Route Map

| Intent | Route |
|--------|-------|
| Bug, failure, unexpected behaviour | `/goat-debug` |
| Verify a fix worked | `/goat-debug` (post-fix verification) |
| Browser-visible issue | Browser evidence first; `/goat-debug` Investigate if diagnosis needed |
| Understand, explain, explore unfamiliar code | `/goat-debug` (Investigate mode) |
| GOAT Flow setup/process/harness/skills quality assessment | `goat-flow quality` CLI/dashboard prompt flow (no goat skill wrapper) |
| Code quality review, area audit, diff check | `/goat-review` |
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

**Evidence:** `.goat-flow/learning-loop/lessons/review-feedback.md` (search: `Blindly applying review feedback without verifying findings`) records `/goat-review` routing; explicit calls skip GATHER.

## Constraints

- MUST respect explicit skill invocations immediately - no reclassification
- MUST NOT inspect source code, read implementation files, or make changes before routing
- MUST understand intent conversationally, not via keyword lookup - 0-2 clarification questions max; route with stated assumption if still ambiguous
- MUST emit a Route Snapshot for every inferred dispatch - Proof Gate applies to route claims
- MUST split multi-intent requests into numbered intents and route each
- MUST pass brief/depth to target skill and preserve context on re-route
