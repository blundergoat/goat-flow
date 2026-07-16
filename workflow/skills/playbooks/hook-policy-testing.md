---
goat-flow-reference-version: "1.14.0"
---
# Hook Policy Testing

Use this playbook after changing deny-hook policy, registration, or packaging.
It helps an agent prove dangerous commands stay blocked while ordinary user work
stays available, and confirms every supported agent loads the central hook.

## Availability Check

From the selected project's root, run the bounded installed-policy check:

```bash
test -x .goat-flow/hooks/deny-dangerous.sh &&
  bash .goat-flow/hooks/deny-dangerous.sh --self-test=smoke
```

Availability is proven only when the command exits `0` and ends with a line like:

```text
PASS: deny-dangerous self-test (mode=smoke, executed=32, skipped=0)
```

If the installed hook is absent, stop and repair setup or select the correct
project. Do not substitute the workflow-source hook as proof that a consumer's
installed policy works.

## Intent

The deny hook protects users from destructive shell, secret access, and
repository writes. Policy testing proves three separate outcomes:

1. dangerous command grammar is denied;
2. a nearby harmless control remains allowed;
3. canonical policy, installed policy, and agent registration still agree.

The smoke suite is an availability check. The full suite is the release and
policy-change gate.

## Boundary

This playbook owns policy verification, mirror checks, and registration checks.
It does not teach regex design, invent new deny categories, or authorize an
agent to run a blocked command. In particular, coding agents never commit or
push; the user performs repository publication actions.

Use `--check='<command>'` only as classifier input. It asks the hook how it would
classify text and does not execute that command.

## Policy-Test Workflow

### 1. Establish the installed baseline

Run the Availability Check before editing. Then run the complete corpus:

```bash
bash .goat-flow/hooks/deny-dangerous.sh --self-test=full
```

Record the literal summary line and exit status. A failing baseline is an
existing regression, not evidence caused by the proposed change.

### 2. Reproduce the policy grammar

For each policy behaviour, test a denied shape and a neighbouring allowed
control. This prevents a broad matcher from making ordinary terminal work
unusable.

```bash
bash .goat-flow/hooks/deny-dangerous.sh --check="bash -lc 'git push'"
bash .goat-flow/hooks/deny-dangerous.sh --check="git status"
```

Expected results:

- the push shape exits `2` with a `BLOCKED: Policy repository:` message;
- `git status` exits `0` with no denial message.

Add both cases to the central self-test when a policy edit introduces new
grammar. A deny-only test proves blocking but misses false positives; an
allow-only test proves usability but misses bypasses.

### 3. Run wrapper and compound-command shapes

These measured push shapes must all remain denied:

```bash
# Each wrapper represents a measured path a user's request could take to the hook.
for command_shape in \
  "bash -lc 'git push'" \
  "env -i git push" \
  "if true; then git push; fi" \
  'f(){ git push; }; f'
do
  bash .goat-flow/hooks/deny-dangerous.sh --check="$command_shape"
  printf 'exit=%s\n' "$?"
done
```

On 2026-07-14, each shape exited `2` with:

```text
BLOCKED: Policy repository: git push is not allowed. Ask the user to push manually.
```

The exact wrapper matters. For example, a user may ask an agent to inspect a
release script containing `bash -lc`; the recursive command body must still be
classified rather than trusted as inert wrapper text.

### 4. Verify installed policy and available canonical source

The dispatcher and its policy modules are one runtime unit. Always verify the
installed policy that protects the user's selected project:

```bash
bash .goat-flow/hooks/deny-dangerous.sh --self-test=full

# Framework maintainers also prove the source that future consumers will install.
if test -f workflow/hooks/deny-dangerous.sh; then
  diff -q workflow/hooks/deny-dangerous.sh .goat-flow/hooks/deny-dangerous.sh
  diff -qr workflow/hooks/deny-dangerous .goat-flow/hooks/deny-dangerous
  bash workflow/hooks/deny-dangerous.sh --self-test=full
fi
```

In the controlling workspace, either dispatcher resolves policy modules from
the installed `.goat-flow/hooks/deny-dangerous/` store. Therefore dispatcher
parity alone is insufficient: keep the module directories byte-identical and
run the installed full corpus.

### 5. Verify agent registration

Every supported agent must call the installed central dispatcher rather than a
private copy. Confirm current configuration and manifest pointers:

```bash
rg -n '\.goat-flow/hooks/deny-dangerous\.sh' \
  .claude/settings.json .codex/hooks.json .github/hooks/hooks.json \
  workflow/manifest.json
```

Then run the structural checks that detect packaging or registration drift:

```bash
goat-flow manifest --check
goat-flow audit . --check-drift --format json
```

A green classifier with a missing config pointer does not protect the user's
session. A correct config pointer with stale policy modules protects against
the wrong command set. Both layers must pass.

## Verification Gate

After any hook-policy or registration change, require all of the following:

- installed smoke suite passes;
- installed and workflow full suites pass;
- every new deny case has a nearby allow control;
- dispatcher and policy-module mirrors are identical;
- supported agent configs point to the installed central dispatcher;
- manifest, drift audit, shell syntax, and ShellCheck pass;
- the original bypass or false-positive reproduction now has the intended exit.

Do not claim a fix from the suite alone. Re-run the exact command shape that
demonstrated the failure and report its literal output.

## Troubleshooting

| Symptom | User-visible meaning | Action |
|---|---|---|
| Availability Check exits `1` before the self-test | The selected project has no executable installed hook | Confirm the project root, then repair installation rather than testing workflow source |
| Exit `126` or `127` | The hook or required shell cannot start | Check executable state and `bash` availability; do not treat this as a policy verdict |
| `Policy hook unavailable` names a missing module | The dispatcher exists but its central policy store is incomplete | Compare both policy-module directories and repair packaging |
| Denied case exits `0` | A dangerous grammar shape bypasses the classifier | Preserve the exact shape, add paired RED coverage, and stop release verification |
| Allowed control exits non-zero | The matcher blocks ordinary user work | Preserve the control, narrow the policy under a separately approved change, and rerun the full corpus |
| Source passes but installed hook fails | Users received stale or incomplete policy | Reconcile source/install mirrors and rerun consumer installation checks |

## Related References

- [`skill-playbook-authoring-sync.md`](./skill-playbook-authoring-sync.md) - use when changing this shipped playbook's source/install contract.
