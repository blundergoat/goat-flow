---
name: goat-debug-diagnostic-techniques
description: "Progressive ranking, causal, reduction-method, mutation-safety, and report guidance for goat-debug diagnosis and existing-fix verification."
goat-flow-reference-version: "1.17.0"
---
# Diagnostic Techniques

Load this reference only when the root skill routes here. The root owns mode selection, approval gates, mandatory causal confidence, and output. This file expands conditional techniques; it never authorizes a mutation.

## Existing-Fix Verification Report

Use this report when verifying an already-applied change. Read the change and relevant state before execution; the root's D4 cleanup and original-case proof rules govern closure. Supplied historical proof is context, never a fresh result. Verification permission does not authorize another patch.

Report these fields using actual evidence:

- **Change and tested state:** file + semantic anchor, relevant environment, source and configuration state.
- **Original steps:** preserve the original input, sequence, and expected result; never silently replace them with a reduced case.
- **Expected versus observed:** exact command/steps, literal output and exit status, or the missing execution evidence.
- **Approved cleanup:** markers checked before decisive proof; any unfinished cleanup blocks closure.
- **Retained user diagnostics:** identify pre-existing diagnostics preserved in the tested state.
- **Adjacent checks:** actual checks at the changed causal boundary and their literal results; name omitted checks and why.
- **Proof class and limits:** use the preamble's proof classification; a passing symptom check does not establish root cause.
- **Human-pending checks and owners:** name each check and responsible person/role; use UNVERIFIED for missing/unsafe proof and HUMAN-PENDING for human-owned execution.

If the original symptom remains, report failed verification and return to D1 without new patch authority. Do not borrow hypothesis counts, minimisation, causal confidence, or Debug Integrity from a diagnosis that did not occur.

## Hypothesis Ranking Matrix

Apply the root's likelihood/cost ranking before expensive tracing, reduction, or experiments; this matrix expands that rule.

| Likelihood \ Cost | LOW cost | MEDIUM cost | HIGH cost |
|---|---|---|---|
| **HIGH** likelihood | 1st | 2nd | 3rd |
| **MEDIUM** likelihood | 2nd | 3rd | 4th |
| **LOW** likelihood | 3rd | 4th | Skip |

## Distinguish Symptom from Cause

Keep three questions separate:

1. **Symptom:** Did the reported behaviour occur under the stated conditions?
2. **Mechanism:** What traced path connects the candidate defect to that exact behaviour?
3. **Distinguishing proof:** Does changing only the candidate factor change the symptom as predicted, or does deterministic contract evidence entail it?

A reproduced symptom can support the first question while two causes remain unresolved. Eliminating alternatives by absence alone is not confirmation. When an intervention would be unsafe or human-owned, deterministic proof that entails the symptom can still satisfy HIGH; downgrade to MEDIUM only when no sufficient distinguishing proof is available, and name the missing proof.

For each surviving hypothesis, prefer one short experiment statement:

```text
Prediction: <distinguishing observation if true>
Falsifier: <observation that eliminates or materially narrows it>
Action: <cheapest safe check>
Literal result: <command output, trace, or human-pending check>
Disposition: CONFIRMED | ADJUSTED | ELIMINATED | UNRESOLVED
```

Use `ADJUSTED` when evidence supports part of an explanation but exposes a missing co-factor. Do not force partial evidence into CONFIRMED or ELIMINATED.

## Diagnostic Mutation Classes

Repository instructions and the user's current-session authority always win.

| Class | Examples | Required handling |
|---|---|---|
| Read-only observation | file reads, searches, existing logs, status | Proceed within repository rules; record literal evidence. |
| Safe local execution | focused reproducer or test against disposable state | Disclose target-controlled execution (running the target's own code or configuration) when local policy requires it. |
| Temporary instrumentation | logs, assertions, trace flags, config toggles | Before editing, name target, signal, affected state, approval, rollback, marker, and cleanup check. |
| State-mutating local | database write, queue consumption, restart, generated state | Require explicit approval, pre-state evidence, bounded target, rollback, and post-state verification. |
| Network, production, or sensitive | external call, production action, sensitive-data access | Apply the governing stricter gate; default to proposal or human-owned execution when authority is unclear. |

Never persist secret values, raw credentials, or unsanitised sensitive payloads. An approved diagnostic mutation is evidence gathering, not the permanent fix. Track its marker until targeted search and final-diff inspection prove cleanup. Never remove a diagnostic that pre-dated the investigation without the owner's permission.

## Choose Reduction by Failure Shape

Choose the reduction method that preserves the property required for the failure.

| Failure shape | Proportional method |
|---|---|
| Deterministic unordered input | Partition or delete inputs while rerunning the same reproduction. |
| Ordered or stateful sequence | Remove actions while preserving required order and state transitions. |
| Interacting conditions | Test combinations; removing either condition alone does not prove independence. |
| Intermittent or timing | Repeat under the same context and compare failing with passing evidence. |
| Performance threshold | Preserve the triggering workload; use a comparable environment and repeated measurements. |
| Environment-only | Compare the load-bearing runtime, dependency, permission, configuration, and resource differences. |
| Unsafe or production-only | Do not force local reduction; use sanitised captured evidence or a human-owned check. |

A single passing run cannot eliminate an intermittent hypothesis. Record runs and failures only when intermittency is decision-relevant; do not impose a universal trial count or failure-rate threshold. For performance, shrinking below the triggering threshold is not successful reduction. For unsafe cases, state the limitation rather than simulating certainty.

## Worked D1-D4 Shape

**Illustrative scenario - input/output shape only; never evidence.** Replace every path, result, input, and semantic anchor with current target-project evidence.

Scenario: page two of a list repeats the final row from page one when cursor pagination is enabled.

- **D1 scope:** the failing boundary is page-one cursor output to page-two query input. Read the route, cursor encoder, and query builder; record the active pagination configuration.
- **Competing hypotheses:**

| Hypothesis | Category | Prediction and safe check |
|---|---|---|
| The query uses an inclusive comparison at the cursor boundary. | Logic | The page-two query includes the cursor row; inspect the query anchor and run the existing focused reproducer. |
| Cursor decoding loses the tie-break key. | Data | Duplicate sort keys reproduce only when the secondary key is absent; compare decoded input with the emitted cursor. |
| Offset mode still overrides cursor mode. | Configuration | The traced configuration selects the offset branch; inspect precedence before changing any flag. |

- **D1.5:** preserve the original two-page case and expected result before reducing; keep both cases. Reduce while preserving the duplicate sort key and page transition. Do not remove an interacting key merely to obtain a smaller non-failing case.
- **D2:** a reproduced duplicate proves the symptom, not which hypothesis caused it. HIGH requires the traced inclusive comparison plus a safe counterfactual showing that changing only that boundary removes the duplicate, or deterministic query-contract proof that entails it. Present the diagnosis and stop.
- **D3:** only after the first human decision, propose the smallest causal change, affected function, rollback, diagnostic cleanup, and original reproducer. Present the plan and stop again.
- **D4:** after approved implementation, finish approved diagnostic cleanup and confirm the intended source/configuration state while retaining user diagnostics. Rerun the original two-page reproduction, check the adjacent pagination boundary, and report literal output. An already-applied fix enters here from Step 0 with its original case and authority; it needs no invented D1-D3 history. If a human owns the final browser check, mark it `HUMAN-PENDING` with its owner rather than fixed.

This scenario demonstrates report shape only. Its commands and conclusions are not reusable evidence.
