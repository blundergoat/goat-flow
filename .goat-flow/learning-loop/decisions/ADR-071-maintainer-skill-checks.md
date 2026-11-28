# ADR-071: Run saved skill checks from a maintainer's native session

**Date:** 2026-11-28
**Status:** Accepted

## Context

In the M03 planning-intake trials, a critique sub-agent sometimes spawned critics instead of handing control to its host. The two failing transcripts each recorded three Agent calls. After the host-ownership rule changed, three independent samples handed control back with zero Agent calls. The M03 milestone records the trials under `C1 after the host-ownership fix` in `evidence/M03-trials-20261127T2315Z/run-critique-4-score.md` within the local 1.20.0 plan.

## Decision

Keep saved, synthetic skill cases in the repository's `evals/` directory. A maintainer launches one native sub-agent per sample in Codex or Claude and collects its transcript through the kit. Run three independent samples per live case and require three mechanical passes. The run records the harness and hashes the owner copies. Keep generated evidence under gitignored `.goat-flow/logs/evals/`.

The maintainer invokes live checks on demand after editing a skill or before a release. CI, preflight and the ordinary test command run only deterministic tests. This preserves the deterministic audit contract in [ADR-013](ADR-013-remove-scanner-system.md) and uses native delegation under [ADR-042](ADR-042-cross-harness-invocation-ask-first.md).

## Consequences

The scorer uses tool calls and fixture state for observable actions. Maintainers can inspect judgement rows alongside the mechanical rate. Three passes are evidence for the tested fixture, owner bytes and selected runtime. Each live pass consumes maintainer time and model usage.

## Reversibility

The kit is local maintainer tooling. Its files and tool configuration can be reverted independently of the skills, audit and installation workflow.
