/**
 * Checks that fix commands printed by audit, setup, stats, status, install, skill doctor, index, the quality prompt and the Hooks page name the
 * goat-flow release that printed them.
 *
 * A bare `goat-flow` runs whichever CLI is on PATH, and `@latest` runs a newer one once a release ships; both have advised a downgrade.
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, it } from "node:test";
import { pinnedGoatFlowCommand } from "../../src/cli/advised-command.js";
import { SETUP_CHECKS } from "../../src/cli/audit/check-goat-flow.js";
import { COMMANDS } from "../../src/cli/cli-types.js";
import { AUDIT_VERSION } from "../../src/cli/constants.js";
import { makeCtx, stubConfig } from "../fixtures/projects/index.js";

const PROJECT_ROOT = resolve(import.meta.dirname, "..", "..");

// Sources whose user-facing text advises commands; help text documents syntax and is not advice.
const ADVICE_SOURCES = [
  "src/cli/audit",
  "src/cli/prompt/compose-setup.ts",
  "src/cli/server/hook-registrar.ts",
  "src/cli/stats/stats.ts",
  "src/cli/install-summary.ts",
  "src/cli/install-command.ts",
  "src/cli/installer/apply.ts",
  "src/cli/managed-install-evidence.ts",
  "src/cli/skill-doctor.ts",
  "src/cli/classify-state.ts",
  "src/cli/learning-loop-index/command.ts",
  "src/cli/prompt/compose-quality-common.ts",
  "src/cli/server/hook-operation.ts",
];

// Any CLI command after a bare package name, in the shapes advice uses: code-quoted, or after run, rerun, running or use, with or
// without a colon. Prose such as "a goat-flow skill mirror" has neither shape, and a progress header such as `goat-flow install:`
// labels output, so neither is advice.
const BARE_COMMAND = new RegExp(
  `(?:\`|\\b(?:[Rr]e-?run|[Rr]un(?:ning)?|[Uu]se):?\\s+)goat-flow (?:${COMMANDS.join("|")})\\b(?!:)`,
  "u",
);

/**
 * List the TypeScript files under one advice source.
 *
 * @param path - repository-relative file or directory
 * @returns repository-relative paths of every `.ts` file at or under that path
 */
function sourceFiles(path: string): string[] {
  const absolute = join(PROJECT_ROOT, path);
  // A named file is checked as given; a directory contributes every TypeScript file beneath it.
  if (!statSync(absolute).isDirectory()) return [path];
  return readdirSync(absolute, { recursive: true, encoding: "utf8" })
    .filter((entry) => entry.endsWith(".ts"))
    .map((entry) => relative(PROJECT_ROOT, join(absolute, entry)));
}

/**
 * Find advice lines in one source that name the CLI without its release.
 *
 * @param path - repository-relative source file
 * @returns `path: line` entries for code lines with a bare command or `@latest`
 */
function unpinnedAdvice(path: string): string[] {
  return (
    readFileSync(join(PROJECT_ROOT, path), "utf8")
      .split("\n")
      .filter((line) => !/^\s*(?:\/\/|\*|\/\*)/u.test(line))
      // A removed-command notice names the old spelling on purpose; it is not advice to run it.
      .filter((line) => !/`goat-flow [^`]+` was removed/u.test(line))
      .filter((line) => BARE_COMMAND.test(line) || line.includes("@latest"))
      .map((line) => `${path}: ${line.trim()}`)
  );
}

describe("advised goat-flow commands", () => {
  it("pins the package to the running release", () => {
    assert.equal(
      pinnedGoatFlowCommand("setup"),
      `npx @blundergoat/goat-flow@${AUDIT_VERSION} setup`,
    );
  });

  it("never advises a bare or @latest command", () => {
    const offenders =
      ADVICE_SOURCES.flatMap(sourceFiles).flatMap(unpinnedAdvice);
    assert.deepEqual(offenders, []);
  });

  it("advises the pinned install command for an older project", () => {
    const check = SETUP_CHECKS.find((c) => c.id === "config-version");
    assert.ok(check, "config-version check must exist");
    const result = check.run(
      makeCtx({ config: stubConfig({ version: "0.1.0" }) }),
    );
    assert.ok(
      result?.howToFix?.includes(
        pinnedGoatFlowCommand("install . --agent <id> --update-config-version"),
      ),
      result?.howToFix,
    );
  });
});
