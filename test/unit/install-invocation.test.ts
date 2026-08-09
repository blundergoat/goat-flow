/**
 * Unit tests for cross-platform installer invocation.
 *
 * Host-independent: every test passes `platform` and `windowsBashCandidates`
 * explicitly so the suite runs identically on Linux/macOS CI and on Windows.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as installerInvocationModule from "../../src/cli/install-invocation.js";
import {
  buildInstallerInvocation,
  buildInstallerSpawnSpec,
  buildWindowsBashMissingMessage,
  discoverWindowsBashCandidates,
  isWslBashPath,
  pickWindowsBashPath,
  toBashPath,
} from "../../src/cli/install-invocation.js";

const windowsWhereExecutablePath = (
  installerInvocationModule as typeof installerInvocationModule & {
    windowsWhereExecutablePath?: (
      environment: NodeJS.ProcessEnv,
    ) => string | null;
  }
).windowsWhereExecutablePath;

describe("discoverWindowsBashCandidates", () => {
  /** Proves setup never resolves its PATH lookup utility from the user's selected project. */
  it("resolves Windows PATH lookup from the system root", () => {
    assert.equal(typeof windowsWhereExecutablePath, "function");
    assert.equal(
      windowsWhereExecutablePath?.({ SystemRoot: "D:\\Windows" }),
      "D:\\Windows\\System32\\where.exe",
    );
    // Missing host context means setup skips PATH lookup and tries known Git locations.
    assert.equal(windowsWhereExecutablePath?.({}), null);
  });

  /** Proves setup can find the default Git Bash even when PATH offers only WSL. */
  it("finds a default Git for Windows install when PATH exposes only WSL", () => {
    const defaultGitBash = "C:\\Program Files\\Git\\bin\\bash.exe";
    const candidates = discoverWindowsBashCandidates({
      environment: { ProgramFiles: "C:\\Program Files" },
      pathExists: (candidate) => candidate === defaultGitBash,
      runWhere: (executable) =>
        executable === "bash" ? ["C:\\Windows\\System32\\bash.exe"] : [],
    });

    assert.deepEqual(candidates, [
      "C:\\Windows\\System32\\bash.exe",
      defaultGitBash,
    ]);
    assert.equal(pickWindowsBashPath(candidates), defaultGitBash);
  });

  /** Proves a visible git.exe can lead setup to its sibling Bash executable. */
  it("derives Git Bash from a git.exe in Git for Windows cmd", () => {
    const derivedGitBash = "C:\\Tools\\Git\\bin\\bash.exe";
    const candidates = discoverWindowsBashCandidates({
      environment: {},
      pathExists: (candidate) => candidate === derivedGitBash,
      runWhere: (executable) =>
        executable === "git" ? ["C:\\Tools\\Git\\cmd\\git.exe"] : [],
    });

    assert.deepEqual(candidates, [derivedGitBash]);
  });
});

describe("toBashPath", () => {
  it("leaves POSIX paths unchanged", () => {
    assert.equal(
      toBashPath("/home/user/project"),
      "/home/user/project",
      "POSIX path should pass through byte-for-byte",
    );
  });

  it("converts drive-letter backslash paths to forward slashes", () => {
    assert.equal(
      toBashPath("C:\\Users\\me\\node_modules\\install.sh"),
      "C:/Users/me/node_modules/install.sh",
    );
  });

  it("converts UNC backslash paths to leading double-slash form", () => {
    assert.equal(
      toBashPath("\\\\server\\share\\path\\install.sh"),
      "//server/share/path/install.sh",
    );
  });

  it("normalises mixed-slash inputs without re-introducing backslashes", () => {
    assert.equal(toBashPath("C:\\Users/me\\project"), "C:/Users/me/project");
  });
});

describe("isWslBashPath", () => {
  it("flags the System32 WSL launcher", () => {
    assert.equal(isWslBashPath("C:\\Windows\\System32\\bash.exe"), true);
  });

  it("flags the WindowsApps WSL proxy", () => {
    assert.equal(
      isWslBashPath(
        "C:\\Users\\me\\AppData\\Local\\Microsoft\\WindowsApps\\bash.exe",
      ),
      true,
    );
  });

  it("is case-insensitive on the WSL paths", () => {
    assert.equal(isWslBashPath("c:\\windows\\system32\\BASH.EXE"), true);
  });

  it("treats forward-slash forms of the same locations as WSL", () => {
    assert.equal(isWslBashPath("C:/Windows/System32/bash.exe"), true);
  });

  it("does not flag Git Bash", () => {
    assert.equal(isWslBashPath("C:\\Program Files\\Git\\bin\\bash.exe"), false);
  });

  it("does not flag MSYS2 bash", () => {
    assert.equal(isWslBashPath("C:\\msys64\\usr\\bin\\bash.exe"), false);
  });

  it("does not flag a user-scoped Git install", () => {
    assert.equal(
      isWslBashPath(
        "C:\\Users\\me\\AppData\\Local\\Programs\\Git\\bin\\bash.exe",
      ),
      false,
    );
  });
});

describe("pickWindowsBashPath", () => {
  it("returns null for an empty candidate list", () => {
    assert.equal(pickWindowsBashPath([]), null);
  });

  it("picks the first non-WSL candidate", () => {
    const result = pickWindowsBashPath([
      "C:\\Program Files\\Git\\bin\\bash.exe",
      "C:\\Windows\\System32\\bash.exe",
    ]);
    assert.equal(result, "C:\\Program Files\\Git\\bin\\bash.exe");
  });

  it("skips WSL even when listed first", () => {
    const result = pickWindowsBashPath([
      "C:\\Windows\\System32\\bash.exe",
      "C:\\Users\\me\\AppData\\Local\\Microsoft\\WindowsApps\\bash.exe",
      "C:\\Program Files\\Git\\bin\\bash.exe",
    ]);
    assert.equal(result, "C:\\Program Files\\Git\\bin\\bash.exe");
  });

  it("accepts MSYS2 when Git Bash is absent", () => {
    const result = pickWindowsBashPath([
      "C:\\Windows\\System32\\bash.exe",
      "C:\\msys64\\usr\\bin\\bash.exe",
    ]);
    assert.equal(result, "C:\\msys64\\usr\\bin\\bash.exe");
  });

  it("returns null when every candidate is WSL", () => {
    const result = pickWindowsBashPath([
      "C:\\Windows\\System32\\bash.exe",
      "C:\\Users\\me\\AppData\\Local\\Microsoft\\WindowsApps\\bash.exe",
    ]);
    assert.equal(result, null);
  });

  it("de-duplicates candidates before selecting", () => {
    const result = pickWindowsBashPath([
      "C:\\Program Files\\Git\\bin\\bash.exe",
      "C:\\Program Files\\Git\\bin\\bash.exe",
    ]);
    assert.equal(result, "C:\\Program Files\\Git\\bin\\bash.exe");
  });

  it("trims whitespace from candidates", () => {
    const result = pickWindowsBashPath([
      "  C:\\Program Files\\Git\\bin\\bash.exe  ",
      "",
    ]);
    assert.equal(result, "C:\\Program Files\\Git\\bin\\bash.exe");
  });
});

describe("buildWindowsBashMissingMessage", () => {
  it("mentions Git for Windows and WSL /mnt/c fallback", () => {
    const message = buildWindowsBashMissingMessage([]);
    assert.match(message, /Git for Windows/);
    assert.match(message, /\/mnt\/c\//);
  });

  it("lists the rejected WSL candidates so the user can see why", () => {
    const message = buildWindowsBashMissingMessage([
      "C:\\Windows\\System32\\bash.exe",
      "C:\\Users\\me\\AppData\\Local\\Microsoft\\WindowsApps\\bash.exe",
    ]);
    assert.match(message, /System32\\bash\.exe/);
    assert.match(message, /WindowsApps\\bash\.exe/);
  });
});

describe("buildInstallerInvocation on POSIX", () => {
  const baseParams = {
    scriptPath:
      "/usr/lib/node_modules/@blundergoat/goat-flow/workflow/install-goat-flow.sh",
    projectPath: "/home/user/project",
    agent: "claude",
    installerFlags: ["--force"] as const,
  };

  it("uses bare `bash` on linux", () => {
    const result = buildInstallerInvocation({
      ...baseParams,
      platform: "linux",
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.bashCommand, "bash");
  });

  it("preserves POSIX arguments byte-for-byte on linux", () => {
    const result = buildInstallerInvocation({
      ...baseParams,
      platform: "linux",
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.deepEqual(result.args, [
      "/usr/lib/node_modules/@blundergoat/goat-flow/workflow/install-goat-flow.sh",
      "/home/user/project",
      "--agent",
      "claude",
      "--force",
    ]);
  });

  it("preserves POSIX arguments byte-for-byte on darwin", () => {
    const result = buildInstallerInvocation({
      ...baseParams,
      installerFlags: [],
      platform: "darwin",
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.bashCommand, "bash");
    assert.deepEqual(result.args, [
      "/usr/lib/node_modules/@blundergoat/goat-flow/workflow/install-goat-flow.sh",
      "/home/user/project",
      "--agent",
      "claude",
    ]);
  });

  it("does not inspect bash candidates on POSIX", () => {
    // Even if a caller accidentally passed WSL-shaped candidates, POSIX must
    // ignore them and use bare `bash` from PATH.
    const result = buildInstallerInvocation({
      ...baseParams,
      platform: "linux",
      windowsBashCandidates: ["C:\\Windows\\System32\\bash.exe"],
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.bashCommand, "bash");
  });
});

describe("buildInstallerInvocation on win32", () => {
  const baseParams = {
    scriptPath:
      "C:\\Users\\thatm\\AppData\\Roaming\\npm-cache\\_npx\\xyz\\node_modules\\@blundergoat\\goat-flow\\workflow\\install-goat-flow.sh",
    projectPath: "C:\\Users\\thatm\\projects\\demo",
    agent: "claude",
    installerFlags: [] as readonly string[],
    platform: "win32" as const,
  };

  it("selects the non-WSL bash candidate", () => {
    const result = buildInstallerInvocation({
      ...baseParams,
      windowsBashCandidates: [
        "C:\\Windows\\System32\\bash.exe",
        "C:\\Program Files\\Git\\bin\\bash.exe",
      ],
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.bashCommand, "C:\\Program Files\\Git\\bin\\bash.exe");
  });

  it("uses the selected Windows Bash as the spawn command", () => {
    const result = buildInstallerInvocation({
      ...baseParams,
      windowsBashCandidates: ["C:\\Program Files\\Git\\bin\\bash.exe"],
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    const spawnSpec = buildInstallerSpawnSpec(result, {
      PATH: "C:\\Windows\\System32",
    });
    assert.equal(spawnSpec.command, "C:\\Program Files\\Git\\bin\\bash.exe");
    assert.deepEqual(spawnSpec.args, result.args);
    assert.match(spawnSpec.env.PATH ?? "", /^C:\\Program Files\\Git\\bin[;:]/u);
  });

  it("normalises scriptPath and projectPath to forward slashes", () => {
    const result = buildInstallerInvocation({
      ...baseParams,
      windowsBashCandidates: ["C:\\Program Files\\Git\\bin\\bash.exe"],
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(
      result.args[0],
      "C:/Users/thatm/AppData/Roaming/npm-cache/_npx/xyz/node_modules/@blundergoat/goat-flow/workflow/install-goat-flow.sh",
      "scriptPath must be forward-slash so Bash does not eat \\U as an escape",
    );
    assert.equal(result.args[1], "C:/Users/thatm/projects/demo");
    assert.equal(result.args[2], "--agent");
    assert.equal(result.args[3], "claude");
  });

  it("handles UNC project paths", () => {
    const result = buildInstallerInvocation({
      ...baseParams,
      projectPath: "\\\\fileserver\\share\\team\\demo",
      windowsBashCandidates: ["C:\\Program Files\\Git\\bin\\bash.exe"],
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.args[1], "//fileserver/share/team/demo");
  });

  it("appends installer flags in order", () => {
    const result = buildInstallerInvocation({
      ...baseParams,
      installerFlags: ["--force", "--clean-deprecated"],
      windowsBashCandidates: ["C:\\Program Files\\Git\\bin\\bash.exe"],
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.deepEqual(result.args.slice(2), [
      "--agent",
      "claude",
      "--force",
      "--clean-deprecated",
    ]);
  });

  it("returns an actionable error when only WSL is available", () => {
    const result = buildInstallerInvocation({
      ...baseParams,
      windowsBashCandidates: [
        "C:\\Windows\\System32\\bash.exe",
        "C:\\Users\\me\\AppData\\Local\\Microsoft\\WindowsApps\\bash.exe",
      ],
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.match(result.error, /Git for Windows/);
    assert.match(result.error, /\/mnt\/c\//);
    assert.match(result.error, /System32\\bash\.exe/);
  });

  it("returns an actionable error when no candidates exist", () => {
    const result = buildInstallerInvocation({
      ...baseParams,
      windowsBashCandidates: [],
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.match(result.error, /Git for Windows/);
  });
});
