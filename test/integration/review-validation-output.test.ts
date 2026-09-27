/**
 * Protects saved review evidence when a developer sends validation results to a file.
 *
 * Runs the public CLI against same-path, linked-path, and separate-output fixtures.
 * Each case checks both the exit result and the original report bytes.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  closeSync,
  linkSync,
  openSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { describe, it } from "node:test";
import { createReviewedProject } from "../unit/review-validate.helpers.js";

describe("review validation output safety", () => {
  // All public validation commands share the output writer and must preserve the developer's original evidence.
  for (const operation of ["validate", "validate-draft", "validate-ledger"]) {
    // Each validation mode must preserve evidence through links while still supporting a separate output file.
    for (const alias of ["same path", "symlink", "hardlink", "separate file"]) {
      it(`preserves ${operation} input when output uses ${alias}`, (testContext) => {
        const root = createReviewedProject(testContext);
        const input = join(root, "report.md");
        const output = alias === "same path" ? input : join(root, "result.md");
        const original = "# Review evidence that must survive validation\n";
        writeFileSync(input, original);
        // Link fixtures give the same saved report a second spelling without creating a second copy.
        if (alias === "symlink" || alias === "hardlink") {
          try {
            // Symbolic and hard links exercise different filesystem identities that lexical path checks miss.
            if (alias === "symlink") symlinkSync(input, output);
            else linkSync(input, output);
          } catch (error) {
            // Windows without link privileges cannot create this fixture; other failures still invalidate the test.
            if (
              process.platform === "win32" &&
              (error as NodeJS.ErrnoException).code === "EPERM"
            ) {
              testContext.skip("Host does not permit link creation");
              return;
            }
            throw error;
          }
        }
        const projectArguments =
          operation === "validate-ledger" ? [] : ["--project", root];
        const result = spawnSync(
          process.execPath,
          [
            "--import",
            "tsx",
            resolve(import.meta.dirname, "../../src/cli/cli.ts"),
            "review",
            operation,
            input,
            ...projectArguments,
            "--output",
            output,
          ],
          { encoding: "utf8" },
        );
        assert.equal(
          result.status,
          alias === "separate file" ? 1 : 2,
          result.stderr,
        );
        // A separate destination receives the failed-validation summary without changing the source evidence.
        if (alias === "separate file")
          assert.match(readFileSync(output, "utf8"), /FAIL/);
        else assert.match(result.stderr, /output.*input/i);
        assert.equal(readFileSync(input, "utf8"), original);
      });
    }
    it(`preserves ${operation} input when redirected stdin is also the output file`, (testContext) => {
      const projectRoot = createReviewedProject(testContext);
      const reportPath = join(projectRoot, "report.md");
      const reportText = "# Evidence supplied through redirected stdin\n";
      writeFileSync(reportPath, reportText);
      const inputDescriptor = openSync(reportPath, "r");
      try {
        const projectArguments =
          operation === "validate-ledger" ? [] : ["--project", projectRoot];
        const result = spawnSync(
          process.execPath,
          [
            "--import",
            "tsx",
            resolve(import.meta.dirname, "../../src/cli/cli.ts"),
            "review",
            operation,
            ...projectArguments,
            "--output",
            reportPath,
          ],
          { encoding: "utf8", stdio: [inputDescriptor, "pipe", "pipe"] },
        );
        assert.equal(result.status, 2, result.stderr);
        assert.match(result.stderr, /output.*input/i);
        assert.equal(readFileSync(reportPath, "utf8"), reportText);
      } finally {
        closeSync(inputDescriptor);
      }
    });
  }
});
