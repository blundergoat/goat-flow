---
goat-flow-reference-version: "1.17.0"
---
# Hook Policy Testing

Use this playbook after changing deny-hook policy, registration, or packaging.
It helps an agent prove dangerous commands stay blocked while ordinary user work
stays available, and checks each enabled policy's central registration.

## Availability Check

From the selected project's root, run the bounded installed-policy check:

```bash
for policy_hook in deny-dangerous deny-git-mutations; do
  test -x ".goat-flow/hooks/$policy_hook.sh" || exit 1
  bash ".goat-flow/hooks/$policy_hook.sh" --self-test=smoke || exit
done
```

Availability is proven only when the command exits `0` and ends with a `PASS`
summary for the requested mode:

```text
PASS: deny-dangerous self-test (mode=smoke, executed=<count>, skipped=<excluded>)
PASS: deny-git-mutations self-test (mode=smoke, executed=<count>, skipped=<excluded>)
```

These illustrative summary shapes are not proof. Record each policy's literal counts and exit status. The shared corpus excludes cases owned by the sibling policy, so non-zero skips are expected; common bootstrap and resolver checks run for both. Reconcile the union against the baseline instead of treating one policy's skipped count as missing coverage.

If the installed hook is absent, stop and repair setup or select the correct
project. Do not substitute the workflow-source hook as proof that a consumer's
installed policy works.

## Intent

`deny-dangerous` protects against destructive shell, secret access and GitHub CLI writes. `deny-git-mutations` protects native Git commit, publication and destructive operations. Both use one parser and policy store. Policy testing proves three separate outcomes:

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
bash .goat-flow/hooks/deny-git-mutations.sh --self-test=full
```

Record the literal summary line and exit status. A failing baseline is an
existing regression, not evidence caused by the proposed change.

### 2. Reproduce the policy grammar

When this step runs inside an agent session, provider Bash settings may match guarded text in the
quoted `--check` operand before this hook starts. A settings-layer denial with no `BLOCKED:` policy
output is not a hook classifier result. Record that denial separately; do not split or reconstruct
guarded text to evade it.

Use the sanctioned self-test for corpus coverage. If an exact one-off shape still needs classification,
first choose a fresh absent path. Write the provider event to a gitignored JSON payload file with a non-Bash
file tool, then pass that file on stdin using a command line that contains only its path. This keeps the
guarded phrase in stdin, not provider-matched command text, so the resulting hook output has a truthful
attribution boundary. Treat the payload as a temporary machine diagnostic, not durable narrative: include
no secrets, retain only the exit and sanitized result, and remove the payload after the probe.

```bash
bash .goat-flow/hooks/deny-dangerous.sh < .goat-flow/scratchpad/payload.json
```

Use `deny-git-mutations.sh` for a native Git payload and `deny-dangerous.sh` for shell, secret or GitHub policy. The redirect leaves the guarded phrase in the file, so the command line stays clear of
provider-matched text. Read the exit and stream against the event shape your provider sends:

| Provider shape | Event key | Expected result |
|---|---|---|
| Claude | `tool_name` | exits `2`, `BLOCKED:` message on stderr |
| Copilot | `toolName` | exits `0`, deny JSON on stdout |
| Antigravity | `toolCall` | exits `0`, deny JSON on stdout |

For each policy behaviour, test a denied shape and a neighbouring allowed
control. This prevents a broad matcher from making ordinary terminal work
unusable. Run the direct forms below where the provider admits the quoted
operand; where it denies first, route the same shapes through the stdin
probe above.

```bash
bash .goat-flow/hooks/deny-git-mutations.sh --check="bash -lc 'git push'"
bash .goat-flow/hooks/deny-git-mutations.sh --check="git status"
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
  bash .goat-flow/hooks/deny-git-mutations.sh --check="$command_shape"
  printf 'exit=%s\n' "$?"
done
```

On 2026-07-14, each shape exited `2` through the then-combined `deny-dangerous.sh` with the result below. The current commands above route those same operands to their native Git owner:

```text
BLOCKED: Policy repository: git push is not allowed. Ask the user to push manually.
```

The exact wrapper matters. For example, a user may ask an agent to inspect a
release script containing `bash -lc`; the recursive command body must still be
classified rather than trusted as inert wrapper text.

### 4. Verify installed policy and available canonical source

The two entrypoints and shared parser/policy modules form one installable runtime unit. Always verify the
installed policy that protects the user's selected project:

```bash
bash .goat-flow/hooks/deny-dangerous.sh --self-test=full
bash .goat-flow/hooks/deny-git-mutations.sh --self-test=full

# Framework maintainers also prove the source that future consumers will install.
if test -f workflow/hooks/deny-dangerous.sh; then
  diff -q workflow/hooks/deny-dangerous.sh .goat-flow/hooks/deny-dangerous.sh
  diff -q workflow/hooks/deny-git-mutations.sh .goat-flow/hooks/deny-git-mutations.sh
  diff -qr workflow/hooks/deny-dangerous .goat-flow/hooks/deny-dangerous
  bash workflow/hooks/deny-dangerous.sh --self-test=full
  bash workflow/hooks/deny-git-mutations.sh --self-test=full
fi
```

In the controlling workspace, either dispatcher resolves policy modules from
the installed `.goat-flow/hooks/deny-dangerous/` store. Therefore dispatcher
parity alone is insufficient: keep the module directories byte-identical and
run both installed full corpora. Before live rollout of a parser change, create a disposable Git root with the complete candidate `.goat-flow/hooks/` store and run both corpora there.

### 5. Verify agent registration

Every enabled policy must have its own installed central registration in each configured supported agent. Confirm current configuration and manifest pointers:

```bash
registration_files=()

# Check only registration files present in the user's selected project.
for registration_file in \
  .claude/settings.json \
  .codex/hooks.json \
  .github/hooks/hooks.json \
  .agents/hooks.json \
  workflow/manifest.json
do
  # A present file can prove that the user's agent loads the central dispatcher.
  if test -f "$registration_file"; then
    registration_files+=("$registration_file")
  fi
done

# No supported file means this project has no registration surface to verify.
if test "${#registration_files[@]}" -eq 0; then
  printf '%s\n' 'No supported agent registration files found.' >&2
  exit 1
fi

# Ripgrep is not installed on every consumer machine; POSIX grep always is.
if command -v rg >/dev/null 2>&1; then
  rg -n --with-filename \
    '\.goat-flow/hooks/deny-(dangerous|git-mutations)\.sh' "${registration_files[@]}"
else
  grep -nHE \
    '\.goat-flow/hooks/deny-(dangerous|git-mutations)\.sh' "${registration_files[@]}"
fi
```

Then run the structural checks that detect packaging or registration drift:

```bash
goat-flow manifest --check
goat-flow audit . --check-drift --format json
```

A green classifier with a missing config pointer does not protect the user's
session. A correct config pointer with stale policy modules protects against
the wrong command set. Both layers must pass.

### 6. Run the bounded managed-hook proof

Use this deeper checkout-specific proof when validating managed hook registration
and classifier behavior. The CLI must be available, and the selected agent must
have both installed policy hooks configured in a trusted checkout.

```bash
goat-flow hooks verify . --agent <id> --scenario deny-hook --trusted-target
goat-flow hooks verify . --agent <id> --scenario git-mutations-hook --trusted-target
goat-flow hooks verify . --agent <id> --scenario all --trusted-target
```

Both policy groups send fixed provider-shaped inputs through the exact configured handler; command operands are classified, never executed. `deny-hook` checks secret reads, pipe-to-shell, GitHub writes and a read-only control. `git-mutations-hook` checks commit, push, destructive Git and a read-only control. `all` runs thirteen scenarios: four dangerous, four Git, three Gruff and two post-turn.
A proven run exits `0`, reports `pass` for every selected scenario, and records one
local `hook.verify` event per scenario. `fail`, `unsupported`, `not-configured`,
`error`, a wrong total, or a missing evidence event means the requested proof is incomplete.

The selected checkout's hook code runs only with `--trusted-target`. Omit that
flag until you have inspected and trust the checkout; the CLI then returns
explicit `unsupported` results without starting the hook, so the safe default
is not classifier proof. The deprecated `--untrusted-target` flag remains an
explicit static alias throughout v1.16.x.

These commands prove only the selected checkout's managed scripts, registration
state, and fixed scenario decisions. They do not launch the external coding agent
and do not prove provider-side hook delivery. Never cite them as external-agent
delivery evidence.

A policy proof belongs to its exact hook and current complete runtime. Old combined-hook proof cannot close the Git gate. Repairing shared bytes can invalidate both policy proofs; re-run both groups after repair. Confirm independent enabled choices and registrations, all refreshed Hooks rows, and audit-cache invalidation when testing a toggle or shared-file change.

## Verification Gate

After any hook-policy or registration change, require all of the following:

- both installed smoke suites pass;
- installed full suites pass; framework maintainers also run workflow-source suites;
- every new deny case has a nearby allow control;
- both entrypoint and shared-runtime mirrors are identical;
- configured agents register each enabled policy separately;
- any requested managed-hook proof reports its selected scenario total and recorded events;
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
