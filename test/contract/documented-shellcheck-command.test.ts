/**
 * Verify the shell-lint command agents receive in CLAUDE.md, AGENTS.md and .github/copilot-instructions.md.
 * A developer sees these fail in npm test when an instruction file drifts from what preflight and CI actually check.
 *
 * Preflight owns actual shell linting; these contracts protect the published command's syntax and scope:
 * - every instruction file publishes the same complete command, and shellcheck is installed to verify it;
 * - documented and automated commands exclude only SC2001;
 * - on Windows Git Bash, scripts/setup-initial.sh installs shellcheck per user through winget and explains a stale PATH;
 * - preflight lints only the scripts/ shell groups, every syntax owner calls the shared helper, and CI keeps running preflight.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Repository root, resolved from this file so the tests read the same files whichever directory npm test starts from.
const PROJECT_ROOT = resolve(
  fileURLToPath(new URL(".", import.meta.url)),
  "../..",
);

// Instruction surfaces that publish the aggregate shell-lint command to agents.
const INSTRUCTION_FILES = [
  "CLAUDE.md",
  "AGENTS.md",
  ".github/copilot-instructions.md",
] as const;

// Files that define shell lint for automated checks: the lint toolchain in the goat-flow config and the preflight script.
const AUTOMATED_SHELL_VALIDATION_OWNERS = [
  ".goat-flow/config.yaml",
  "scripts/preflight-checks.sh",
] as const;

// CI runs shell lint through preflight rather than a step of its own.
const CI_WORKFLOW = ".github/workflows/ci.yml";

// The shared helper that runs bash -n over every script in scripts/, scripts/maintenance/ and scripts/installers/.
const SHELL_SYNTAX_HELPER = "scripts/maintenance/check-shell-syntax.sh";

/**
 * Reads the shellcheck line a developer or coding agent would copy from one instruction file; throws when that file is missing.
 * The parity and syntax-helper tests use it so each failure names the file that drifted.
 *
 * @param surface - repository-relative instruction file
 * @returns the published command, trimmed; empty when the surface publishes none, which leaves that agent without a lint command
 */
function publishedShellcheckCommand(surface: string): string {
  const content = readFileSync(resolve(PROJECT_ROOT, surface), "utf8");
  // Prose that merely mentions shellcheck is skipped; only the first line that starts with the command counts.
  const line = content
    .split("\n")
    .find((candidate) => candidate.trimStart().startsWith("shellcheck "));
  // An absent published command becomes an empty result so the caller can name the incomplete instruction file.
  return line?.trim() ?? "";
}

describe("documented shell-lint command", () => {
  // Fails when one instruction file lacks or changes the shellcheck line, when all of them change it together, or when shellcheck is not installed.
  // It reads each instruction file and spawns shellcheck --version to prove the analyzer is installed.
  it("is published identically on every instruction surface", () => {
    const publishedCommands = INSTRUCTION_FILES.map((surface) => ({
      surface,
      command: publishedShellcheckCommand(surface),
    }));

    // Each agent reads only its own instruction file, so a file with no shellcheck line leaves that agent without a lint command.
    for (const { surface, command } of publishedCommands) {
      assert.ok(command.length > 0, `${surface}: publishes no shellcheck line`);
    }
    const [first, ...rest] = publishedCommands;
    // Parity alone cannot catch a broken command copied to every instruction surface.
    assert.equal(
      first.command,
      [
        "shellcheck --exclude=SC2001",
        "scripts/*.sh",
        "scripts/maintenance/*.sh",
        "scripts/installers/*.sh",
      ].join(" "),
      `${first.surface}: published shell-lint command has invalid syntax or scope`,
    );
    const probe = spawnSync("shellcheck", ["--version"], { encoding: "utf8" });
    // Preflight warns when the analyzer is absent; missing lint coverage must still fail this contract.
    //
    // For example, a developer on a new machine who skipped scripts/setup-initial.sh lands here.
    // A managed sandbox can attach EPERM to a run that still exited 0 with no signal, so that run still counts as installed.
    if (
      probe.status !== 0 ||
      probe.signal !== null ||
      (probe.error && !("code" in probe.error && probe.error.code === "EPERM"))
    ) {
      assert.fail(
        "shellcheck is not installed, so the documented command cannot be verified; install it (scripts/setup-initial.sh) and re-run",
      );
    }
    // Compare each remaining instruction file with the first so agents receive the same validation scope.
    for (const other of rest) {
      assert.equal(
        other.command,
        first.command,
        `${other.surface} publishes a different shell-lint command than ${first.surface}`,
      );
    }
  });

  // Fails when a shellcheck command in an instruction file, .goat-flow/config.yaml or preflight drops SC2001 or excludes anything else.
  // It also fails when one of those files no longer has a line the shellcheck pattern below recognises.
  it("uses only the existing CI exclusion across documented and automated commands", () => {
    // Read the instruction files a developer copies from alongside the config and preflight script that run lint for them.
    for (const surface of [
      ...INSTRUCTION_FILES,
      ...AUTOMATED_SHELL_VALIDATION_OWNERS,
    ]) {
      const content = readFileSync(resolve(PROJECT_ROOT, surface), "utf8");
      // Keep lines that run shellcheck with an option or on project paths, skipping prose that merely mentions the tool.
      const commands = content
        .split("\n")
        .filter((line) =>
          /\bshellcheck\s+(?:--|scripts\/|\$hookdir\/)/u.test(line),
        );
      // No matching line means the command was moved or reworded, and the exclusion check below would pass without inspecting anything.
      assert.ok(commands.length > 0, surface);
      // Each command must carry exactly one exclusion, SC2001, so the copied command and preflight hide the same warnings.
      for (const command of commands) {
        assert.deepEqual(
          command.match(/--exclude(?:=|\s+)\S+/gu),
          ["--exclude=SC2001"],
          `${surface}: ${command}`,
        );
      }
    }
  });

  // Fails when preflight stops linting a repository script group, or lints a path outside scripts/ such as a retired Bash hook runtime.
  // It spawns Bash on the real check_shell section with a stub shellcheck that only records its arguments, so nothing is linted for real.
  it("lints the repository script groups and nothing outside scripts/", () => {
    const source = readFileSync(
      resolve(PROJECT_ROOT, "scripts/preflight-checks.sh"),
      "utf8",
    );
    const start = source.indexOf("\ncheck_shell() {");
    const end = source.indexOf("\ncheck_contracts() {", start);
    assert.ok(start >= 0 && end > start, "shell check section exists");

    // The stub prints each argument to descriptor 3, which survives the section's >/dev/null redirection.
    const result = spawnSync(
      "bash",
      [
        "-c",
        [
          "set -euo pipefail",
          "exec 3>&1",
          "section() { :; }; pass() { :; }",
          "fail() { exit 1; }; warn() { exit 1; }",
          'shellcheck() { printf "lint:%s\\n" "$@" >&3; }',
          source.slice(start, end),
          "check_shell",
        ].join("\n"),
      ],
      { cwd: PROJECT_ROOT, encoding: "utf8" },
    );
    assert.equal(result.status, 0, result.stderr);
    // Drop the --exclude option so only the linted file paths remain.
    const lintedFiles = result.stdout
      .trim()
      .split("\n")
      .filter((line) => !line.startsWith("lint:--"));
    // One file from each required group shows preflight still lints that group.
    for (const file of [
      "scripts/preflight-checks.sh",
      "scripts/maintenance/check-shell-syntax.sh",
      "scripts/installers/install-claude.sh",
    ]) {
      assert.ok(
        lintedFiles.includes(`lint:${file}`),
        `${file}: omitted from preflight shellcheck`,
      );
    }
    // A path outside scripts/ means preflight lints a file the instruction files do not publish.
    assert.deepEqual(
      lintedFiles.filter((line) => !line.startsWith("lint:scripts/")),
      [],
      "preflight shellcheck reaches outside scripts/",
    );
  });

  // A Windows developer reaches this step by running bash scripts/setup-initial.sh in Git Bash without shellcheck installed.
  //
  // Fails when that step stops installing shellcheck for the current user through winget or drops the advice to reopen Git Bash.
  // It reads the setup script and spawns bash on that step alone with a fake winget, so nothing is installed.
  it("uses user-scoped winget on Windows and explains a stale shell PATH", () => {
    const setupScript = readFileSync(
      resolve(PROJECT_ROOT, "scripts/setup-initial.sh"),
      "utf8",
    );
    // Step 5 of the setup script installs shellcheck; the fixture below runs that step alone.
    const installSection = setupScript.slice(
      setupScript.indexOf("# 5. Install shellcheck"),
      setupScript.indexOf("# 6. Ensure scripts"),
    );
    // An empty section means a step heading was renamed or reordered, and the fixture would run no install step.
    assert.ok(installSection.length > 0);
    // Exercise only dependency setup; the package manager is a test double, so no software is installed.
    //
    // OSTYPE=msys and the winget.exe double pick the Windows branch; apt-get and brew are hidden so a skipped branch cannot reach a real installer.
    // Hidden shellcheck makes the step run and still looks missing after the fake install, which triggers the stale-PATH advice asserted below.
    const fixture = [
      "set -euo pipefail",
      "OSTYPE=msys",
      'info() { printf "%s\\n" "$1"; }',
      'warn() { printf "%s\\n" "$1"; }',
      'winget.exe() { printf "winget-arg:%s\\n" "$@"; }',
      'command() { case "$*" in "-v shellcheck"|"-v apt-get"|"-v brew") return 1;; esac; builtin command "$@"; }',
      installSection,
    ].join("\n");
    // Pass the fixed script as an argument so the fixture does not wait for pipe EOF.
    const result = spawnSync("bash", ["-c", fixture], {
      cwd: PROJECT_ROOT,
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr);
    // The winget double prints one argument per line, so each flag and its value sit on adjacent lines: the package id, then the per-user scope.
    // The last match is the setup step's own warning to open a new Git Bash session, printed because shellcheck still looks missing.
    assert.match(
      result.stdout,
      /winget-arg:--id\nwinget-arg:koalaman\.shellcheck/u,
    );
    assert.match(result.stdout, /winget-arg:--scope\nwinget-arg:user/u);
    assert.match(result.stdout, /Open a new Git Bash session/u);
  });

  // Fails when an instruction file, .goat-flow/config.yaml or preflight stops calling the shared syntax helper, an instruction file runs its own
  // bash -n list, or CI stops running preflight.
  it("keeps every shell syntax owner on the shared helper", () => {
    // Each instruction file must run syntax checks through the shared helper, never its own bash -n list that could drift.
    for (const surface of INSTRUCTION_FILES) {
      const content = readFileSync(resolve(PROJECT_ROOT, surface), "utf8");
      assert.ok(content.includes(`\nbash ${SHELL_SYNTAX_HELPER}\n`), surface);
      assert.doesNotMatch(content, /^bash -n .+\.sh\s+.+\.sh/mu, surface);
    }

    // Automated checks must call the same helper the instruction files publish.
    for (const surface of AUTOMATED_SHELL_VALIDATION_OWNERS) {
      const content = readFileSync(resolve(PROJECT_ROOT, surface), "utf8");
      assert.ok(content.includes(`bash ${SHELL_SYNTAX_HELPER}`), surface);
    }
    // Without the preflight step, CI would lint no shell scripts at all.
    assert.ok(
      readFileSync(resolve(PROJECT_ROOT, CI_WORKFLOW), "utf8").includes(
        "bash scripts/preflight-checks.sh",
      ),
      `${CI_WORKFLOW}: CI must run the preflight that owns shell lint`,
    );
  });
});
