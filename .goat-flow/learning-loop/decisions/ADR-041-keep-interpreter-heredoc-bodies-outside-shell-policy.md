# ADR-041: Keep interpreter heredoc bodies outside shell policy

**Status:** Accepted
**Date:** 2026-07-12

## Context

The deny-dangerous hook parses shell command structure and masks quoted heredoc bodies when every opener command is an allowlisted non-shell consumer. This prevents ordinary multi-line reports, SQL migrations, and interpreter scripts from inflating the shell chain-count limit or matching destructive shell text that is data in that context.

Allowlisted interpreters and clients still execute their bodies as their own languages. Python can call `os.system`, sed can execute `e`, awk can call `system()`, and database clients can expose shell escapes. The 2026-06-06 heredoc hardening explicitly recorded this as an accepted scope limit after review: inspecting those bodies would require language-aware policy and would recreate false positives on legitimate long scripts and migrations. The central self-test makes the boundary executable at `.goat-flow/hooks/deny-dangerous/deny-dangerous-self-test.sh` (search: `ACCEPTED SCOPE LIMIT`), and the measured history lives in `.goat-flow/learning-loop/footguns/deny-dangerous.md` (search: `ACCEPTED SCOPE LIMIT`).

## Decision

Keep allowlisted interpreter and client heredoc bodies outside the deny-dangerous shell policy. The hook guards shell command syntax; it does not claim to sandbox arbitrary Python, sed, awk, SQL-client, or other interpreter-language semantics.

Shell-fed heredocs, unknown consumers, dispatchers, process substitutions that route into shells, and commands after heredoc delimiters remain inspectable. Inline interpreter flags such as `python -c` or `ruby -e` may continue to receive targeted checks where the shell command exposes a compact execution primitive; that does not expand the hook into a general interpreter sandbox.

This is an accepted residual risk, not evidence that interpreter heredocs are safe. The controlling instruction's prohibition on destructive actions remains the primary behavioral rule; the hook is defense in depth with a declared boundary.

## Failure Mode Comparison

| Option | What fails | Why rejected or accepted |
| --- | --- | --- |
| Inspect every heredoc body as shell | Legitimate interpreter scripts and migrations false-positive on language text that is not shell syntax | Rejected |
| Add language-aware parsing for every allowlisted consumer | Creates a multi-language policy engine with incomplete coverage and high maintenance risk | Rejected for the shared hook |
| Keep the conservative shell/data boundary and document the residual risk | Some interpreter-native shell escapes remain outside enforcement, but the hook's claim stays precise and ordinary scripts remain usable | Accepted |

## Consequences

- Existing `expect_allow` cases under `ACCEPTED SCOPE LIMIT` remain intentional regression tests.
- Quality reports should describe this as an accepted policy boundary, not an accidental parser bypass.
- Hook and footgun documentation must link to this ADR when explaining interpreter heredoc behavior.
- A future proposal to inspect interpreter bodies must include real false-positive fixtures, a supported-language scope, runtime-cost evidence, and a replacement ADR before changing the gate.

## Reversibility

This is a two-way policy decision, but not a local regex tweak. Revisit it only with a dedicated security design that defines supported languages, proves acceptable false-positive and runtime costs, updates the footgun and self-test corpus, and supersedes this ADR.
