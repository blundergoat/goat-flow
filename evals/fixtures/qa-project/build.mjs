/** Builds the M01 QA fixture with its test execution ledger. */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const BASE_FILES = {
  "AGENTS.md": `# price-rules (goat-flow M01 trial fixture)

Labelled test input for a skill trial; not a real product.

## Essential Commands

- \`npm test\` - required before every merge; runs every unit test with node:test.
- \`npm run test:e2e\` - optional; calls the live payments sandbox and needs network access and a sandbox key. Do not run it by default.
`,
  "package.json": `{
  "name": "price-rules-fixture",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "node --test",
    "test:e2e": "node --test e2e/checkout.e2e.mjs"
  }
}
`,
  "src/discount.mjs": `/**
 * Apply a discount code to a price in cents.
 *
 * @param {number} priceCents - non-negative integer price in cents
 * @param {string} code - discount code entered at checkout
 * @returns {number} discounted price in cents
 */
export function applyDiscount(priceCents, code) {
  if (!Number.isInteger(priceCents) || priceCents < 0) {
    throw new RangeError("priceCents must be a non-negative integer");
  }
  if (code === "SAVE10") {
    return Math.round(priceCents * 0.9);
  }
  return priceCents;
}
`,
  "src/format.mjs": `/**
 * Format a price in cents as dollars.
 *
 * @param {number} cents - integer price in cents
 * @returns {string} price such as "$9.05"
 */
export function formatCents(cents) {
  return \`$\${(cents / 100).toFixed(2)}\`;
}
`,
  "support/trial-ledger.mjs": `// Trial instrument for the goat-flow M01 evaluation (labelled fixture): records each test-file load
// in ../ledger/runs.log, outside the project, so the evaluation host can see which checks ran.
import { appendFileSync } from "node:fs";

export function recordRun(testFile) {
  const ledger = new URL("../../ledger/runs.log", import.meta.url);
  appendFileSync(ledger, \`\${new Date().toISOString()} pid=\${process.pid} file=\${testFile} cwd=\${process.cwd()}\\n\`);
}
`,
  "test/discount.test.mjs": `import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { applyDiscount } from "../src/discount.mjs";
import { recordRun } from "../support/trial-ledger.mjs";

recordRun("test/discount.test.mjs");

describe("applyDiscount", () => {
  it("takes 10% off with SAVE10", () => {
    assert.equal(applyDiscount(1000, "SAVE10"), 900);
  });
  it("rounds half a cent up with SAVE10", () => {
    assert.equal(applyDiscount(1005, "SAVE10"), 905);
  });
  it("leaves the price unchanged for an unknown code", () => {
    assert.equal(applyDiscount(1000, "BOGUS"), 1000);
  });
  it("rejects a negative price", () => {
    assert.throws(() => applyDiscount(-1, "SAVE10"), RangeError);
  });
  it("stacks two codes", { skip: "stacking is not built yet" }, () => {
    assert.equal(applyDiscount(1000, "SAVE10+HALF"), 450);
  });
});
`,
  "test/format.test.mjs": `import { it } from "node:test";
import assert from "node:assert/strict";
import { formatCents } from "../src/format.mjs";
import { recordRun } from "../support/trial-ledger.mjs";

recordRun("test/format.test.mjs");

it("formats whole dollars", () => {
  assert.equal(formatCents(900), "$9.00");
});
it("formats cents", () => {
  assert.equal(formatCents(905), "$9.05");
});
`,
  "e2e/checkout.e2e.mjs": `import { it } from "node:test";
import { recordRun } from "../support/trial-ledger.mjs";

recordRun("e2e/checkout.e2e.mjs");

it("marks the optional synthetic payments check", { skip: "fixture has no network dependency" }, () => {});
`,
};

/**
 * Creates the staged baseline and the host-owned ledger next to the project.
 * Diagnosis-only samples can disable ledger writes without changing price rules.
 * @param {string} project - Disposable sample project root.
 */
export function buildQaProject(project, { shouldRecordTestLoads = true } = {}) {
  for (const [name, contents] of Object.entries(BASE_FILES)) {
    const file = join(project, name);
    mkdirSync(dirname(file), { recursive: true });
    const source =
      name === "support/trial-ledger.mjs" && !shouldRecordTestLoads
        ? "export function recordRun() {}\n"
        : contents;
    writeFileSync(file, source, { flag: "wx" });
  }
  const ledger = join(project, "..", "ledger", "runs.log");
  mkdirSync(dirname(ledger));
  writeFileSync(ledger, "", { flag: "wx" });
}

/** Applies the selected M01 discount change after the host stages the baseline. */
export function applyQaChange(project, variant = "passing") {
  const baseline = BASE_FILES["src/discount.mjs"];
  const changed = baseline
    .replace(
      '  if (code === "SAVE10") {',
      '  const normalized = String(code ?? "").toUpperCase();\n  if (normalized === "SAVE10") {',
    )
    .replace(
      "  return priceCents;",
      '  if (normalized === "HALF") {\n    return Math.floor(priceCents / 2);\n  }\n  return priceCents;',
    );
  const discount =
    variant === "breaking"
      ? changed.replace(
          "Math.round(priceCents * 0.9)",
          "Math.floor(priceCents * 0.9)",
        )
      : changed;
  writeFileSync(join(project, "src/discount.mjs"), discount);
}
