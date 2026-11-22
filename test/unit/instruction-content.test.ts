/** Check instruction warnings without applying agent-only rules to ordinary documentation. */
import assert from "node:assert/strict";
import { it } from "node:test";
import { scanContentQuality } from "../../src/cli/audit/check-content-quality.js";
import { runFactualClaimChecks } from "../../src/cli/audit/check-factual-claims.js";
import { makeCtx, stubFS } from "../fixtures/projects/index.js";

const reminder =
  "MUST tick `- [x]` on each task as it's completed - not at the end.";
const mutation = "Commit or stash your work before continuing.";
const instructionRules = new Set([
  "reminder-without-enforcement",
  "agent-git-mutation-directive",
]);

/** Keep assertions focused on instruction safety rather than unrelated prose diagnostics. */
function instructionFindings(path: string, text: string) {
  return scanContentQuality(path, text).filter((finding) =>
    instructionRules.has(finding.rule),
  );
}

it("warns when an imperative tick reminder does not name its enforcement limit", () => {
  assert.deepEqual(
    instructionFindings("AGENTS.md", reminder).map((finding) => finding.rule),
    ["reminder-without-enforcement"],
  );
  assert.equal(
    instructionFindings("AGENTS.md", `${reminder} This is prose-only.`).length,
    0,
  );
});

it("flags agent commit and stash directives while preserving Never-tier prohibitions", () => {
  assert.deepEqual(
    instructionFindings("CLAUDE.md", mutation).map((finding) => finding.rule),
    ["agent-git-mutation-directive"],
  );
  assert.equal(
    instructionFindings(
      "CLAUDE.md",
      "Never run `git commit`, `git push`, or `git stash`; the user owns Git mutations.",
    ).length,
    0,
  );
  assert.equal(instructionFindings("README.md", mutation).length, 0);
});

it("keeps fenced examples and table headings out of instruction warnings", () => {
  assert.equal(
    instructionFindings(
      "AGENTS.md",
      `\`\`\`text\n${reminder}\n${mutation}\n\`\`\``,
    ).length,
    0,
  );
  assert.equal(
    instructionFindings(
      "AGENTS.md",
      `| Rule | ${reminder} |\n| --- | --- |\n| Meaning | Text |`,
    ).length,
    0,
  );
});

it("checks retired commands in instruction files without scanning their numeric claims", () => {
  const ctx = makeCtx({
    fs: stubFS({
      exists: (path) => path === "AGENTS.md",
      glob: () => [],
      readFile: (path) =>
        path === "AGENTS.md"
          ? "Run `goat-flow fix`. This harness has 999 checks."
          : null,
    }),
  });
  const { findings } = runFactualClaimChecks(ctx);
  assert.deepEqual(
    findings.map((finding) => finding.rule),
    ["removed-command-fix"],
  );
  assert.equal(findings[0]?.path, "AGENTS.md");
});
