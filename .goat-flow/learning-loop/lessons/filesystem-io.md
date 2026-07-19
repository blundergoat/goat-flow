---
category: filesystem-io
last_reviewed: 2026-07-19
---

## Lesson: UTF-8 punctuation sweeps need post-replacement grep

**Status:** active | **Created:** 2026-05-23

**What happened:** During a repo-wide em-dash-to-hyphen replacement, the first command exited zero but changed nothing because Perl's default byte-mode input did not match the Unicode codepoint pattern.

**Root cause:** I treated a successful bulk-rewrite command as evidence that a UTF-8 character replacement happened before checking the target character again.

**Prevention:** After any repo-wide Unicode punctuation rewrite, immediately run the exact target-character grep across tracked files. If using Perl in byte mode, match UTF-8 bytes such as `\xE2\x80\x94` for em dash, or use an explicitly UTF-8-aware command. Evidence anchors: original no-op command (search: `s/\x{2014}/-/g`), verification grep (search: `git ls-files -z | xargs -0 rg -n $'\u2014'`), corrected byte replacement (search: `s/\xE2\x80\x94/-/g`).

---

## Lesson: Non-fatal filesystem tests should assert behavior before errno text

**Status:** active | **Created:** 2026-05-17

**What happened:** While adding M08 evidence-envelope tests, the first focused run failed because the non-fatal append-failure test expected `ENOTDIR` or "not a directory". The actual Node error for a file blocking `mkdirSync(..., { recursive: true })` was `EEXIST: file already exists`. The production behavior was correct: `appendEvidenceEnvelope()` returned `{ ok: false }` and emitted a warning without throwing, but the assertion overfit one possible filesystem errno.

**Root cause:** I asserted incidental OS/Node error text instead of the behavioral contract. For non-fatal IO paths, the important proof is that the caller receives a failure result and the operation does not throw; errno strings vary with which path segment blocks directory creation.

**Prevention:** For defensive filesystem tests, assert the stable contract first (`ok === false`, warning emitted, no throw) and keep errno matching broad enough for equivalent failure modes such as `EEXIST`, `ENOTDIR`, or "not a directory". Evidence anchors: `test/unit/evidence-envelope.test.ts` (search: `keeps append failures non-fatal`), `src/cli/evidence/envelope.ts` (search: `appendEvidenceEnvelope`).

---

## Lesson: Overloaded Node filesystem helpers need concrete wrapper return types

**Status:** active | **Created:** 2026-07-19
**Decision changed:** When a wrapper narrows an overloaded Node filesystem API to one runtime shape, declare that concrete result instead of deriving the union with `ReturnType`.
**Trigger phase:** VERIFY

**What happened:** M10 wrapped `lstatSync` as `ReturnType<typeof lstatSync> | null`. The first `npm run typecheck` reported the returned stats as possibly `undefined` because Node's overload set includes the `throwIfNoEntry: false` result, even though the wrapper never calls that overload.

**Root cause:** `ReturnType` reflected the overloaded declaration surface instead of the wrapper's stronger contract: return concrete `Stats`, return `null` for `ENOENT`, and throw for every other inspection failure.

**Prevention:** Type filesystem wrappers from the behavior they expose (`Stats | null` here), then run typecheck before treating runtime tests as proof. Evidence: `src/cli/skill-author.ts` (search: `function lstatIfPresent`) and `src/cli/skill-author.ts` (search: `type Stats`).
