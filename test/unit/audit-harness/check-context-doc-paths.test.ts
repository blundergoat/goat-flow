/**
 * Regression tests for the doc-paths-resolve hard-failure contract.
 *
 * A missing .goat-flow/architecture.md only produced a finding string; when
 * the remaining router/core-doc paths all resolved, the counts balanced and
 * the check reported PASS, silently discarding the missing-doc finding.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { HARNESS_CHECKS } from "../../src.js";
import { makeCtx, stubFS } from "../../fixtures/projects/index.js";

const docPathsResolve = HARNESS_CHECKS.find(
  (check) => check.id === "doc-paths-resolve",
);

/**
 * Build a context whose architecture fact and core-doc contents the test
 * controls. Router facts are emptied so counted paths come only from `files`.
 */
function ctxWithDocs(
  architectureExists: boolean,
  files: Record<string, string>,
  resolvable: string[],
) {
  const baseFacts = makeCtx().facts;
  const known = new Set([...resolvable, ...Object.keys(files)]);
  return makeCtx({
    agents: [],
    facts: {
      ...baseFacts,
      shared: {
        ...baseFacts.shared,
        architecture: {
          ...baseFacts.shared.architecture,
          exists: architectureExists,
        },
      },
    },
    fs: stubFS({
      readFile: (path: string) => files[path] ?? null,
      exists: (path: string) => known.has(path),
    }),
  });
}

describe("doc-paths-resolve harness check", () => {
  it("fails when architecture.md is missing even though every counted path resolves", () => {
    assert.ok(docPathsResolve, "doc-paths-resolve check must exist");

    const result = docPathsResolve.run(
      ctxWithDocs(false, { "CONTRIBUTING.md": "See `docs/cli.md` first.\n" }, [
        "docs/cli.md",
      ]),
    );

    assert.equal(result.status, "fail");
    assert.ok(
      result.findings.includes("architecture.md does not exist"),
      JSON.stringify(result.findings),
    );
  });

  it("fails when architecture.md is missing and no doc paths were counted", () => {
    assert.ok(docPathsResolve, "doc-paths-resolve check must exist");

    const result = docPathsResolve.run(ctxWithDocs(false, {}, []));

    assert.equal(result.status, "fail");
    assert.ok(
      result.findings.includes("architecture.md does not exist"),
      JSON.stringify(result.findings),
    );
  });

  it("passes when architecture.md exists and every counted path resolves", () => {
    assert.ok(docPathsResolve, "doc-paths-resolve check must exist");

    const result = docPathsResolve.run(
      ctxWithDocs(true, { "CONTRIBUTING.md": "See `docs/cli.md` first.\n" }, [
        "docs/cli.md",
      ]),
    );

    assert.equal(result.status, "pass");
    assert.match(result.findings.join("\n"), /All 1 doc file paths resolve/);
  });
});
