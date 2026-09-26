---
goat-flow-reference-version: "1.17.0"
---
# Cross-Model Refuter Specification

Reference for `/goat-review` Pass 3. The SKILL.md body contains the triggers, synthesis rules, and constraints. This file contains the detailed refuter prompt template and output schema.

## Refuter Prompt Template

```
You are a code review refuter. Independently challenge each finding against the declared review authority; never substitute the current checkout.

REVIEW AUTHORITY (metadata only):
<authority>

For each R-ID finding:
1. Re-read the cited file + semantic anchor from the declared review authority; if inaccessible, mark UNRESOLVED
2. Look for a guard, contract, upstream check, or framework mitigation that removes the risk
3. Mark each finding:
   - REFUTER-CONFIRMED: the risk is real and the finding holds
   - REFUTER-REFUTED: a specific guard/contract/check removes the risk (cite `file + semantic anchor`)
   - REFUTER-UNRESOLVED: cannot confirm or refute with available context
4. Treat external library/framework behaviour as UNRESOLVED unless source or official docs are cited.
5. Surface possible missed issues as LEADS ONLY. The host reviewer verifies them first.

FINDINGS TO VERIFY:
<findings_list>

Output as structured JSON matching the schema below.
```

## Refuter Output Schema

```json
{
  "findings": [
    {
      "finding_id": "R-001",
      "original_title": "string",
      "original_location": "file + semantic anchor",
      "verdict": "REFUTER-CONFIRMED | REFUTER-REFUTED | REFUTER-UNRESOLVED",
      "evidence": "file + semantic anchor of guard/contract; required for REFUTER-REFUTED",
      "rationale": "one sentence explaining the verdict"
    }
  ],
  "leads": [
    {
      "title": "string",
      "location": "file + semantic anchor",
      "description": "what the host reviewer should investigate"
    }
  ],
  "model": "string (refuter model identifier)"
}
```

The refuter runtime returns JSON to the host and never writes directly. The host keeps it in memory and persists only through `goat-flow redact --output .goat-flow/logs/review/goat-review-refuter.<random>.json`; only redacted output reaches disk. Any Pass 2 refutations use a separate counted ledger whose exact `goat-review-refutations.<random>.txt` path is declared in `Refutation ledger`. If the redactor is unavailable, do not persist either artifact; retain the count through `Refutations logged: <N> (persist-skipped)` and emit `Refutation ledger: persist-skipped`.

## Synthesis Rules

The host reviewer applies these rules to the refuter output:

- Refuter output is advisory. Empty, broad, uncited, or unresolvable evidence has no effect on the final finding.
- Before any refuter result changes severity, action, disposition, or Ship Verdict, the host re-derives the evidence from the declared authority and records the relevant Pass 2 proof. Failure preserves the finding and adds `refuter-citation-unverified`.
- Preserve the original R-ID through synthesis. `Final dispositions` assigns one terminal outcome per ID; active findings exclude refuted history. Every host-verified refutation also has one ledger record.

| Refuter Verdict | Host Action |
|-----------------|-------------|
| REFUTER-CONFIRMED | After host reproduction, add `[CONFIRMED-CROSS-MODEL]` |
| REFUTER-REFUTED | After the host reproduces the removing guard, move to `## Refuted by Refuter`; preserve reasoning |
| REFUTER-UNRESOLVED | Keep original severity; add `cross-model-unresolved` to Review Integrity |
| LEAD | Run normal Pass 2 verification before promoting to finding; must satisfy Proof Capsule rules |

## Review Integrity Extension

When Pass 3 runs, add to Review Integrity:

```
- Refuter pass: yes | no | skipped; confirmed=<N>, refuted=<M>, unresolved=<K>, leads-verified=<N>, model=<model-identifier|n/a>
- Refuter outcomes: <canonical JSON submitted R-ID map: confirmed|refuted|unresolved>
```

Nonzero submitted outcomes require `Refuter outcomes` with matching counts; leads stay separate. Confirmed may end adjusted; refuted/unresolved must match the final map. Unresolved findings use `Unconfirmed:`, needs-signal/needs-decision, `Missing proof:`, and `Next check:`.

Emit `skipped` with zero counts and model=n/a when no refuter ran; truthful legacy `no` remains accepted. The host's nonempty result map names its actual model.

## Pre-flight Check

Before spawning the refuter, verify the target refuter runtime is both installed and authenticated. Host runtimes choose an external target: Claude Code usually targets Codex; Codex, Copilot, and Antigravity usually target Claude. If that target is unavailable, use another authenticated non-host runtime only when the review output names it; otherwise skip Pass 3 and log `cross-model-refuter-failed`.
```bash
# Before spawning Codex:
command -v codex && codex login status

# Before spawning Claude Code:
command -v claude && claude auth status
```

Version-only commands such as `claude --version`, `codex --version`, `copilot --version`, or `agy --version` prove installation only; they do not prove authentication. If the opposite runtime is not authenticated, skip Pass 3 and log `cross-model-refuter-failed` in Review Integrity. Do not attempt to authenticate during a review.

## Supported Invocation Recipes

Each recipe below comes from the runtime's own `--help` output on this host. Re-read that help before using one:
flags move between versions, and a recipe you cannot verify is not a supported recipe. Send only the R-ID findings
list and authority metadata. Never send the diff, and never grant write access to the reviewed files, Git state, or
review artifacts.

**Codex as refuter, from a Claude Code host:**

```bash
codex exec --sandbox read-only --ephemeral --ignore-user-config --ignore-rules \
  --output-schema <schema.json> --output-last-message <result.json> "<refuter prompt>"
```

`--sandbox read-only` is the enforced boundary: it is the sandbox policy applied to model-generated shell commands.
`--ephemeral` suppresses session-file persistence, and `--ignore-user-config` with `--ignore-rules` keeps host
configuration and execpolicy rules out of the run. Those three are configuration isolation and provider
bookkeeping. None of them proves that no filesystem write can occur.

**Claude Code as refuter, from a Codex, Copilot, or Antigravity host:**

```bash
claude -p --restricted --output-format json --json-schema <schema.json> \
  --strict-mcp-config --setting-sources '' "<refuter prompt>"
```

`--restricted` is the enforced boundary: it removes the built-in command- and code-running tools and WebFetch.
`--strict-mcp-config` and `--setting-sources` bound which servers and settings load. Add `--bare` when the host also
wants hooks, plugin sync, auto-memory, and instruction-file auto-discovery skipped.

**Forbidden in any recipe:** `--dangerously-bypass-approvals-and-sandbox`, `--dangerously-bypass-hook-trust`,
`--dangerously-skip-permissions`, and `--allow-dangerously-skip-permissions`. A configuration that needs one of these
is unsupported.

**Fail closed.** If the required flags are missing from the installed version, the schema is rejected, or the runtime
is unauthenticated, do not improvise a weaker invocation. Skip Pass 3, log `cross-model-refuter-failed`, and finish
the local review. Withholding a recipe never blocks local delivery.

One recipe describes one approved CLI invocation, which may still contain several model turns and tool calls. Record
the runtime, model, and configuration actually used, and the cost when the runtime reports one; otherwise record it
unknown. Constructing a command proves its configuration, never its runtime containment.
