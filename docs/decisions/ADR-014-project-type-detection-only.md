# ADR-014: Project Type Modes -- Detection Only, No Rubric Split

**Date:** 2026-03-28
**Status:** Accepted

## Context

The framework applies identical rubrics and setup guidance to all project types: libraries (sus-form-detector), applications (rampart), test frameworks (halaxy-cypress), monoliths (healthkit), script collections (devgoat-bash-scripts), and LLM-integrated projects (halaxy-agents-lab). Six of 8 cross-project reviewers flagged this as a gap.

Reviewer proposals ranged from type-specific rubric weights to entirely different skill sets per project type. However, splitting the rubric creates maintenance burden (N rubric variants instead of 1) and edge cases (what is a library that also has an LLM integration?). The 97 rubric checks are already universal by design — they test framework adoption, not project-specific concerns.

## Decision

Add project type **detection** to the scanner (M03.3) but do NOT split the rubric.

Implementation:
1. Scanner reports the detected project type in its output (library, application, test-framework, monolith, script-collection, llm-integrated)
2. Setup prompt uses the detected type to modulate guidance — for example, test projects get a different goat-security threat model, script collections get reduced goat-plan ceremony
3. The rubric stays universal: the same 97 checks apply to all project types
4. Projects that don't fit a recognized type get the default (application) guidance

Type-specific adaptation happens in the setup prompt's guidance, not in the scoring rubric.

## Consequences

- M03.3 adds project type detection as a scanner output field
- Setup prompt adapts its guidance per detected type — this is a content change, not a structural one
- Rubric remains a single universal set; no variant maintenance needed
- Detection heuristics must be documented (e.g., test framework = has cypress/jest/pytest config + no src/)
- If a project type needs fundamentally different checks in the future, that requires a new ADR
