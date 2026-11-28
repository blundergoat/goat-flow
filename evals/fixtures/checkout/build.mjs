/** Builds the synthetic checkout fixture from the M03 planning-intake trials. */
import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";

const FILES = {
  "AGENTS.md": `# checkout-page (goat-flow M03 trial fixture)

Labelled test input for a skill trial; not a real product.

## Essential Commands

- \`npm test\` - required before every merge; runs every unit test with node:test.

## Planning

Milestone plans live in \`.goat-flow/plans/<plan>/\`, one \`M<NN>-<slug>.md\` file per milestone.
`,
  "package.json": `{
  "name": "checkout-page-fixture",
  "private": true,
  "type": "module",
  "scripts": { "test": "node --test" }
}
`,
  "src/discount.mjs": `/**
 * Apply a discount code to a price in cents.
 *
 * @param {number} priceCents - non-negative integer price in cents
 * @param {string} code - discount code entered at checkout, in any letter case
 * @returns {number} discounted price in cents
 */
export function applyDiscount(priceCents, code) {
  const normalized = String(code ?? "").toUpperCase();
  if (normalized === "SAVE10") {
    return Math.round(priceCents * 0.9);
  }
  return priceCents;
}
`,
  "public/app.mjs": `import { applyDiscount } from "/src/discount.mjs";

const PRICE_CENTS = 1000;
document.getElementById("apply").addEventListener("click", () => {
  const code = document.getElementById("code").value;
  document.getElementById("total").textContent = String(applyDiscount(PRICE_CENTS, code));
});
`,
  "docs/briefs/loyalty-points.md": `# Brief: loyalty points at checkout (labelled fixture input)

Customers should earn loyalty points when they pay at checkout.

## Decided

- Customers earn 1 point per whole dollar they pay.
- Points are shown on the checkout page under the total.

## Not decided yet

- Whether points are earned on the price before or after a discount code.
- How fractional dollars round when earning points.
- Whether points expire.
- What happens to points when an order is refunded.
`,
  ".goat-flow/plans/checkout-savings/ISSUE.md": `# Checkout savings message (labelled fixture input)

Planned 2026-09-01.

- Milestones: M01 only.
- Total estimate: 45 minutes.
- Target release: 1.3, due 2026-10-15.
`,
  ".goat-flow/plans/checkout-savings/M01-show-savings-message.md": `# M01: Show what a discount saves on the checkout page (labelled fixture input)

**Status:** not-started
**Depends on:** M00-checkout-setup
**Effort estimate:** ~30 min

## Context

- The Apply handler lives in \`public/main.mjs\` (search: \`addEventListener("click"\`).
- Discount maths lives in \`src/discount.mjs\` (search: \`applyDiscount\`).
- Ship by 2026-10-15 for release 1.3.

## Tasks

- [ ] Add a savings element under the total.
- [ ] Show "You saved $X" when a code takes money off.
- [ ] Hide it when no code applies.
`,
};

/** Writes each fixture file into a fresh project, preserving the original trial inputs. */
export function buildCheckout(project) {
  for (const [path, body] of Object.entries(FILES)) {
    const destination = join(project, path);
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, body, { flag: "wx" });
  }
}

function addHashes(project, directory, files) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (directory === project && entry.name === ".git") continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      addHashes(project, path, files);
    } else {
      const digest = entry.isFile()
        ? createHash("sha256").update(readFileSync(path)).digest("hex")
        : null;
      files.push([relative(project, path), digest]);
    }
  }
}

/** Snapshots project bytes by relative path, including ignored and untracked files. */
export function hashProject(project) {
  const files = [];
  addHashes(project, project, files);
  return Object.fromEntries(
    files.sort(([left], [right]) => left.localeCompare(right)),
  );
}
