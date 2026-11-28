/** Builds a staged review fixture based on the observed SAVE10 rounding regression. */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const stagedDiscountPath = "src/discount.mjs";
export const stagedRoundingExpression = "Math.floor(priceCents * 0.9)";

const discount = `/**
 * Apply SAVE10 and round the discounted price to the nearest cent.
 * @param {number} priceCents - Price in cents.
 * @param {string} code - Coupon code.
 */
export function applyDiscount(priceCents, code) {
  if (code === "SAVE10") {
    return ${stagedRoundingExpression};
  }
  return priceCents;
}
`;

/**
 * Writes the staged baseline and its separate snapshot request.
 * @param {string} project - Disposable sample project root.
 */
export function buildStagedReview(project) {
  mkdirSync(join(project, "src"), { recursive: true });
  writeFileSync(join(project, stagedDiscountPath), discount, { flag: "wx" });
  writeFileSync(
    join(project, "..", "staged-request.json"),
    JSON.stringify({
      schema: "goat-review-request/v1",
      source: { kind: "staged", base: "HEAD" },
    }) + "\n",
    { flag: "wx" },
  );
}

/**
 * Writes the corrected source into the working tree once the faulty bytes are staged.
 * @param {string} project - Disposable sample project root.
 */
export function correctUnstagedDiscount(project) {
  writeFileSync(
    join(project, stagedDiscountPath),
    discount.replace(stagedRoundingExpression, "Math.round(priceCents * 0.9)"),
  );
}
