---
category: deny-interpreters
last_reviewed: 2026-11-03
---

Interpreter execution traps in the deny hook: each language's own spellings for running code, which one shared primitive list cannot cover.

Sibling buckets: `deny-shell.md`, `deny-secrets.md`, `deny-writes.md`.

## Footgun: One language-neutral primitive list misses each interpreter's own execution spellings

**Status:** active | **Created:** 2026-09-16 | **Evidence:** ACTUAL_MEASURED
**Severity:** SECURITY
**Decision changed:** The inline interpreter guard keeps its shared dotted-primitive list and adds per-interpreter matching on the program with its string literals removed; the receiver-method and template-literal exemptions belong to JavaScript only.
**Trigger phase:** ACT
**hallucination-risk:** high
**Incident count:** 3 | **Latest occurrence:** 2026-09-18

**Prevention:**
1. When an interpreter gains an inline execution spelling, add it to that interpreter's own case in `test/fixtures/hooks-bash/workflow/hooks/deny-dangerous/patterns-shell.sh` (search: `inline_program_visible_code`) and pair it with a word-in-string control in `test/fixtures/hooks-bash/workflow/hooks/deny-dangerous/deny-dangerous-self-test.sh` (search: `Perl qx brace`); never widen the shared list into a bare identifier ban.
2. Match paren-less calls and `qx`/`%x` delimiters on visible program text. Hide ordinary complete quoted strings, but retain quote-delimited execution operators, unfinished strings and possible executable interpolation. Keep the existing conservative raw process-module scans; printing `child_process` in Node or `subprocess` in Python still denies.
3. Keep one exemption per language, not per token: JavaScript's regex `.exec(` and template literals are ordinary code, while Ruby's `Kernel.exec(` and Perl, Ruby and PHP backticks execute.

**Symptoms:** On 2026-09-14 at `55233485`, Perl `qx` with brace or slash delimiters, paren-less Perl and Ruby `system` and `exec`, Ruby `spawn`, `Kernel.exec`, `Process.spawn` and `Open3`, Python `os.spawnl` and `pty.spawn`, PHP `passthru` and `proc_open`, a Perl pipe-open and `Deno.Command` all exited 0 under `deny-dangerous`, while a quoted `subprocess` word inside a Node expression exited 2.

**Why it happens:** `shell_primitive_re` was one list for six interpreters: it required parentheses, exempted every `.exec(` receiver because JavaScript regexes use that shape, and matched module names anywhere in the command, so Ruby's receiver calls slipped through the JavaScript exemption and a Node string literal tripped Python's module name. The resolved entry in `.goat-flow/learning-loop/footguns/deny-interpreters.md` (search: `Interpreter eval scan matches any identifier ending in the exec word`) records the earlier false positive on the same list.

**Evidence:** `test/fixtures/hooks-bash/workflow/hooks/deny-dangerous/patterns-shell.sh` (search: `inline_program_executes_commands`) holds the shared `shell_primitive_re` list and the per-interpreter cases, and `test/fixtures/hooks-bash/workflow/hooks/deny-dangerous/deny-dangerous-self-test.sh` (search: `Ruby Kernel.exec receiver`) pins each denial beside its allow control; the RED run of that corpus against the pre-fix module failed exactly those nineteen assertions.

**Recurrence 2026-09-17:** A Ruby `system` call denied until an earlier printed apostrophe required adjacent shell-quote fragments; that shape returned 0.
Opposite quotes inside printed strings also hid a later call. Decode the complete shell argument, then track matching string quotes and escapes.
Evidence: `test/fixtures/hooks-bash/workflow/hooks/deny-dangerous/patterns-shell.sh` (search: `inline_interpreter_program`, `inline_program_visible_code`) and
`test/fixtures/hooks-bash/workflow/hooks/deny-dangerous/deny-dangerous-self-test.sh` (search: `Ruby command after shell-concatenated quotes`, `Ruby command between opposite-quote literals`).

**Recurrence 2026-09-18:** `perl -e 'print "qx{id}"'` and Ruby's printed `"%x(id)"` returned 2 because delimiter matching scanned raw program text. Ordinary quote masking allows those data strings; it retains `qx"id"`, `%x"id"` and possible executable interpolation so the repair does not hide commands. Evidence: `test/fixtures/hooks-bash/workflow/hooks/deny-dangerous/patterns-shell.sh` (search: `inline_program_visible_code`) and the corpus (search: `Perl printed qx operator text`, `Ruby percent-x in executable string interpolation`, `Node printed process-module name remains denied`). This bounded scanner is not a complete interpreter lexer.

## Resolved Entries

> Historical record. These entries are no longer active traps.

## Footgun: Interpreter eval scan matches any identifier ending in the exec word

**Status:** resolved | **Created:** 2026-08-22 | **Evidence:** ACTUAL_MEASURED

**Prevention:** Guardrail token lists need an explicit left boundary or a qualified receiver, never a bare substring that can also be a method name. When a rule names a language primitive, add an allow case for the same word as used by the language's own standard library, so identifier context stays covered alongside shell structure. Narrowing either pattern is a security-policy change: re-run the full self-test and confirm the child-process and os-prefixed forms still block. Sibling lesson: `.goat-flow/learning-loop/lessons/hook-testing.md` (search: `deny-dangerous self-test missed a whole false-positive class while green`).

**Symptoms:** A read-only Node `-e` one-liner is denied `Policy destructive: Interpreter -c/-e with shell-execution primitive` for calling `RegExp.prototype.exec`. Measured 2026-08-22: a payload whose only suspicious token is a regex `exec(` call returns status 2 and the identical payload using `test(` returns 0, blocking two benign log-analysis commands while `--self-test=full` stayed green at `executed=481, skipped=0`. This remained reproducible on 2026-09-13 before the correction below.

**Why it happens:** `test/fixtures/hooks-bash/workflow/hooks/deny-dangerous/patterns-shell.sh` (search: `shell_primitive_re`) previously listed `exec` followed by optional whitespace and `(` with no left boundary, so any identifier ending in that word matches. The genuine Node hazard already matches the `child_process` alternative and the Python hazard the `os.`-prefixed alternatives, so the bare entry mostly produces false positives on JavaScript's most common regex idiom.

**Related historical measurement (2026-08-22):** writing Markdown through a quoted heredoc was denied `Policy destructive: Backtick command substitution hides nested execution` because the prose held code spans. Preserve that incident without treating it as current policy: quoted-data coverage now includes `test/fixtures/hooks-bash/workflow/hooks/deny-dangerous/deny-dangerous-self-test.sh` (search: `bounded redactor treats Markdown prose as data`), and the same self-test's `ACCEPTED scope` cases retain the accepted interpreter limits.

**Resolution 2026-09-13:** Inline interpreter checks now distinguish standalone `exec(` from receiver methods such as Node regex `.exec()`, retain qualified shell APIs, and detect literal backticks in Perl/Ruby/PHP eval bodies. JavaScript template literals and the plain word `backtick` remain allowed. The regression corpus in `test/fixtures/hooks-bash/workflow/hooks/deny-dangerous/deny-dangerous-self-test.sh` (search: `Perl eval backticks remain executable inside shell quotes`) classifies these strings without executing their contents. The accepted interpreter heredoc limits above still apply; this repair does not claim general interpreter sandboxing.

- **Deny hook blocks read-only commands with dangerous string literals** (resolved 2026-07-12) - the read-only fast path failed when a quoted repository-policy alternation preceded a real top-level pipe, because `patterns-writes.sh` split raw text on every `|` and treated the second quoted branch as a stage. The shared scanner now preserves quoted, escaped, and substitution-contained data while `split_top_level_pipeline_stages_into` exposes only real stages; coverage in `test/fixtures/hooks-bash/workflow/hooks/deny-dangerous/deny-dangerous-self-test.sh` (search: `single-quoted repository alternation in read-only pipeline`) and `test/unit/audit-command/agent-deny-hooks.test.ts` (search: `allows quoted repository evidence`).
