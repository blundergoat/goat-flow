/** Instruction audits must replace obsolete policy probes without rewriting a consumer's guidance. */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  runContentQualityChecks,
  scanContentQuality,
} from "../../src/cli/audit/check-content-quality.js";
import { makeCtx, stubFS } from "../fixtures/projects/index.js";

const RULE = "retired-hook-self-test";

test("instruction audit warns about both retired policy self-tests, including fenced commands", () => {
  const text = [
    "# Checks",
    "```bash",
    "bash .goat-flow/hooks/deny-dangerous.sh --self-test=smoke",
    "bash './.goat-flow/hooks/deny-git-mutations.sh' --self-test=full",
    "```",
    "Run `.goat-flow/hooks/deny-dangerous.sh --self-test`.",
  ].join("\n");
  for (const path of [
    "AGENTS.md",
    "CLAUDE.md",
    ".github/copilot-instructions.md",
  ]) {
    const findings = scanContentQuality(path, text).filter(
      (row) => row.rule === RULE,
    );
    assert.deepEqual(
      findings.map((row) => [row.path, row.line, row.severity]),
      [
        [path, 3, "warning"],
        [path, 4, "warning"],
        [path, 6, "warning"],
      ],
    );
    assert.deepEqual(
      findings.map((row) => row.suggestion),
      [
        "Run `node .goat-flow/hooks/deny-dangerous.mjs --self-test=smoke` instead.",
        "Run `node ./.goat-flow/hooks/deny-git-mutations.mjs --self-test=full` instead.",
        "Run `node .goat-flow/hooks/deny-dangerous.mjs --self-test` instead.",
      ],
    );
  }
});

test("instruction audit keeps native probes, unrelated scripts and historical incident evidence quiet", () => {
  const native = "node .goat-flow/hooks/deny-dangerous.mjs --self-test=smoke";
  const old = "bash .goat-flow/hooks/deny-dangerous.sh --self-test";
  for (const [path, text] of [
    ["AGENTS.md", native],
    ["AGENTS.md", "bash scripts/check.sh --self-test"],
    ["AGENTS.md", "bash .goat-flow/hooks/deny-dangerous.sh --check 'rm -rf /'"],
    ["AGENTS.md", "bash other/.goat-flow/hooks/deny-dangerous.sh --self-test"],
    [".goat-flow/learning-loop/lessons/hook-testing.md", old],
    ["docs/migration.md", old],
  ] as const) {
    assert.deepEqual(
      scanContentQuality(path, text).filter((row) => row.rule === RULE),
      [],
    );
  }
  assert.deepEqual(
    scanContentQuality("AGENTS.md", old, "restricted").filter(
      (row) => row.rule === RULE,
    ),
    [],
  );
});

test("read-only content audit includes nested instructions and leaves the supplied guidance unchanged", () => {
  const paths = [
    "src/AGENTS.override.md",
    ".github/instructions/checks.instructions.md",
  ];
  const text =
    'bash ".goat-flow\\hooks\\deny-git-mutations.sh" --self-test=smoke\r\n';
  const files = new Map(paths.map((path) => [path, text]));
  const before = [...files.entries()];
  const report = runContentQualityChecks(
    makeCtx({
      fs: stubFS({
        exists: (path) => files.has(path),
        readFile: (path) => files.get(path) ?? null,
        glob: () => paths,
      }),
    }),
  );
  const findings = report.findings.filter((row) => row.rule === RULE);
  assert.deepEqual(
    findings.map((row) => row.path),
    [...paths].sort(),
  );
  assert.ok(
    findings.every(
      (row) =>
        row.line === 1 &&
        row.suggestion ===
          "Run `node .goat-flow/hooks/deny-git-mutations.mjs --self-test=smoke` instead.",
    ),
  );
  assert.deepEqual([...files.entries()], before);
});
