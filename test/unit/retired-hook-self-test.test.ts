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

test("instruction audit covers all four retired hook entrypoints", () => {
  const text = [
    "bash .goat-flow/hooks/post-turn-safety.sh --self-test",
    "bash .goat-flow/hooks/gruff-code-quality.sh --self-test",
  ].join("\n");
  const findings = scanContentQuality("CLAUDE.md", text).filter(
    (row) => row.rule === RULE,
  );
  assert.deepEqual(
    findings.map((row) => [row.line, row.suggestion]),
    [
      [
        1,
        "Run `node .goat-flow/hooks/post-turn-safety.mjs --self-test` instead.",
      ],
      [
        2,
        "Run `node .goat-flow/hooks/gruff-code-quality.mjs --self-test` instead.",
      ],
    ],
  );
});

// Builds an in-memory project whose script, CI workflow and package.json call removed hook files; a lesson and a Node fixture string stay quiet.
test("content audit reports each retired-path call in scripts, CI workflows and package.json", () => {
  const files = new Map([
    [
      "scripts/preflight.sh",
      [
        "#!/usr/bin/env bash",
        "if [ -f .goat-flow/hooks/deny-dangerous.sh ]; then",
        "  bash .goat-flow/hooks/deny-dangerous.sh --self-test",
        "fi",
        "shellcheck .goat-flow/hooks/*/*.sh",
      ].join("\n"),
    ],
    ["scripts/clean.sh", "rm -rf dist\n"],
    [
      "scripts/profile.mjs",
      'writeFileSync(path, ".goat-flow/hooks/deny-dangerous.sh");\n',
    ],
    [
      ".github/workflows/ci.yml",
      "      - run: bash .goat-flow/hooks/deny-dangerous/deny-dangerous-self-test.sh\n",
    ],
    [
      "package.json",
      '{ "scripts": { "hooks": "bash ./.goat-flow/hooks/deny-git-mutations.sh --check" } }\n',
    ],
    [
      ".goat-flow/learning-loop/lessons/hooks.md",
      "The old `.goat-flow/hooks/deny-dangerous.sh` runtime was retired.\n",
    ],
  ]);
  const directories = new Map([
    ["scripts", ["preflight.sh", "clean.sh", "profile.mjs"]],
    [".github/workflows", ["ci.yml"]],
    [".goat-flow/learning-loop/lessons/", ["hooks.md"]],
  ]);
  const ctx = makeCtx({
    fs: stubFS({
      exists: (path) => files.has(path) || directories.has(path),
      isReadableDirectory: (path) => directories.has(path),
      listDir: (path) => directories.get(path) ?? [],
      readFile: (path) => files.get(path) ?? null,
    }),
  });

  const findings = runContentQualityChecks(ctx).findings.filter(
    (finding) => finding.rule === "retired-path-reference",
  );

  assert.deepEqual(
    findings.map((finding) => [finding.path, finding.line, finding.suggestion]),
    [
      [
        ".github/workflows/ci.yml",
        1,
        "Use `node .goat-flow/hooks/deny-dangerous.mjs --self-test=full and node .goat-flow/hooks/deny-git-mutations.mjs --self-test=full` instead.",
      ],
      [
        "package.json",
        1,
        "Use `node .goat-flow/hooks/deny-git-mutations.mjs --check` instead.",
      ],
      [
        "scripts/preflight.sh",
        2,
        "Use `node .goat-flow/hooks/deny-dangerous.mjs` instead.",
      ],
      [
        "scripts/preflight.sh",
        3,
        "Use `node .goat-flow/hooks/deny-dangerous.mjs --self-test` instead.",
      ],
      [
        "scripts/preflight.sh",
        5,
        "This glob matches only the retired Bash hook files, so it now finds nothing; target `.goat-flow/hooks/**/*.mjs` or remove it.",
      ],
    ],
  );
});
