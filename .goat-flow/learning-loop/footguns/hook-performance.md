---
category: hook-performance
last_reviewed: 2026-10-03
---

**Scope:** Hook execution cost: process creation on Windows Git Bash, shared policy parsing work, and the context cost of policy denials. Runtime delivery, provider adapters, Stop recovery, and policy-module correctness live in [hooks.md](hooks.md); install, launch, registration, and config-drift plumbing in [hook-installation.md](hook-installation.md).

## Footgun: Per-item subprocess spawning in hooks is ~40x more expensive on Windows Git Bash

**Status:** active | **Created:** 2026-08-01 | **Evidence:** ACTUAL_MEASURED
**Decision changed:** Whether a hook may call out to `sed`/`tr`/`awk`/`grep`/`git` once per line, per key, or per file - on Windows that design cannot meet any realistic hook timeout, so batch or use bash builtins instead.
**Trigger phase:** SCOPE
**Caught at:** ACT

**Prevention:**
1. Keep per-line and per-key hook work in bash builtins: `${var,,}` instead of `tr`, `${var##+([[:space:]])}` instead of a trim `sed`, `[[ =~ ]]` capture instead of `sed -nE 's/.../\1/p'`, and return through a global rather than `$(...)` so the call does not fork.
2. Batch git plumbing: one `git diff --unified=0 -- <paths>` with `+++ b/<path>` header attribution replaces one diff per file, `git cat-file --batch-check` replaces per-path `cat-file -s`, and `wc -c` and `grep -Il` accept many paths per call, chunked at about 64 paths for the Windows command-line limit.
3. Put a cheap superset pre-filter in front of expensive per-line analysis and document why each pattern is a provable superset so the filter cannot silently narrow detection.
4. Benchmark hooks on Windows Git Bash, not only Linux, and give any bounded-time hook its own wall-clock budget that reports an explicit incomplete-scan message with a non-zero exit under a runner timeout above that budget, so silent truncation is unreachable.

**Symptoms:** A hook that is fast on Linux is unusable on Windows Git Bash, with `sys` time near half of wall clock and Claude Code parked on `running stop hook · 4m 40s`. Because the runner kills a hook past its timeout, a scan that cannot finish reports nothing and is indistinguishable from a clean pass.

**Why it happens:** MSYS2 and Cygwin have no `fork()`; process creation is emulated, so every subshell or external command costs orders of magnitude more than on Linux, and `$(...)` counts even with no external binary. This does not generalise: removing forks from `deny-dangerous.sh` the same day made it slower, as the next entry records.

**Evidence:** Measured 2026-08-01 on Windows 11 Pro 10.0.26200, Git Bash bash 5.3.15, NTFS: one forked pipeline costs about 44ms (200 pipelines = 8.852s) while 20,000 pure-bash loop iterations cost 0.151s, so one fork is worth roughly 2,900 bash operations. On the same workload (25 changed, 22 staged, 375 added lines across 10 env-assignment files, zero findings) the per-line `post-turn-safety.sh` ran 4m22.109s on Windows and 6.465s on Linux WSL2; the batched rewrite runs 0.655s and 0.027s. The pre-fix hot path spawned two `sed` per scanned line plus per-call helpers and one `git diff` per changed path. Current anchors: `workflow/hooks/post-turn-safety.sh` (search: `run_diff_batch`), (search: `gate_scannable_files`), and (search: `scan_content_files`).

## Footgun: Policy modules must share one prepared command context

**Status:** active | **Created:** 2026-08-01 | **Evidence:** ACTUAL_MEASURED
**Decision changed:** Whether each PreToolUse policy module may prepare its own segment context - it may not; preparation belongs to the dispatcher and adding a policy must not multiply parsing work.
**Trigger phase:** SCOPE
**Caught at:** ACT

**Prevention:**
1. Prepare segment context once in `check_segment`; policy modules consume the shared `CMD_*` and `HAS_*` values and never call `prepare_segment_context` themselves.
2. Measure with an interleaved A/B, alternating old and new per round. A sequential run pays cold filesystem and git cache costs first, which produced a false 2x "improvement" for a build that was actually 2x slower, and a `$( )` count does not predict wall clock.
3. This is security-critical parsing: any restructuring needs `--self-test=full` green plus a byte-exact verdict corpus before and after, per `.goat-flow/skill-docs/playbooks/hook-policy-testing.md`.

**Symptoms:** Every Bash tool call carries a visible pause that scales with command complexity and the number of policy modules, and a `bash -x` trace shows more than one `prepare_segment_context` call for a simple command.

**Why it happens:** When policy checks independently call `prepare_segment_context`, the shared tokenisers (`split_shell_words_into`, `normalize_command_candidate`, `normalize_leading_command_word`) walk the same command once per policy. The dominant term is not established: converting the hot tokenisers to fork-free `_into` forms plus memoization made the hook slower, 272 to 392ms simple and 309 to 729ms pipeline, while executing about 3.3x more traced operations with identical verdicts, and was reverted without the cause being identified. Do not repeat that attempt without new evidence.

**Evidence:** 2026-08-01, Windows 11 Git Bash, interleaved A/B, 30 invocations per cell: 272ms per call for `--check='npm run typecheck'`, 309ms for a four-stage pipeline, 652ms for the JSON-stdin path, against about 50ms for a bare `bash empty.sh`; only 6 external processes per invocation against about 1,959 traced bash operations for a simple command. 2026-08-04 Linux interleaved A/B: hoisting preparation from three policy calls to one moved the simple-command median from 39.08ms to 30.99ms and the pipeline median from 102.62ms to 93.12ms, with a 15-case byte-exact verdict comparison at 0 mismatches and both corpora at 327/327. Anchor: `workflow/hooks/deny-dangerous/guard-runtime.sh` (search: `Parse once per segment`).

## Footgun: Claude policy denials echo the whole launcher command into agent context

**Status:** active | **Created:** 2026-09-23 | **Evidence:** ACTUAL_MEASURED
**Severity:** PERFORMANCE
**Decision changed:** Count each Claude policy denial as roughly 1.5K tokens of context, and keep Claude policy rows on exit-2 denials until a JSON deny is proven to block on malformed output.
**Trigger phase:** ACT
**Incident count:** 2 | **Latest occurrence:** 2026-09-23

**Prevention:**
1. When probing policy shapes the hook will deny, keep them out of Bash command text: write the payload to a file and pass it on stdin, as `.goat-flow/skill-docs/playbooks/hook-policy-testing.md` (search: `Write the provider event to a gitignored JSON payload file`) describes, and keep chained commands under the 50-segment cap.
2. Claude policy rows use exit `2` with a stderr reason. The launcher now converts unexpected nonzero child exits to a denial; a child reporting success still means allow. A JSON `permissionDecision` of `deny` on exit `0` would return only the reason, but missing or malformed JSON could then read as an allow. Before switching the response mode, capture a live denial and prove malformed output still blocks.

**Symptoms:** Claude Code reports an exit-2 denial as `PreToolUse:Bash hook error: [<command> <args>]: <stderr>`. Both PreToolUse rows in `.claude/settings.json` pass a 6,190-character inline bootstrap as `args[1]`, so each denial puts the whole bootstrap ahead of the one-line `BLOCKED:` reason. The two 2026-09-23 quality assessments hit it four times: a pipe-to-shell probe in the first, then a pipe-to-shell probe, a 50-segment chain and a scratch truncation in the second.

**Why it happens:** ADR-053 moved Claude registrations to exec-form `args` so no shell retokenizes the bootstrap, and its failure-mode comparison weighs transport only. The echo format for exit-2 denials is not in Claude Code's hooks documentation, which states only that a JSON deny feeds `permissionDecisionReason` back to Claude.

**Evidence:** `src/cli/server/agent-hook-command.ts` (search: `structuredHookLaunchBootstrap`), `workflow/hooks/deny-dangerous/guard-runtime.sh` (search: `BLOCKED: Policy %s`), and the unused Claude deny shape in `workflow/hooks/hook-provider-adapters.mjs` (search: `Claude and Codex share the current hookSpecificOutput permission shape`).
