/** Verify instruction-command coverage is a score-only signal, never a plan-state audit. */
import assert from "node:assert/strict";
import { it } from "node:test";
import { HARNESS_CHECKS, PROFILES, computeHarness } from "../../src.js";
import {
  makeCtx,
  stubAgentFacts,
  stubFS,
} from "../../fixtures/projects/index.js";

const complete = [
  "Run `goat-flow plans time start <milestone-file> --category product`.",
  "Run `goat-flow plans time stop <milestone-file>` and add `--finalize` at exit.",
  "Tick each completed milestone task `- [x]` before starting the next task.",
].join("\n");

/** Build the text-only evidence the metric owns, refusing any accidental plan-file read. */
function contextFor(files: Record<string, string>) {
  return makeCtx({
    agents: [stubAgentFacts(), stubAgentFacts({ agent: PROFILES.codex })],
    fs: stubFS({
      readFile: (path) => {
        assert.ok(!path.startsWith(".goat-flow/plans"), path);
        return files[path] ?? null;
      },
    }),
  });
}

it("checks every present agent instruction and leaves absent files to their owning checks", () => {
  const check = HARNESS_CHECKS.find(
    (item) => item.id === "milestone-commands-named",
  );
  assert.ok(check);
  assert.equal(check.type, "metric");
  assert.equal(
    check.run(contextFor({ "CLAUDE.md": complete, "AGENTS.md": complete }))
      .status,
    "pass",
  );
  assert.equal(check.run(contextFor({})).status, "pass");
});

it("names a missing finalize clause in the affected instruction file", () => {
  const check = HARNESS_CHECKS.find(
    (item) => item.id === "milestone-commands-named",
  );
  assert.ok(check);
  const result = check.run(
    contextFor({
      "CLAUDE.md": complete,
      "AGENTS.md": complete.replace("--finalize", ""),
    }),
  );
  assert.equal(result.status, "fail");
  assert.match(result.findings.join("\n"), /AGENTS\.md.*--finalize/u);
});

it("requires immediate tick discipline as well as the three timer commands", () => {
  const check = HARNESS_CHECKS.find(
    (item) => item.id === "milestone-commands-named",
  );
  assert.ok(check);
  const result = check.run(
    contextFor({ "CLAUDE.md": complete.split("\n").slice(0, 2).join("\n") }),
  );
  assert.equal(result.status, "fail");
  assert.match(result.findings.join("\n"), /tick/iu);
});

it("keeps a missing-command metric from failing Recovery while lowering its score", () => {
  const full = computeHarness(contextFor({ "CLAUDE.md": complete }));
  const incomplete = computeHarness(
    contextFor({ "CLAUDE.md": complete.replace("--finalize", "") }),
  );
  assert.equal(incomplete.concerns.recovery.status, "pass");
  assert.ok(incomplete.concerns.recovery.score < full.concerns.recovery.score);
  assert.ok(
    incomplete.concerns.recovery.limits.some((limit) =>
      /command.*metric|metric.*command/iu.test(limit),
    ),
  );
});
