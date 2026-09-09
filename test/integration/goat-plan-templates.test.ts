/**
 * Exercise the planning examples people actually copy through the parser and CLI.
 * Placeholder values below are test inputs, never repository incident evidence.
 * Each CLI fixture lives in a temporary directory and is removed after its check.
 */
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { parseMilestoneMarkdown } from "../../src/cli/plans-export.js";
import { applyPlanTimeTransition } from "../../src/cli/plans-time.js";
import {
  PROJECT_ROOT,
  runPlansCheck,
  writeCheckPlan,
} from "../unit/plans-check.helpers.js";

const EXAMPLES = "workflow/skills/goat-plan/references/milestone-examples.md";
const ISSUE = "workflow/skills/goat-plan/references/issue-format.md";
const PROBLEM =
  "Plan authors lose required verification work when examples use unsupported section headings.";
const BENEFIT =
  "Maintainers can copy valid examples and account for every required task before starting work.";

/** Read one shipped fence without treating headings inside it as document sections. */
function shippedFence(path: string, heading: string): string {
  const matches: string[] = [];
  let selected = false;
  let sections = 0;
  let fence: string[] | undefined;
  let language = "";
  for (const line of readFileSync(join(PROJECT_ROOT, path), "utf8").split(
    "\n",
  )) {
    if (fence !== undefined) {
      if (line === "```") {
        if (selected && language === "markdown") matches.push(fence.join("\n"));
        fence = undefined;
      } else {
        fence.push(line);
      }
    } else if (line.startsWith("```")) {
      language = line.slice(3);
      fence = [];
    } else if (line.startsWith("## ")) {
      selected = line === `## ${heading}`;
      if (selected) sections++;
    }
  }
  assert.equal(sections, 1, `${path}: unique section ${heading}`);
  assert.equal(
    matches.length,
    1,
    `${path}: unique Markdown fence in ${heading}`,
  );
  return matches[0];
}

/** Substitute declared slots only; missing headings or work rows remain broken. */
function milestone(kind: "Small" | "Standard", hasMidProof = false): string {
  const isSmall = kind === "Small";
  let template = shippedFence(
    EXAMPLES,
    isSmall ? "Compact Small rendering" : "Handoff-grade milestone template",
  );
  if (hasMidProof) {
    const conditional = shippedFence(EXAMPLES, "High-risk additions");
    template = template.replace(
      "\n## Proof\n",
      `\n${conditional}\n\n## Proof\n`,
    );
  }
  // This inventory is declared independently of the parser and the shipped row count.
  const product = isSmall ? 5 : 10;
  const proof = (isSmall ? 3 : 4) + (hasMidProof ? 2 : 0);
  const total = product + proof + 1;
  const units = (isSmall ? 3 : 5) + (hasMidProof ? 1 : 0);
  const replacements: Record<string, string> = {
    "<Outcome>": "M01: Preserve every planned verification item",
    "<outcome>": "Preserve every planned verification item",
    "<sha>": "42d6082b635b1597ec787d1eb9556be723c0aa1f",
    "YYYY-MM-DD": "2026-09-09",
    "<local milestone IDs or none>": "none",
    "<optional lowercase lane token>": "planning",
    "<total>": String(total),
    "<product>": String(product),
    "<proof>": String(proof),
    "<other>": "1",
    "<n>": "1",
    "<units/rates/source; use Effort Estimates grammar>": `${units} agent work units; 1-${(total / units).toFixed(4)}-5 min/unit low-likely-high; source: declared test inventory`,
    "<derived low/likely/high; use Effort Estimates grammar>": `${units}-${units * 5} agent-time minutes on one recorded-unpaused milestone timeline; likely ${total}; test fixture`,
    "<included result>": "Preserve planned verification items",
    "<one tempting exclusion>": "runtime parser changes",
    "<Binary outcome this milestone proves or delivers.>":
      "Published templates retain every intended verification item.",
    "<One sentence, 70-120 characters: what stays broken.>": PROBLEM,
    "<One sentence, 70-120 characters: what you can now do.>": BENEFIT,
    "<file>": EXAMPLES,
    "<semantic anchor>": "Handoff-grade milestone template",
    "<non-obvious convention or reference>": "Read the shipped template",
    "<paths>": EXAMPLES,
    "<local result and paths>": `Correct the examples in ${EXAMPLES}`,
    "<tempting, ambiguous, or costly adjacent work>": "Runtime parser changes",
    "<action and done condition>":
      "Correct the template and retain its proof rows",
    "<uncertainty-first action and done condition>":
      "Reproduce the missing proof rows",
    "<implementation action and done condition>":
      "Correct the template and retain its proof rows",
    "<n min product>": "5 min product",
    "<n min proof>": `${isSmall ? 3 : 2} min proof`,
    "<focused proof>": "Source version",
    "<literal command>": "node --version",
    "<observable pass condition>": "Print the runtime version",
    "<claim>": "Every planned proof item remains countable",
    "<evidence and the unique command when needed>":
      "Read the parsed proof rows",
    "<evidence from Commands § focused proof>": "Commands: Source version",
    "<observable behaviour>": "The rendered plan preserves human approval",
    "<action and expected result>": "Inspect the rendered approval row",
    "<binary completion condition>":
      "All proof claims and human approval are recorded",
    "<failed premise or boundary>": "the parser must change",
    "<a premise fails, scope changes, or evidence conflicts>":
      "the parser must change",
  };
  for (const [slot, value] of Object.entries(replacements)) {
    template = template.replaceAll(slot, value);
  }
  assert.doesNotMatch(template, /<[^>\n]+>/u, "unbound shipped placeholder");
  return template;
}

/** Writes temporary plan/ISSUE fixtures, runs the author-facing CLI, then removes the fixtures even on failure. */
function check(
  body: string,
  isStrict = true,
  siblings: Record<string, string> = {},
) {
  const temporaryRoot = mkdtempSync(join(tmpdir(), "goat-plan-templates-"));
  try {
    const plan = writeCheckPlan(temporaryRoot, {
      "M01-template.md": body,
      ...siblings,
    });
    return runPlansCheck(plan, ...(isStrict ? ["--strict"] : []));
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

/** Preserve CLI diagnostics in assertion failures so a rejected template explains its broken contract. */
function expectAccepted(
  body: string,
  isStrict = true,
  siblings: Record<string, string> = {},
) {
  const result = check(body, isStrict, siblings);
  assert.equal(result.status, 0, result.stdout + result.stderr);
}

/** Compare independently declared identities, category totals and positive work units. */
function expectInventory(
  body: string,
  isSmall = false,
  hasMidProof = false,
): void {
  const record = parseMilestoneMarkdown(body, "M01-template.md");
  assert.deepEqual(
    record.tasks.map((item) => item.text.replace(/ \(est:.*$/u, "")),
    isSmall
      ? ["[CORE] Correct the template and retain its proof rows"]
      : [
          "[RISKY] Reproduce the missing proof rows",
          "[CORE] Correct the template and retain its proof rows",
        ],
  );
  const agentProof = record.testingGateItems.filter(
    (item) => !item.text.startsWith("[HUMAN]"),
  );
  assert.equal(agentProof.length, isSmall ? 1 : 2, "final proof row count");
  assert.match(
    agentProof[0].text,
    /Every planned proof item remains countable/u,
  );
  if (!isSmall)
    assert.match(
      agentProof[1].text,
      /^C2: The rendered plan preserves human approval/u,
    );
  assert.equal(
    record.midProofItems.length,
    hasMidProof ? 1 : 0,
    "mid-proof row count",
  );
  if (hasMidProof)
    assert.match(
      record.midProofItems[0].text,
      /^P1: Every planned proof item remains countable/u,
    );
  const items = [
    ...record.tasks,
    ...record.testingGateItems,
    ...record.midProofItems,
  ];
  // Sum parsed work rows independently of the headline so missing proof cannot retain credit through metadata.
  const minutes = (category: string) =>
    items
      .filter((item) => item.estimateCategory === category)
      .reduce((sum, item) => sum + (item.estimateMinutes ?? 0), 0);
  assert.equal(minutes("product"), isSmall ? 5 : 10);
  assert.equal(minutes("proof"), (isSmall ? 3 : 4) + (hasMidProof ? 2 : 0));
  const positiveAgentItems = items.filter(
    (item) =>
      (item.estimateMinutes ?? 0) > 0 && !item.text.startsWith("[HUMAN]"),
  );
  assert.equal(
    positiveAgentItems.length + 1,
    (isSmall ? 3 : 5) + (hasMidProof ? 1 : 0),
  );
}

describe("shipped goat-plan templates", () => {
  for (const kind of ["Small", "Standard"] as const) {
    it(`T1: preserves ${kind} work and accepts it in both CLI modes`, () => {
      const body = milestone(kind);
      expectInventory(body, kind === "Small");
      expectAccepted(body, false);
      expectAccepted(body);
    });
  }

  it("T2: the recommended high-risk Proof heading retains final proof", () => {
    const reference = readFileSync(join(PROJECT_ROOT, EXAMPLES), "utf8");
    const heading = reference.match(/^- \*\*((?:Layered )?Proof):\*\*/mu)?.[1];
    assert.ok(heading, "high-risk proof placement must be explicit");
    const body = milestone("Standard").replace(
      "\n## Proof\n",
      `\n## ${heading}\n`,
    );
    expectInventory(body);
    const broken = parseMilestoneMarkdown(
      body.replace("\n## Proof\n", "\n## Layered Proof\n"),
      "M01-template.md",
    );
    assert.equal(
      broken.testingGateItems.length,
      0,
      "unsupported heading remains a negative control",
    );
  });

  it("T2: the conditional mid-proof fence preserves its row and counted effort", () => {
    const body = milestone("Standard", true);
    expectInventory(body, false, true);
    expectAccepted(body);
    const broken = parseMilestoneMarkdown(
      body.replace("## Mid-implementation proof", "## Mid-proof"),
      "M01-template.md",
    );
    assert.equal(
      broken.midProofItems.length,
      0,
      "abbreviated heading loses its row",
    );
  });

  it("T3: keeps matching forecasts and both legacy combinations while rejecting a missing derived range", () => {
    const body = milestone("Standard");
    for (const isStrict of [false, true]) {
      for (const [basis, range] of [
        [true, true],
        [false, false],
        [false, true],
        [true, false],
      ]) {
        const selected = body
          .split("\n")
          .filter(
            (line) =>
              (basis || !line.startsWith("**Forecast basis:")) &&
              (range || !line.startsWith("**Forecast range:")),
          )
          .join("\n");
        const result = check(selected, isStrict);
        if (basis && !range) {
          assert.equal(result.status, 1, result.stdout + result.stderr);
          assert.match(
            result.stdout,
            /Forecast basis requires a derived Forecast range/u,
          );
        } else assert.equal(result.status, 0, result.stdout + result.stderr);
      }
    }
  });

  it("T4: every documented status produces a valid shipped-template lifecycle snapshot", () => {
    const reference = readFileSync(join(PROJECT_ROOT, EXAMPLES), "utf8");
    const line = reference.match(/^Supported statuses: (.+)$/mu)?.[1];
    assert.ok(line, "publish the supported lifecycle vocabulary");
    const statuses = [...line.matchAll(/`([^`]+)`/gu)].map((match) => match[1]);
    assert.deepEqual(statuses, [
      "not-started",
      "in-progress",
      "testing-gate",
      "human-verification-pending",
      "blocked",
      "abandoned",
      "superseded",
      "deferred",
      "complete",
    ]);
    const reasons: Record<string, string> = {
      blocked: "Waiting for the recorded external check before resuming.",
      abandoned:
        "The human stopped this work because its outcome is no longer needed.",
      superseded: "M02 carries the remaining work.",
      deferred: "The later release owns the remaining work in backlog.md.",
    };
    for (const status of statuses) {
      let body = milestone("Standard").replace(
        "**Status:** not-started",
        `**Status:** ${status}`,
      );
      if (
        ["testing-gate", "human-verification-pending", "complete"].includes(
          status,
        )
      ) {
        body = body.replace(/^- \[ \] \[(?:RISKY|CORE)\]/gmu, (line) =>
          line.replace("[ ]", "[x]"),
        );
      }
      if (["human-verification-pending", "complete"].includes(status)) {
        body = body
          .replace(/^- \[ \] (?!\[HUMAN\])/gmu, "- [x] ")
          .replace(
            "**Actual:** _",
            "**Actual:** unavailable: template fixture has no elapsed work",
          );
      }
      if (status === "complete") body = body.replaceAll("- [ ]", "- [x]");
      const siblings: Record<string, string> =
        status === "superseded"
          ? {
              "M02-successor.md": milestone("Standard").replace(
                "# M01:",
                "# M02:",
              ),
            }
          : {};
      if (reasons[status]) {
        const missing = check(body, true, siblings);
        assert.equal(missing.status, 1, missing.stdout);
        assert.match(
          missing.stdout,
          new RegExp(`${status} milestone requires Status reason`, "u"),
        );
        body = body.replace(
          `**Status:** ${status}`,
          `**Status:** ${status}\n**Status reason:** ${reasons[status]}`,
        );
      }
      expectAccepted(body, true, siblings);
      if (!reasons[status]) {
        const stale = check(
          body.replace(
            `**Status:** ${status}`,
            `**Status:** ${status}\n**Status reason:** Resolved old blocker.`,
          ),
        );
        assert.equal(stale.status, 1, stale.stdout);
        assert.match(stale.stdout, /milestone must not include Status reason/u);
      }
      if (status === "superseded") {
        for (const successor of ["M01", "M99", "another milestone"]) {
          const invalid = check(
            body.replace("M02 carries", `${successor} carries`),
            true,
            siblings,
          );
          assert.equal(invalid.status, 1, invalid.stdout);
          assert.match(invalid.stdout, /superseded/u);
        }
      }
    }
  });

  it("T5: a leading zero-minute HUMAN row alone may remain open at handoff", () => {
    const record = parseMilestoneMarkdown(
      milestone("Standard"),
      "M01-template.md",
    );
    const human = record.testingGateItems.filter((item) =>
      item.text.startsWith("[HUMAN]"),
    );
    assert.equal(
      human.length,
      1,
      "the shipped template must expose human acceptance",
    );
    assert.equal(human[0].estimateMinutes, 0);
    let body = milestone("Standard", true);
    expectInventory(body, false, true);
    body = body
      .replace(
        "**Status:** not-started",
        "**Status:** human-verification-pending",
      )
      .replace(
        "**Actual:** _",
        "**Actual:** unavailable: template fixture has no elapsed work",
      )
      .replace(/^- \[ \] (?!\[HUMAN\])/gmu, "- [x] ");
    expectAccepted(body);
    const manual = check(body.replace("- [ ] [HUMAN]", "- [ ] [manual]"));
    assert.equal(manual.status, 1, manual.stdout);
    assert.match(
      manual.stdout,
      /executor proof item remains open at human-verification-pending/u,
    );
  });

  /** Writes a shipped-form lifecycle fixture to guard reset history against live metadata and lost reopened work. */
  it("L4: reset preserves inert receipt history and rejects every live residual", () => {
    const temporaryRoot = mkdtempSync(join(tmpdir(), "goat-plan-reset-"));
    try {
      const plan = writeCheckPlan(
        join(temporaryRoot, ".goat-flow", "plans", "reset"),
        {
          "M01-template.md": milestone("Standard", true).replace(
            "**Status:** not-started",
            "**Status:** in-progress",
          ),
        },
      );
      const path = join(plan, "M01-template.md");
      applyPlanTimeTransition(path, { action: "start", category: "product" });
      applyPlanTimeTransition(path, { action: "stop" });
      const receiptPattern = /\n## Timing Receipt\n[\s\S]*?(?=\n## |$)/u;
      const pausedReceipt = readFileSync(path, "utf8").match(
        receiptPattern,
      )?.[0];
      assert.ok(pausedReceipt);
      applyPlanTimeTransition(path, { action: "stop", finalize: true });
      const completed = readFileSync(path, "utf8")
        .replace("**Status:** in-progress", "**Status:** complete")
        .replaceAll("- [ ]", "- [x]");
      const oldActual = completed.match(/^\*\*Actual:\*\* .+$/mu)?.[0];
      const oldReceipt = completed.match(receiptPattern)?.[0];
      assert.ok(oldActual);
      assert.ok(oldReceipt);
      expectAccepted(completed);

      const reset =
        completed
          .replace("**Status:** complete", "**Status:** not-started")
          .replace(oldActual, "**Actual:** _")
          .replace(oldReceipt, "\n")
          .replaceAll("- [x]", "- [ ]") +
        `\n## Reset history\n\n\`\`\`\`markdown\n${oldActual}\n${oldReceipt}\n\`\`\`\`\n`;
      expectInventory(reset, false, true);
      expectAccepted(reset);
      const record = parseMilestoneMarkdown(reset, "M01-template.md");
      assert.equal(record.status, "not-started");
      assert.equal(record.timingReceipt, undefined);
      assert.equal(record.effort?.actual, undefined);
      assert.ok(record.tasks.every((item) => !item.isChecked));
      assert.ok(record.testingGateItems.every((item) => !item.isChecked));
      assert.ok(record.midProofItems.every((item) => !item.isChecked));
      assert.ok(
        reset.endsWith(
          `\`\`\`\`markdown\n${oldActual}\n${oldReceipt}\n\`\`\`\`\n`,
        ),
      );
      writeFileSync(path, reset);
      const first = runPlansCheck(plan, "--strict");
      const second = runPlansCheck(plan, "--strict");
      assert.equal(first.status, 0, first.stdout + first.stderr);
      assert.equal(second.status, first.status);
      assert.equal(second.stdout, first.stdout);
      assert.equal(second.stderr, first.stderr);
      assert.equal(readFileSync(path, "utf8"), reset);

      const residuals: Array<[string, string, RegExp]> = [
        [
          "paused receipt",
          reset.replace(
            "## Reset history",
            `${pausedReceipt}\n## Reset history`,
          ),
          /not-started milestone must not include a Timing Receipt/u,
        ],
        [
          "current Actual",
          reset.replace("**Actual:** _", oldActual),
          /not-started milestone must not include Actual before work begins/u,
        ],
        [
          "stale reason",
          reset.replace(
            "**Status:** not-started",
            "**Status:** not-started\n**Status reason:** Resolved old blocker.",
          ),
          /milestone must not include Status reason/u,
        ],
        [
          "checked task",
          reset.replace("- [ ] [RISKY]", "- [x] [RISKY]"),
          /not-started milestone has checked implementation tasks/u,
        ],
        [
          "checked proof",
          reset.replace("- [ ] C1:", "- [x] C1:"),
          /not-started milestone has checked proof items/u,
        ],
        [
          "checked mid-proof",
          reset.replace("- [ ] P1:", "- [x] P1:"),
          /not-started milestone has checked mid-proof items/u,
        ],
        [
          "checked exit",
          reset.replace("## Exit\n- ", "## Exit\n- [x] "),
          /not-started milestone has checked exit criteria/u,
        ],
      ];
      for (const [label, body, expected] of residuals) {
        const result = check(body);
        assert.equal(
          result.status,
          1,
          `${label}: ${result.stdout}${result.stderr}`,
        );
        assert.match(result.stdout, expected, label);
      }
    } finally {
      rmSync(temporaryRoot, { recursive: true, force: true });
    }
  });

  it("T6: the actual positive sentences satisfy the unchanged plain-language rule", () => {
    const reference = readFileSync(join(PROJECT_ROOT, EXAMPLES), "utf8");
    const sentences = [...reference.matchAll(/^- GOOD: "(.+)"$/gmu)].map(
      (match) => match[1],
    );
    assert.equal(sentences.length, 2);
    for (const sentence of sentences)
      assert.ok(
        sentence.length >= 70 && sentence.length <= 120,
        `${sentence.length} characters: ${sentence}`,
      );
    expectAccepted(
      milestone("Standard")
        .replace(PROBLEM, sentences[0])
        .replace(BENEFIT, sentences[1]),
    );
  });

  it("T6: the worked ISSUE headline equals its delivery bands", () => {
    const issue = shippedFence(ISSUE, "Worked sample");
    const bands = [...issue.matchAll(/^-[^\n]+ = (\d+)-(\d+)h$/gmu)];
    assert.equal(bands.length, 3);
    const headline = issue.match(
      /\| How long will it take\? \| (\d+)-(\d+) hours/u,
    );
    assert.ok(headline);
    assert.deepEqual(
      [Number(headline[1]), Number(headline[2])],
      [
        bands.reduce((sum, row) => sum + Number(row[1]), 0),
        bands.reduce((sum, row) => sum + Number(row[2]), 0),
      ],
    );
  });

  it("T6: plans check leaves ISSUE arithmetic and requirement coverage to the author", () => {
    const temporaryRoot = mkdtempSync(
      join(tmpdir(), "goat-plan-issue-control-"),
    );
    try {
      const plan = writeCheckPlan(temporaryRoot, {
        "M01-template.md": milestone("Standard"),
      });
      const baseline = runPlansCheck(plan, "--strict");
      assert.equal(baseline.status, 0, baseline.stdout);
      const issue = shippedFence(ISSUE, "Worked sample").replace(
        /\d+-\d+ hours of agent work/u,
        "999-1000 hours of agent work",
      );
      writeFileSync(join(plan, "ISSUE.md"), issue);
      const withIssue = runPlansCheck(plan, "--strict");
      assert.equal(withIssue.status, baseline.status);
      assert.equal(withIssue.stdout, baseline.stdout);
      assert.equal(withIssue.stderr, baseline.stderr);
    } finally {
      rmSync(temporaryRoot, { recursive: true, force: true });
    }
  });
});
