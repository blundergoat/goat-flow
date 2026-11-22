# ADR-069: A capture row pins the runtime files its own hook loads

**Status:** Accepted
**Date:** 2026-11-11

## Context

Each reviewed Windows or WSL capture row records the SHA256 of all 41 shipped hook runtime files. Until now the captures guard required every row to match every current file, so one changed byte in any file invalidated all 18 rows.

A fix on 2026-11-08 changed only the secret scanner and still forced a recapture of all 18 rows: live sessions with four providers on two hosts, each reviewed twice, spread over three days. Another scanner-only fix followed on 2026-11-11. The scanner is loaded by one hook: `src/cli/server/hooks-registry.ts` (search: `"post-turn/scanner.mjs"`) lists it for `post-turn-safety` alone, and no other runtime entry imports it. Fourteen of the 18 rows observe hooks that never run that file.

## Decision

A verified capture row must match the current bytes of every runtime file its own hook loads. Hashes it records for other files stay as captured.

1. "The files a hook loads" means the hook's registered `scriptFiles`. A row attached to several hooks must match each of them.
2. Every row still records all 41 hashes. Nothing is dropped from a row; only the comparison narrows.
3. The registered list must cover everything a hook loads. Starting from the launcher and the hook's entry script, the guard follows every quoted relative path passed to `import`, `require` or `new URL`, file by file, and requires each file it reaches to be registered.
4. Rows captured on different bytes use their own constant in `src/cli/hook-provider-captures.ts` (search: `RUNTIME_SHA256_WITH_EARLIER_SCANNER`).
5. The guard is `test/integration/hook-provider-captures.test.ts` (search: `recapture the rows whose hook loads a changed runtime file`). Its failure names every stale row at once.

## Failure Mode Comparison

| Option | What fails | Verdict |
| --- | --- | --- |
| Keep the whole-tree rule | Strongest case: a row attests the entire shipped tree, so no reasoning about load paths is needed. Every scanner-only change means recapturing 14 rows whose hooks never run the scanner, and each security fix waits behind them | Rejected |
| Drop runtime hashes from rows | Strongest case: no recapture is ever forced. A row would then say nothing about which bytes it observed | Rejected |
| Pin the files each hook loads | A row no longer attests bytes its hook never ran. A file loaded but missing from the registered list would escape the pin, which the import check in the guard covers for quoted relative paths only | Accepted by the maintainer on 2026-11-11 |

## Consequences

- A scanner-only change recaptures the four Stop rows. A change to a launcher or adapter file still recaptures every row, because every hook loads those files.
- A file loaded through a computed path is not seen by the import check. Such a file must be added to the registered list by hand.
- Support applicability is unchanged: the records still do not match an installed host, provider version or runtime hash at run time.

## Reversibility

Two-way. Restoring the comparison of every recorded hash brings the whole-tree rule back. Rows that keep an earlier scanner hash would then need recapturing.
