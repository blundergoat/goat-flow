---
category: evidence-attribution
last_reviewed: 2026-10-31
---

**Scope:** Attributing guarantees to the implementation that supplies them, attributing readiness and run details to the host row or command output that recorded them, checking whether reused evidence still describes current bytes, and keeping committed incident evidence readable from a fresh clone. General guidance remains in [agent-evidence-claims.md](agent-evidence-claims.md).

## Lesson: Naming the component that satisfies a rule is a claim about its code

**Status:** active | **Created:** 2026-09-07
**Decision changed:** Before writing that a named tool provides a guarantee, read that tool's implementation, including its failure paths, and claim only the property its code establishes.
**Trigger phase:** ACT
**Caught at:** VERIFY

**Prevention:** Correcting an unreachable instruction usually means naming the component that really performs the work. That rewrite silently converts a requirement into an assertion about an implementation, so it needs the same evidence as any other claim: open the source, follow the success path and every rejection path, and describe only what you find. Never carry an adjective from the old requirement onto the new attribution. Describe outcome vocabularies in terms of end states an agent can observe, because a failure path that leaves a partial artifact will not match a state named after what the code intended to do.

**What happened:** In 1.17.0 the goat-security Persist Gate was corrected to name the redactor as the component performing the parent traversal, and the phrase "race-safe" was carried over from the requirement being replaced. Three independent reviewers found the redactor's parent walk is a pathname `lstat` sequence, not a descriptor-anchored one, and that the claim contradicted a sibling reference in the same skill forbidding exactly that substitution. The same reviewers found the new outcome vocabulary said "no artifact created" while a real rejection path leaves a zero-byte file at the destination, so an agent would report the artifact as skipped.

**Root cause:** Attribution was treated as editorial phrasing rather than as a factual claim about code. Carrying an adjective across a rewrite is the specific move that hides the error, because the sentence still reads like the sentence that was approved. Evidence anchors: `src/cli/redact-command.ts` (search: `assertRedactDirectories`) walks parents with `lstatSync` by pathname, while `assertRedactAllocation` compares `fstatSync` against `lstatSync` before and after the write; `workflow/skills/goat-security/references/common-threats.md` (search: `MUST NOT emulate containment with a status check`) is the sibling rule the false claim contradicted.

---

## Lesson: Reused evidence expires the moment you edit what it depended on

**Status:** active | **Created:** 2026-09-07
**Decision changed:** After every source edit, re-check which retained results read the file you changed, and mark those results stale before reusing them.
**Trigger phase:** VERIFY
**Caught at:** VERIFY
**Incident count:** 2 | **Latest occurrence:** 2026-10-27

**Prevention:** Reusing an earlier run to close a criterion is legitimate only while its inputs are unchanged, so record which files each reused run read. Before an evidence record is offered for approval, diff the session's writes against those input lists and re-run anything whose inputs moved. Treat a fix that broadens a rule as a candidate regression on every behaviour the narrow rule also protected, not only the one it targeted.

**What happened:** In 1.17.0 a shipped template reference said "do not combine templates from different phases", which was overriding the skill and causing a Standard test-plan response to drop its risk map. The fix replaced it with a mode-level ban plus an explicit Standard exception. The old rule had been categorical and had also kept Audit's gap report separate from its post-gate plan, because that reference holds two Audit phases; the replacement forbade only cross-mode combination and left Audit unprotected at render time. The same record had already closed the Audit gate criterion by reusing two earlier runs, and those runs had read the pre-fix reference. The reuse was sound when written and was invalidated by the later edit. A self-audit caught both, the rule was rewritten to ban combining any gate report with the plan that follows it and to name Audit explicitly, and an extra isolated run confirmed the Audit gate still holds.

**Root cause:** Reuse was treated as a property of the earlier run rather than as a claim about the current tree. A narrow replacement for a broad rule silently drops whatever else the broad rule covered, and nothing in the change itself surfaces the loss. Recurrence is likeliest when one file governs several routes and a fix targets one of them. Evidence anchors: `workflow/skills/goat-qa/references/output-templates.md` (search: `never combine a gate report with the plan that follows it`), `test/contract/skill-hardening-skills-2.test.ts` (search: `lets an auto-released goat-qa gate carry both phases in one response`).

**Recurrence 2026-10-27:** A record of five focused policy suites (113 passed on WSL and on native Windows) was saved 0.35 seconds before the last write to `src/hooks/policy-syntax.mts` and 15 seconds before the generated runtime those suites import was rewritten. The record held no hashes or start times, yet later summaries still cited it as final-byte proof. The next session compared its save time with the last write to each file under test, re-ran the suites, and both hosts passed again on the final bytes. When a record lists no inputs, a save time earlier than the last write to any file it tested is enough to treat it as stale. Evidence anchors: `src/hooks/policy-syntax.mts` (search: `normalizePolicyGhExecutableWord(decodedWord)`), `test/unit/hook-policy-github.test.ts` (search: `xargs --arg-file commands.txt gh.exe`).

---

## Lesson: Readiness confirmations belong to named host rows

**Status:** active | **Created:** 2026-10-16 | **Evidence:** OBSERVED
**Decision changed:** Match readiness updates by host name and inspect unavailable-host rows before saving.
**Trigger phase:** ACT
**Caught at:** VERIFY
**Incident count:** 2 | **Latest occurrence:** 2026-10-23

**Prevention:** Update each named host row from its own evidence. Keep executable discovery, user-reported authentication and observed live delivery separate. Check unavailable hosts explicitly after replacing repeated status text; a structural plan check cannot establish factual readiness. Resolve the approved CI route before treating missing personal hardware as a blocker.

**What happened:** While preparing a local runtime plan, a global replacement changed every repeated unverified cell. It copied the user's Windows/WSL sign-in confirmation into native Linux/macOS rows even though the user had no access to either host. Reading the saved table caught the false attribution; host-specific corrections restored both unavailable rows to unverified.

**Root cause:** Identical cell text was treated as identical evidence ownership. This was a local planning error, not an observed provider failure; no provider was launched and no implementation was credited.


**Recurrence 2026-10-23:** Local checks ran on WSL2, but their checklist still named native Linux. I then asked for a host-proof decision even though Linux/macOS CI was already approved. The user reaffirmed Windows/WSL local testing and CI for the other platforms. Keep runner identity explicit and route unavailable personal machines through the existing CI owner. Evidence: `.github/workflows/ci.yml` (search: `hook-port-controls`) defines separate Ubuntu, macOS and Windows runners; `hook-reference-linux` owns the Linux reference job.

---

## Lesson: A run record is read from the session's command outputs, not recalled

**Status:** active | **Created:** 2026-09-19
**Severity:** CORRECTNESS
**Decision changed:** Before writing which harness, model and effort ran a piece of work, search the session for the requester's model and effort commands and copy what their outputs say.
**Trigger phase:** VERIFY
**Caught at:** VERIFY
**Incident count:** 3 | **Latest occurrence:** 2026-09-19

**Prevention:** Model and effort commands leave output lines in the conversation. Find them, quote their values, and tie each change to its timing segment. A harness notice naming a new model is the effect of such a command: look for the command just before it. Write "not observable" only for a setting no output mentions; never say a command was not seen without searching.

**What happened:** One closeout recorded effort xhigh and an unseen model switch; the requester had set effort max and switched models in visible commands. The next closeout corrected it, then missed a second model switch and a new effort command in one turn. A requested second check caught it.

**Recurrence 2026-09-19:** The next closeout, written after this lesson, again claimed no command for a switch to Opus 5; its "Set model to Opus 5" output sat just before the notice the record cited. A second check caught it.

**Root cause:** The record came from settings remembered at the start. Mid-turn commands arrive between tool results, and the closeout never searched for them.

---

## Lesson: A packet offered for approval is a claim about the proof rows it covers

**Status:** active | **Created:** 2026-10-28 | **Evidence:** OBSERVED
**Decision changed:** Before asking approval for an execution packet, map every proof row it is meant to satisfy to the exact probes or commands in the packet, and add any missing case first.
**Trigger phase:** SCOPE
**Caught at:** VERIFY

**Prevention:** Proof rows name the cases a plan promises. An execution packet, the reviewed bundle of commands, probes and limits, names the cases a runner will execute. Before the approval request, list each proof row the packet should close beside the probe IDs that exercise it, and treat a row with no probe as a packet defect. If a gap still surfaces after approval, close it with a separate offline check that carries its own evidence, never by reading the packet's results as covering it.

**What happened:** Two proof rows required fresh Antigravity fixtures to pass a replay of the original Windows GitHub executable cases. All four reviewed packets defined rehearsal probes for `git status`, `git push origin main`, a protected read and an ordinary read, but none for the `gh.exe` or path spellings. The gap surfaced only when the rows were being ticked after the approved rehearsals passed. A separate offline replay of the eight original commands through each fresh Antigravity registration then closed both rows; no provider ran.

**Root cause:** The packets were copied from an earlier capture round and kept its generic probe set, which was never checked against the new proof text. Evidence anchor: the cases the rows named are the unit matrix in `test/unit/hook-policy-github.test.ts` (search: `xargs --arg-file commands.txt gh.exe`).

---

## Lesson: A model's quote is not the delivery record when the native view hides a hook reply

**Status:** active | **Created:** 2026-10-28 | **Evidence:** OBSERVED
**Decision changed:** When a native terminal view collapses or omits a hook reply, read the provider's own session record before closing a delivery criterion, and treat the model's quote as supporting evidence only.
**Trigger phase:** VERIFY
**Caught at:** VERIFY

**Prevention:** A capture verdict needs a record of what the provider returned to the model. Claude Code keeps a per-project session transcript whose tool results carry a hook's blocking text and whose hook attachments carry PostToolUse output. Copilot keeps a session event log under its configured home, with `hook.end` output and the tool result the model received. Read those records, scrub account identifiers and save the extract with the capture. A quote that matches the shipped reason template in `src/hooks/deny-dangerous/patterns-paths.mts` (search: `Secret-file access (${context.verb})`) suggests the reason arrived but does not prove it.

**What happened:** During a native Windows Claude Code capture, the terminal collapsed the blocked `cat .env` call into "Read 1 file", so the secret policy's reason never appeared on screen. The verdict rested on the model quoting "Secret-file access (cat)". An independent read-only reviewer marked the row not satisfied, citing the capture rule that an absent hook reason leaves a row inconclusive. Claude Code's transcript for that session then showed the tool result with the full `BLOCKED: Policy secret` reason. Copilot's event log did the same for a Copilot capture whose view had also collapsed the reply.

**Root cause:** Terminal output was treated as the only provider record, so a hidden reply defaulted to the model's account of it. In the same session the model's own summary misdescribed its steps, which is why a self-report cannot stand in for the record.

---

## Lesson: Learning-loop entries must not name milestones or gitignored files

**Status:** active | **Created:** 2026-10-28 | **Evidence:** OBSERVED
**Decision changed:** Before saving a learning-loop entry, replace milestone and capture IDs, plan-local names and gitignored references with self-contained descriptions and committed anchors.
**Trigger phase:** ACT
**Caught at:** VERIFY

**Prevention:** Learning-loop buckets are committed, but plans, logs and scratchpad files are gitignored, so none of them exist after `git clone`. Describe each incident with what a fresh clone can check: committed file anchors, release and provider versions, and plain prose. Leave out milestone and capture-row IDs, handoff and evidence file names, and phrases such as "local plan evidence"; they read like pointers but resolve to nothing. Before saving, scan the entry with `command grep -nE '\bM[0-9]{2,3}\b|\.goat-flow/(plans|logs|scratchpad)/'` and rewrite every hit. `goat-flow stats --check` rejects a gitignored path used as an evidence anchor, but it does not see IDs or prose references.

**What happened:** Lessons recorded after a Windows hook-capture project named milestone and capture-row IDs, called some evidence "local plan evidence" and mentioned a handoff. `stats --check` and the touched-file checks passed, because none of these were backticked gitignored paths. The user caught them on review: in a fresh clone the IDs point at plan files that do not exist. The entries were rewritten in self-contained terms.

**Root cause:** The entries were drafted from inside the active plan, where milestone IDs are the natural vocabulary, and nothing translated that vocabulary for a fresh-clone reader. Path citations are covered by `.goat-flow/learning-loop/lessons/agent-evidence-claims.md` (search: `Agent cited gitignored content as evidence in committed docs`) and enforced by `src/cli/facts/shared/learning-loop-common.ts` (search: `gitignored path used as durable evidence anchor`); IDs and prose references have no automated check.

---

## Lesson: A fixture-change receipt must allow for the hooks' own writes

**Status:** active | **Created:** 2026-10-30 | **Evidence:** OBSERVED
**Decision changed:** Before a capture receipt counts every unlisted fixture change as unexpected, list the files the installed hooks write during the session and exempt exactly those.
**Trigger phase:** SCOPE
**Caught at:** VERIFY

**Prevention:** A live provider session runs the installed hooks, and some of them write into the project. The Gruff PostToolUse hook writes one health marker per session into the project's local events log directory, named from a checksum of the session identity. A receipt that diffs the whole fixture must declare such writes before approval, and should exempt only a new marker whose `session=` line names the live session, so a marker from any other session still counts as unexpected. Before fixing a receipt's expected changes, read the hook source for each event the session triggers and the file timestamps an earlier session left in the same fixture. Evidence anchor: `workflow/hooks/gruff-code-quality.mjs` (search: `function announceHealth`).

**What happened:** A packet for a native Codex PostToolUse and Stop capture added a whole-fixture diff to its receipt and expected only the two synthetic files and the one-use claim to change. An independent review found that an earlier session in the same fixture had left a Gruff health marker written mid-session, so the new receipt would have reported the next marker as an unexpected change. The row requires that only the synthetic files change, so it would have failed after its claim was spent, with no retry allowed. The packet now declares the marker pattern and exempts a marker only when it names the run's thread id.

**Root cause:** The receipt's expected changes were drawn from the prompt's edits, not from what the installed hooks write. The earlier receipt compared only the listed files, so it never showed the marker.

---

## Lesson: A feature is absent only when its own signal is absent in a real session

**Status:** active | **Created:** 2026-10-31 | **Evidence:** OBSERVED
**Severity:** CORRECTNESS
**Decision changed:** Before a packet says a launch option keeps a client feature out of a session, run that client version with the option and search for the feature's actual screen and transcript signals; until then, report the feature as unknown.
**Trigger phase:** SCOPE
**Caught at:** VERIFY
**Incident count:** 2 | **Latest occurrence:** 2026-10-31

**Prevention:** Earlier runs that differ in both a setting and a feature do not show that the setting controls the feature. Find out how the feature appears in each place it can appear, then search for those exact signals during no-task readiness. A readiness field named for a feature proves only the text it matches, so confirm the match is the feature's own row and not other text on screen. If the feature cannot be excluded, tell the user before spending a one-use claim, and state in the row how any affected claim is attributed. Evidence anchor: `src/cli/hook-provider-captures.ts` (search: `A Remote Control bridge was active`).

**What happened:** A packet for interactive Claude Code 2.1.314 captures on WSL expected that loading project settings only would keep the Remote Control bridge out of the sessions. Earlier WSL receipts, which loaded user settings with `remoteControlAtStartup` on, held session links, and the project-settings Windows receipts held none. A readiness field then reported no Remote Control because it searched for those words, while the client's footer shows `/rc`. All three sessions showed `/rc` and each transcript held a bridge session id, although `/status` listed project settings only. The decision record names no approval channel, so tool approvals could be attributed to the operator only by timing. The user was told, and the rows and the hooks README now state that limit.

**Root cause:** A correlation across earlier receipts was written down as a fact about what controls the bridge, and the readiness field matched words the footer does not use.

**Recurrence 2026-10-31:** A Copilot 1.0.91 readiness driver had to show that no MCP server was connected. `/env` draws only the rows in view, so the first run never showed its MCP section. A scroll loop was added, but the second run's search matched "MCP servers" in the slash menu's help text, so the loop never ran and the check looked satisfied. The run's step list showed no scroll. Anchoring the search at the start of a line found the real section, where both servers were disabled, and only that third run's screens were recorded.

---

## Lesson: A filter for account details must allow known text, not remove one known shape

**Status:** active | **Created:** 2026-10-31 | **Evidence:** OBSERVED
**Decision changed:** When printing or saving a client's raw screens, pass them through an allowlist that reduces any line that could name the account, instead of removing only what looks like an email address.
**Trigger phase:** ACT
**Caught at:** VERIFY

**Prevention:** Client screens can carry an address or a handle, and the project redactor leaves email addresses in place: `src/cli/evidence/redaction.ts` (search: `scrubDurableText`) passed a synthetic address through unchanged on 2026-10-31. Before saving a capture receipt, hide the client's account line if it offers a switch, strip addresses from the terminal frames and record how many remain. Scan by starting from each `@`, because a plain address pattern over megabytes of frames can run for minutes.

**What happened:** A test of a terminal renderer piped a client's screen through a `sed` that removed email addresses, and the screen's sign-in line printed a GitHub handle into the session output. The same session's scan found six address-like strings in the terminal frames of an earlier capture receipt, which had been saved through the redactor. That file is gitignored and stays as pinned evidence, and no other receipt or extract in the scan held one.

**Root cause:** Both filters were built for one shape of account detail and passed everything else. Saving through the redactor was treated as proof the frames held no account details, although it targets secrets.
