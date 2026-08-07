---
name: goat-debug-diagnostic-techniques
description: "Progressive causal, mutation-safety, and worked-example guidance for goat-debug Diagnose mode."
goat-flow-reference-version: "1.15.0"
---
# Diagnostic Techniques

Load this reference only when the root skill routes here. The root owns mode selection, approval gates, mandatory causal confidence, and output. This file expands conditional techniques; it never authorizes a mutation.

## Distinguish Symptom from Cause

Keep three questions separate:

1. **Symptom:** Did the reported behaviour occur under the stated conditions?
2. **Mechanism:** What traced path connects the candidate defect to that exact behaviour?
3. **Distinguishing proof:** Does changing only the candidate factor change the symptom as predicted, or does deterministic contract evidence entail it?

A reproduced symptom can support the first question while two causes remain unresolved. Eliminating alternatives by absence alone is not confirmation. When an intervention would be unsafe or human-owned, stop at MEDIUM and name the missing proof.

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
| Safe local execution | focused reproducer or test against disposable state | Disclose target-controlled execution when local policy requires it. |
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

- **D1.5:** reduce the fixture while preserving the duplicate sort key and page transition. Do not remove an interacting key merely to obtain a smaller non-failing case.
- **D2:** a reproduced duplicate proves the symptom, not which hypothesis caused it. HIGH requires the traced inclusive comparison plus a safe counterfactual showing that changing only that boundary removes the duplicate, or deterministic query-contract proof that entails it. Present the diagnosis and stop.
- **D3:** only after the first human decision, propose the smallest causal change, affected function, rollback, diagnostic cleanup, and original reproducer. Present the plan and stop again.
- **D4:** only after approved implementation, rerun the original two-page reproduction and report literal output. If a human owns the final browser check, mark it `HUMAN-PENDING` rather than fixed.

This scenario demonstrates report shape only. Its commands and conclusions are not reusable evidence.
