---
goat-flow-reference-version: "1.19.0"
---
# goat-critique Planning Intake

Read this reference when goat-critique selects planning intake: a request to be interviewed for a plan, or to check an existing plan. Intake asks the user to settle open choices and hands the answers to goat-plan. It spawns no critics, gives no critique verdict and writes no plan itself.

## Choose the Depth

- **Auto (default):** read the request, the brief or plan, and any answers already given. Ask only questions whose answers change scope, behaviour, ordering, proof or authority.
- **Interactive:** when the user asks for a fuller interview, also cover lower-stakes choices, still skipping anything already answered.
- Never open with a question about which depth to use.

## Ask

1. **Select** the unresolved, decision-bearing choices. Skip every point the request, brief, plan or earlier answers already settle. A complete brief can need no questions.
2. **Batch** three to five questions per message, normally five to twenty in total. Use fewer when fewer are open; there is no minimum. When the harness accepts fewer questions per call, use its batch size and keep the same choices.
3. **Shape** each question so it stands alone: three short choices, the recommended one first and marked, and room for the user's own answer.
4. **Respect** an explicit question count or a request for no questions. Never guess a blocking choice to fill the gap; list it as open.
5. **Stop** when the remaining open choices would not change the plan. A preselected or unsubmitted default is not an answer.
6. **No human available** (for example, a sub-agent run): return the current batch as the final answer and stop. Never answer for the user.

## Check an Existing Plan

When the request names an existing plan, check it before asking anything. This is a quick factual pass, not a critique:

- Resolve every cited path and search anchor against the current revision.
- Recompute stated totals from their parts.
- Compare dated facts and named dependencies with today's date and the plan folder.

Report each stale fact with its evidence and leave correct facts alone. When the user requests no questions, list open choices and stop. Otherwise, ask about stale facts with the same question shape. If the request did not ask for updates, also ask whether to apply them. The named plan's files are the only update target.

## Hand Off to goat-plan

When the answers settle the plan, load goat-plan and give it:

- the original request and its destination;
- every restriction the user stated;
- each answered choice;
- each still-open choice, marked open;
- the write authority the request already carries, plus any update the user's reply explicitly approved.

goat-plan selects the mode from that authority:

- **Writes forbidden:** Read-Only Analysis, even with a named destination.
- **A new plan with a named destination and write authority:** File-Write mode at that destination.
- **An existing plan:** Named-File Update of the checked files when the request asks for updates or the user's reply explicitly approves them; otherwise Read-Only Analysis, with the corrected text presented inline.
- **Otherwise:** Read-Only Analysis, with the plan presented inline.

Answers to choice questions never widen authority; only an explicit approval in the user's reply adds an update. A plan-only request stops after the plan is delivered, and nothing is implemented.
