/** Builds a synthetic plan based on a recorded premature milestone activation. */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const plan = ".goat-flow/plans/dependency-order";
export const blockedMilestonePath = `${plan}/M02-publish-report.md`;

/** Renders a small milestone accepted by the source plan checker. */
function milestone(title, dependency, task, isComplete = false) {
  const mark = isComplete ? "x" : " ";
  return `# ${title}

**Status:** ${isComplete ? "complete" : "not-started"}
**Depends on:** ${dependency}
**Effort estimate:** ~2 min agent-time (1 product / 1 proof / 0 other)
**Actual:** ${isComplete ? "unavailable: synthetic fixture baseline" : "_"}
**Plan/admin overhead:** 0 min other

## Objective

${task}

## What problem are we solving

The report needs checked results so readers can trace its claims to the source material.

## Who benefits and how

Report readers can confirm that the review is complete before relying on the results.

## Scope

Report preparation in this synthetic project.

## Tasks

- [${mark}] ${task} (est: 1 min product)

## Proof

- [${mark}] Confirm the output is present. [automated] (est: 1 min proof)

## Exit

The task and its check are complete.

## Stop / rescope

Stop if the required results are unavailable.
`;
}

/**
 * Writes three milestones with a dependency that runs against file order.
 * @param {string} project - Root of one disposable eval sample.
 */
export function buildMilestoneOrder(project) {
  mkdirSync(join(project, plan), { recursive: true });
  writeFileSync(
    join(project, "AGENTS.md"),
    "# Report project\n\nLabelled synthetic fixture for a skill eval. Use the selected project for milestone operations.\n",
    { flag: "wx" },
  );
  writeFileSync(
    join(project, plan, "M01-gather-results.md"),
    milestone("M01: Gather results", "none", "Gather the results.", true),
    { flag: "wx" },
  );
  writeFileSync(
    join(project, blockedMilestonePath),
    milestone("M02: Publish report", "M03", "Publish the checked report."),
    { flag: "wx" },
  );
  writeFileSync(
    join(project, plan, "M03-check-results.md"),
    milestone("M03: Check results", "M01", "Check the gathered results."),
    { flag: "wx" },
  );
}
