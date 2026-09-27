/**
 * Checks that review receipts describe commands the reviewer actually ran and the failures still needing a decision.
 *
 * Use these fixtures when changing gate accounting or receipt reads; all file replacements stay inside disposable projects.
 * A passing unrelated command must never hide a failed release check or a replaced evidence file.
 */
import assert from "node:assert/strict";
import { symlinkTestOptions } from "../helpers/symlink-capability.js";
import fs, {
  mkdirSync,
  renameSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { join } from "node:path";
import { describe, it } from "node:test";
import { readReviewReceipt } from "../../src/cli/review-validate-ledger.js";
import { validateReviewReport } from "../../src/cli/review-validate.js";
import { canonicalReviewJson } from "../../src/cli/review-validate-authority.js";
import type { ReviewAuthoritySnapshot } from "../../src/cli/review-validate-authority.js";
import {
  createReviewedProject,
  validReview,
  withIntegrityFields,
  cleanReview,
  fullCleanReview,
  capture,
  report,
  assertReviewResult,
  fixtureGate,
} from "../unit/review-validate.helpers.js";

describe("review integrity through the CLI and recorded gates", () => {
  it("rejects a receipt replaced after its opened bytes were checked", (test) => {
    const root = createReviewedProject(test);
    const relativeReceipt =
      ".goat-flow/logs/review/goat-review-bundle.fixture.diff";
    const receipt = join(root, relativeReceipt);
    assert.ok(
      readReviewReceipt(root, relativeReceipt, "final") instanceof Buffer,
    );
    const originalStat = fs.fstatSync;
    let observations = 0;
    // Replace the actual leaf at the second descriptor observation, after the reader has consumed the original file.
    test.mock.method(fs, "fstatSync", (descriptor: number) => {
      const details = originalStat(descriptor);
      // The second observation occurs after reading, so this real replacement tests the final path-identity check.
      if (++observations === 2) {
        renameSync(receipt, `${receipt}.retained`);
        writeFileSync(receipt, "replacement receipt");
      }
      return details;
    });
    syncBuiltinESMExports();
    try {
      assert.throws(
        () => readReviewReceipt(root, relativeReceipt, "final"),
        /changed during validation/u,
      );
      assert.equal(observations, 2);
    } finally {
      test.mock.restoreAll();
      syncBuiltinESMExports();
    }
  });

  it("keeps skipped gates at zero and requires unresolved blockers despite an unrelated passing command", (test) => {
    const root = createReviewedProject(test);
    const skipped = validSkippedReport(root);
    assertReviewResult(root, skipped, "pass");
    const inflated = withIntegrityFields(skipped, {
      "Gate evidence":
        "pass=99, changed-code=0, pre-existing=0, infrastructure=0, unresolved=0",
    });
    const inflatedResult = validateReviewReport(inflated, root);
    assert.ok(
      inflatedResult.violations.some((issue) =>
        /totals must equal distinct credited commands/u.test(issue.message),
      ),
    );
    const full = fullCleanReview(cleanReview(root));
    const snapshot: ReviewAuthoritySnapshot = JSON.parse(
      full.match(/^- Authority snapshot: (.*)$/mu)![1]!,
    );
    const gates = JSON.parse(full.match(/^- Gate authority: (.*)$/mu)![1]!);
    const failed = fixtureGate(root, snapshot, 1);
    gates.gates.push(failed);
    gates.hostInstructions.push({
      reference: failed.origin.reference,
      sha256: failed.origin.sha256,
    });
    const unresolved = withIntegrityFields(full, {
      "Gate authority": canonicalReviewJson(gates),
      "Gate evidence":
        "pass=1, changed-code=0, pre-existing=0, infrastructure=0, unresolved=1",
      "Gate findings": canonicalReviewJson({ [failed.id]: ["R-001"] }),
      "Final dispositions": '{"R-001":"unresolved"}',
      Evidence: "1 OBSERVED / 0 INFERRED",
      Verdicts: "0/0/0/1",
      "Degradation flags": "gate-evidence-incomplete",
      "Degradation evidence": canonicalReviewJson({
        "gate-evidence-incomplete": `${failed.id} returned a nonzero exit; source causality remains unclassified.`,
      }),
      Conclusion: "coverage-degraded",
    })
      .replace(
        "No findings survived this fixture.",
        "- R-001 [MUST:needs-decision] **Unconfirmed: classify the failing gate** `src/example.ts` (search: `loadConfig`) - The fixture gate failed. | Harm: required verification is incomplete. | Evidence: OBSERVED | Proof: RUNTIME | Missing proof: source causality | Next check: compare the trusted base",
      )
      .replace("Decision: **YES**", "Decision: **NO**");
    assertReviewResult(root, unresolved, "pass");
    // Each single-field mutation must fail for its own missing link, disclosure, or command count.
    for (const [field, value, pattern] of [
      ["Gate findings", "{}", /must name exactly/u],
      [
        "Gate findings",
        canonicalReviewJson({ [failed.id]: ["R-999"] }),
        /absent or historical/u,
      ],
      ["Degradation flags", "none", /gate-evidence-incomplete must agree/u],
      [
        "Degradation evidence",
        canonicalReviewJson({
          "gate-evidence-incomplete": "A command failed.",
        }),
        /evidence must name gate-v1:sha256:/u,
      ],
      [
        "Gate evidence",
        "pass=2, changed-code=0, pre-existing=0, infrastructure=0, unresolved=0",
        /totals must equal/u,
      ],
    ] as const) {
      const result = validateReviewReport(
        withIntegrityFields(unresolved, { [field]: value }),
        root,
      );
      assert.ok(
        result.violations.some((issue) => pattern.test(issue.message)),
        JSON.stringify(result.violations),
      );
    }
    assertReviewResult(
      root,
      unresolved.replace("[MUST:needs-decision]", "[MAY:needs-decision]"),
      "gate-state",
    );
    assertReviewResult(
      root,
      unresolved.replace(
        "Decision: **NO**",
        "Decision: **PENDING REFUTER/HUMAN**",
      ),
      "ship-verdict-contradiction",
    );
    // The same observed failure needs different report consequences once the host establishes its cause.
    for (const outcome of ["changed-code", "pre-existing"] as const) {
      failed.outcome = outcome;
      failed.reason =
        "The fixture failure has been classified against the selected source.";
      const classified = withIntegrityFields(unresolved, {
        "Gate authority": canonicalReviewJson(gates),
        "Gate evidence": `pass=1, changed-code=${Number(outcome === "changed-code")}, pre-existing=${Number(outcome === "pre-existing")}, infrastructure=0, unresolved=0`,
        "Gate findings": canonicalReviewJson(
          outcome === "changed-code" ? { [failed.id]: ["R-001"] } : {},
        ),
        "Final dispositions": '{"R-001":"confirmed"}',
        Verdicts: "1/0/0/0",
        "Degradation flags": "none",
        "Degradation evidence": "{}",
        Conclusion: "confident",
      });
      const disclosed =
        outcome === "pre-existing"
          ? `${classified}\n## Pre-existing Nearby\n- The recorded command also fails against the base.\n`
          : classified;
      assertReviewResult(root, disclosed, "pass");
      assertReviewResult(
        root,
        withIntegrityFields(disclosed, {
          "Gate findings": canonicalReviewJson(
            outcome === "changed-code" ? {} : { [failed.id]: ["R-001"] },
          ),
        }),
        "gate-state",
      );
      // A pre-existing classification still needs its own nearby-issue disclosure in a diff review.
      if (outcome === "pre-existing")
        assertReviewResult(root, classified, "gate-state");
    }
    failed.outcome = "skipped";
    failed.attempts = [];
    failed.reason = "The operator did not select this command for execution.";
    const mixed = withIntegrityFields(full, {
      "Gate authority": canonicalReviewJson(gates),
      Gates: "unavailable",
      "Degradation flags": "gates-not-run",
      "Degradation evidence":
        '{"gates-not-run":"One selected command was skipped."}',
      Conclusion: "coverage-degraded",
    }).replace("Decision: **YES**", "Decision: **YES WITH CONDITIONS**");
    assertReviewResult(root, mixed, "pass");
    assertReviewResult(
      root,
      withIntegrityFields(mixed, { Gates: "run" }),
      "gate-state",
    );
    const interrupted = fixtureGate(root, snapshot, null);
    gates.gates[1] = interrupted;
    gates.hostInstructions[1] = {
      reference: interrupted.origin.reference,
      sha256: interrupted.origin.sha256,
    };
    assertReviewResult(
      root,
      withIntegrityFields(unresolved, {
        "Gate authority": canonicalReviewJson(gates),
      }),
      "gate-state",
    );
    interrupted.outcome = "infrastructure";
    interrupted.reason =
      "The fixture process exceeded its deadline; no repository cause is established.";
    const infrastructure = withIntegrityFields(full, {
      "Gate authority": canonicalReviewJson(gates),
      "Gate evidence":
        "pass=1, changed-code=0, pre-existing=0, infrastructure=1, unresolved=0",
      "Degradation flags": "gate-evidence-incomplete",
      "Degradation evidence": canonicalReviewJson({
        "gate-evidence-incomplete": `${interrupted.id} was interrupted.`,
      }),
      Conclusion: "coverage-degraded",
    }).replace("Decision: **YES**", "Decision: **YES WITH CONDITIONS**");
    assertReviewResult(root, infrastructure, "pass");
  });
});

/** Capture a complete no-execution report before introducing contradictory gate totals in a disposable project. */
function validSkippedReport(root: string): string {
  const snapshot = capture(root, {
    kind: "paths",
    paths: [{ path: "src/example.ts", from: "live" }],
  }).authority;
  return report(snapshot);
}

describe("review receipt files", () => {
  // Each defect has its own test so a host without symlink privileges still checks missing and non-file evidence.
  for (const defect of [
    "missing",
    "directory",
    "leaf-symlink",
    "parent-symlink",
  ] as const) {
    it(
      `refuses a final receipt with ${defect}`,
      defect.endsWith("symlink") ? symlinkTestOptions() : {},
      (test) => {
        const root = createReviewedProject(test);
        const receipt = join(
          root,
          ".goat-flow/logs/review/goat-review-bundle.fixture.diff",
        );
        const control = validReview(root);
        assert.deepEqual(validateReviewReport(control, root).violations, []);
        // A redirected parent is unsafe even when the original receipt remains behind it.
        if (defect === "parent-symlink") {
          renameSync(
            join(root, ".goat-flow/logs"),
            join(root, ".goat-flow/retained"),
          );
          symlinkSync("retained", join(root, ".goat-flow/logs"), "dir");
        } else {
          unlinkSync(receipt);
          // The expected filename must identify a regular file, not a directory or linked replacement.
          if (defect === "directory") mkdirSync(receipt);
          // Even a link to a real project file cannot substitute for the receipt the reviewer recorded.
          if (defect === "leaf-symlink")
            symlinkSync(join(root, "src/example.ts"), receipt);
        }
        const result = validateReviewReport(control, root);
        assert.equal(result.status, "fail");
        assert.ok(
          result.violations.some((issue) =>
            /cannot verify declared review bundle/u.test(issue.message),
          ),
          JSON.stringify(result.violations),
        );
      },
    );
  }

  it("checks fresh draft destinations without creating files or accepting existing evidence", (test) => {
    const root = createReviewedProject(test);
    const absent = ".goat-flow/logs/review/goat-review-bundle.future.diff";
    assert.equal(readReviewReceipt(root, absent, "draft"), null);
    assert.throws(() => readReviewReceipt(root, absent, "final"), /absent/u);
    assert.throws(
      () =>
        readReviewReceipt(
          root,
          ".goat-flow/logs/review/goat-review-bundle.fixture.diff",
          "draft",
        ),
      /already exists/u,
    );
    assert.throws(
      () => readReviewReceipt(root, "../outside.diff", "draft"),
      /outside/u,
    );
  });

  it(
    "refuses a fresh draft beneath a linked parent",
    symlinkTestOptions(),
    (test) => {
      const root = createReviewedProject(test);
      symlinkSync("review", join(root, ".goat-flow/logs/linked"), "dir");
      assert.throws(
        () =>
          readReviewReceipt(
            root,
            ".goat-flow/logs/linked/goat-review-bundle.future.diff",
            "draft",
          ),
        /outside/u,
      );
    },
  );
});
