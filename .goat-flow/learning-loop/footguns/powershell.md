---
category: powershell
last_reviewed: 2026-10-29
---

## Footgun: PowerShell tool ownership needs native command inspection

**Status:** active | **Created:** 2026-10-29 | **Evidence:** ACTUAL_MEASURED
**Decision changed:** Add shell ownership and native grammar handling together; removing an unsupported-tool refusal alone does not enable safe policy evaluation.
**Trigger phase:** READ

**Prevention:** Trace a provider request through ownership, command decoding, native syntax admission and both policy evaluators. Pair a harmless native command with secret-read, GitHub-write and computed-executable probes. Keep uninspectable execution refused, and assert the owning policy reason rather than only a deny status.

**What happened:** A native Copilot run on Windows denied the harmless PowerShell location command before inspecting it. The GitHub write consequently showed the same unsupported-tool reason. Removing that refusal alone would have allowed the ownership check to skip PowerShell. Reusing hosted inspection also required care: inert evaluator probes accepted a variable-based command, an alias mutation and a .NET process launch before syntax admission was added. No probe payload command was executed.

**Evidence:** `src/hooks/policy-evaluation.mts` (`runPolicyHook`, `evaluatePolicyCommand`); `src/hooks/policy-input.mts` (`isPolicyShellTool`, `isPolicyPowerShellTool`); `src/hooks/policy-segments.mts` (`inspectPolicyPowerShellSyntax`); `test/unit/hook-policy-evaluation.test.ts` (search: `native PowerShell decisions`). The native payload tests preserve object and encoded `toolArgs` and distinguish the two policy owners.

## Footgun: PowerShell pipeline input is not necessarily a known command

**Status:** active | **Created:** 2026-10-29 | **Evidence:** ACTUAL_MEASURED
**Decision changed:** Allow an automatic pipeline variable as executable input only when its producer is structurally bound to an inspected literal block.
**Trigger phase:** ACT

**Prevention:** Keep ordinary data pipelines and computed command names separate from the bounded literal-block pipeline. Verify the producer, consumer and absence of extra output operands before reusing the block's inspection result. Preserve scalar boolean conditions without treating arbitrary variables as constants.

**What happened:** The first native syntax gate rejected existing harmless boolean conditions and the static block pipeline covered by the frozen corpus. A follow-up probe also exposed a missed computed invocation through a parenthesized `Get-Command` expression. The correction retains literal boolean conditions and the inspected block producer while refusing data-driven and computed invocations.

**Evidence:** `src/hooks/policy-segments.mts` (`policyPowerShellPipelineSource`, `powerShellConstantLength`); `src/hooks/policy-evaluation.mts` (`checkPipelineStages`); `test/unit/hook-policy-evaluation.test.ts` (search: `Get-Content commands.txt`, `Get-Command gh`, `echo {git.exe status --short}`); `test/unit/hook-policy-segments.test.ts` (search: `admits inspectable PowerShell syntax`). These tests pass command text to the evaluator; they do not execute its payload.

## Footgun: Native token spelling can differ from an ASCII scanner

**Status:** active | **Created:** 2026-10-29 | **Evidence:** ACTUAL_MEASURED
**Decision changed:** Refuse unsupported native delimiters before passing command text to the ASCII policy readers.
**Trigger phase:** READ

**Prevention:** Compare token boundaries with the native parser. Pair non-breaking-space and typographic-quote probes with harmless quoted data; a valid JSON payload does not establish shared shell grammar.

**What happened:** Inert policy calls allowed a non-breaking-space-prefixed destructive command and a GitHub write using non-breaking spaces. PowerShell parsed their real command names. Mixing ASCII and typographic quotes also hid a separate command from the policy projection. No payload command was executed.

**Evidence:** `src/hooks/policy-segments.mts` (`powerShellLiteralEnd`, `powerShellLiteralProjection`); `test/unit/hook-policy-evaluation.test.ts` (search: `native PowerShell decisions`); `test/unit/hook-policy-segments.test.ts` (search: `refuses unresolved PowerShell syntax`). The cases retain escaped Unicode spellings.

## Footgun: A conditional exception can escape its command segment

**Status:** active | **Created:** 2026-10-29 | **Evidence:** ACTUAL_MEASURED
**Decision changed:** Apply expression admission to each split command, so a conditional exemption cannot cover a later segment.
**Trigger phase:** READ

**Prevention:** Test a refused expression alone and after a harmless conditional. Preserve the conditional parser for its own segment and inspect every following segment independently.

**What happened:** A parenthesized GitHub write was refused alone but allowed after a harmless if statement. The syntax check exempted the whole input when it began with if, and the later segment reached ordinary verb checks without expression admission. An inert destructive-command probe showed the same gap.

**Evidence:** `src/hooks/policy-segments.mts` (`hasUninspectedPowerShellExpression`, `isUninspectedPowerShellSegment`); `src/hooks/policy-evaluation.mts` (`checkPolicyCommandSegments`); `test/unit/hook-policy-evaluation.test.ts` (search: `if ($true) { Write-Output Ready }; Write-Output (gh pr create --fill)`).
