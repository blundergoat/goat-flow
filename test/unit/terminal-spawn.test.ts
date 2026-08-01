/**
 * Unit tests for terminal spawn specs and terminal input chunking.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

import {
  buildTerminalSpawnSpec,
  chunkTerminalInput,
} from "../../src/cli/server/terminal.js";

const QUOTED_MULTILINE_PROMPT = [
  "# GOAT Flow Setup - Codex",
  "",
  "No Codex configuration detected - this project needs a full setup.",
  "",
  'Do NOT copy customization templates verbatim. If a template says "[describe X]", describe X for THIS project.',
].join("\n");

describe("buildTerminalSpawnSpec", () => {
  it("keeps multiline prompts out of Windows PowerShell argv and env", () => {
    const spec = buildTerminalSpawnSpec(
      "claude",
      "C:\\Users\\dev\\AppData\\Roaming\\npm\\claude.cmd",
      QUOTED_MULTILINE_PROMPT,
      {},
      "win32",
    );

    assert.equal(spec.shell, "powershell.exe");
    assert.doesNotMatch(spec.args.join("\n"), /GOAT Flow Setup/);
    assert.doesNotMatch(spec.args.join("\n"), /\[describe X\]/);
    assert.equal(spec.env.GOAT_PROMPT, undefined);
    assert.ok(spec.initialInput);
    assert.match(spec.initialInput, /# GOAT Flow Setup - Codex/);
    assert.match(spec.initialInput, /\[describe X\]/);
    assert.ok(spec.initialInput.startsWith("\x1b[200~"));
    assert.ok(spec.initialInput.endsWith("\x1b[201~\r"));
  });

  it("keeps multiline prompts out of POSIX shell argv and env", () => {
    const spec = buildTerminalSpawnSpec(
      "claude",
      "/usr/local/bin/claude",
      QUOTED_MULTILINE_PROMPT,
      { SHELL: "/bin/zsh" },
      "linux",
    );

    assert.equal(spec.shell, "/bin/zsh");
    assert.doesNotMatch(spec.args.join("\n"), /GOAT Flow Setup/);
    assert.equal(spec.env.GOAT_PROMPT, undefined);
    assert.ok(spec.initialInput);
    assert.match(spec.initialInput, /No Codex configuration detected/);
    assert.match(spec.initialInput, /"\[describe X\]"/);
  });

  it("chunks long initial prompt input without adding extra paste markers", () => {
    const longPrompt = [
      "# GOAT Flow Setup - Codex",
      "",
      "A".repeat(7000),
      "",
      "Run both required setup gates.",
    ].join("\n");
    const spec = buildTerminalSpawnSpec(
      "claude",
      "/usr/local/bin/claude",
      longPrompt,
      { SHELL: "/bin/bash" },
      "linux",
    );

    assert.ok(spec.initialInput);
    const chunks = chunkTerminalInput(spec.initialInput, 512);
    const recombined = chunks.join("");

    assert.ok(chunks.length > 1, "expected a long prompt to be chunked");
    assert.equal(recombined, spec.initialInput);
    assert.equal(recombined.split("\x1b[200~").length - 1, 1);
    assert.equal(recombined.split("\x1b[201~").length - 1, 1);
    assert.ok(chunks[0]?.startsWith("\x1b[200~"));
    assert.ok(chunks.at(-1)?.endsWith("\x1b[201~\r"));
  });

  it("does not inject terminal input for manual sessions", () => {
    const spec = buildTerminalSpawnSpec(
      "claude",
      "/usr/local/bin/claude",
      "",
      { SHELL: "/bin/bash" },
      "linux",
    );

    assert.equal(spec.initialInput, null);
    assert.equal(spec.env.GOAT_PROMPT, undefined);
  });

  it("launches Claude reporting sessions with a restrictive settings overlay", () => {
    const spec = buildTerminalSpawnSpec(
      "claude",
      "/usr/local/bin/claude",
      "",
      { SHELL: "/bin/bash" },
      "linux",
      {
        accessMode: "reporting",
        projectPath: process.cwd(),
        targetPath: process.cwd(),
      },
    );

    const shellCommand = spec.args.join("\n");
    const rawSettings = spec.env.GOAT_CLAUDE_REPORTING_SETTINGS ?? "";
    assert.match(shellCommand, /--setting-sources=/);
    assert.match(shellCommand, /--settings "\$GOAT_CLAUDE_REPORTING_SETTINGS"/);
    assert.match(shellCommand, /--permission-mode dontAsk/);
    assert.doesNotMatch(shellCommand, /\|\|/);
    assert.ok(rawSettings.length > 0);

    const settings = JSON.parse(rawSettings) as {
      permissions: {
        defaultMode: string;
        disableBypassPermissionsMode: string;
        additionalDirectories: string[];
        allow: string[];
        deny: string[];
      };
    };
    assert.equal(settings.permissions.defaultMode, "dontAsk");
    assert.equal(settings.permissions.disableBypassPermissionsMode, "disable");
    assert.deepStrictEqual(settings.permissions.additionalDirectories, []);
    assert.equal(settings.permissions.allow.includes("Read"), false);
    assert.equal(settings.permissions.allow.includes("Glob"), false);
    assert.equal(settings.permissions.allow.includes("Grep"), false);
    assert.equal(
      settings.permissions.allow.filter((rule) => rule.startsWith("Read("))
        .length,
      1,
    );
    assert.match(
      settings.permissions.allow.find((rule) => rule.startsWith("Read(")) ?? "",
      /^Read\(\/\/.+\/\*\*\)$/u,
    );
    // ADR-044: persistence is dashboard-owned, so NO saver or source-CLI Bash
    // rules remain.
    assert.deepStrictEqual(
      settings.permissions.allow.filter((rule) => rule.startsWith("Bash")),
      [],
    );
    assert.equal(
      settings.permissions.allow.some(
        (rule) =>
          rule === "Bash" ||
          rule === "Bash(*)" ||
          /Bash\((?:node|goat-flow) \*\)/u.test(rule) ||
          /quality save/u.test(rule),
      ),
      false,
    );
    assert.ok(
      settings.permissions.allow.some((rule) =>
        /Edit\(\/\/.*\/\.goat-flow\/logs\/\*\*\)/.test(rule),
      ),
    );
    assert.ok(
      settings.permissions.deny.some((rule) =>
        /Edit\(\/\/.*\/\.goat-flow\/logs\/quality\/README\.md\)/.test(rule),
      ),
    );
    // Finalized reports are server-written; the single-level `*.json` deny
    // must protect them while leaving the staging/ subdirectory writable.
    assert.ok(
      settings.permissions.deny.some((rule) =>
        /Edit\(\/\/.*\/\.goat-flow\/logs\/quality\/\*\.json\)/.test(rule),
      ),
    );
    assert.ok(
      settings.permissions.deny.some((rule) =>
        /Read\(\/\/.*\/\*\*\/\.env\)/.test(rule),
      ),
    );
    assert.ok(settings.permissions.deny.includes("Read(~/.ssh/**)"));
    assert.ok(
      settings.permissions.deny.includes("Read(~/.claude/.credentials.json)"),
    );

    const windowsSpec = buildTerminalSpawnSpec(
      "claude",
      "C:\\Users\\dev\\AppData\\Roaming\\npm\\claude.cmd",
      "",
      {},
      "win32",
      {
        accessMode: "reporting",
        projectPath: process.cwd(),
        targetPath: process.cwd(),
      },
    );
    const windowsCommand = windowsSpec.args.join("\n");
    assert.match(windowsCommand, /--setting-sources=/);
    assert.match(
      windowsCommand,
      /--settings \$env:GOAT_CLAUDE_REPORTING_SETTINGS/,
    );
    assert.match(windowsCommand, /--permission-mode dontAsk/);
    assert.match(
      windowsCommand,
      /Remove-Item Env:GOAT_CLAUDE_REPORTING_SETTINGS/,
    );
  });

  it("denies credentials under the active Claude config directory", () => {
    const tempRoot = mkdtempSync(
      join(tmpdir(), "goat-terminal-claude-config-"),
    );
    const configDirectory = join(tempRoot, "claude-config");
    try {
      mkdirSync(configDirectory);
      const spec = buildTerminalSpawnSpec(
        "claude",
        "/usr/local/bin/claude",
        "",
        {
          SHELL: "/bin/bash",
          CLAUDE_CONFIG_DIR: configDirectory,
        },
        "linux",
        {
          accessMode: "reporting",
          projectPath: process.cwd(),
          targetPath: process.cwd(),
        },
      );

      const settings = JSON.parse(
        spec.env.GOAT_CLAUDE_REPORTING_SETTINGS ?? "",
      ) as { permissions: { deny: string[] } };
      assert.ok(
        settings.permissions.deny.some((rule) =>
          /^Read\(\/\/.*\/claude-config\/\.credentials\.json\)$/u.test(rule),
        ),
      );
      assert.ok(
        settings.permissions.deny.some((rule) =>
          /^Edit\(\/\/.*\/claude-config\/\.credentials\.json\)$/u.test(rule),
        ),
      );
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("keeps ordinary Claude terminals free of reporting restrictions", () => {
    const spec = buildTerminalSpawnSpec(
      "claude",
      "/usr/local/bin/claude",
      "",
      { SHELL: "/bin/bash" },
      "linux",
    );

    const shellCommand = spec.args.join("\n");
    assert.doesNotMatch(shellCommand, /--setting-sources/);
    assert.doesNotMatch(shellCommand, /--permission-mode dontAsk/);
    assert.equal(spec.env.GOAT_CLAUDE_REPORTING_SETTINGS, undefined);
  });

  it("launches Codex reporting sessions with a restricted permission profile", () => {
    const spec = buildTerminalSpawnSpec(
      "codex",
      "/usr/local/bin/codex",
      "",
      { SHELL: "/bin/bash" },
      "linux",
      {
        accessMode: "reporting",
        projectPath: process.cwd(),
        targetPath: process.cwd(),
      },
    );

    const shellCommand = spec.args.join("\n");
    const profile = spec.env.GOAT_CODEX_REPORTING_PROFILE ?? "";
    assert.doesNotMatch(shellCommand, /--sandbox danger-full-access/);
    assert.match(shellCommand, /--ask-for-approval never/);
    assert.match(shellCommand, /GOAT_CODEX_REPORTING_PROFILE/);
    assert.match(shellCommand, /default_permissions/);
    assert.match(profile, /extends=":read-only"/);
    assert.ok(profile.includes(`${JSON.stringify(process.cwd())}=true`));
    assert.match(profile, /"\.goat-flow\/logs"="write"/);
    assert.match(profile, /"\.goat-flow\/logs\/quality\/README\.md"="read"/);
    assert.match(profile, /"\*\*\/\.env"="deny"/);
  });

  it("grants build-directory writes only when Git proves they are ignored", () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "goat-terminal-ignored-root-"));
    try {
      mkdirSync(join(tempRoot, "dist"), { recursive: true });
      mkdirSync(join(tempRoot, ".goat-flow", "plans"), { recursive: true });
      writeFileSync(
        join(tempRoot, ".goat-flow", "plans", "README.md"),
        "# Plans\n",
      );
      writeFileSync(join(tempRoot, ".gitignore"), "dist/\n");
      execFileSync("git", ["-C", tempRoot, "init", "--quiet"]);
      execFileSync("git", ["-C", tempRoot, "add", ".gitignore"]);

      const spec = buildTerminalSpawnSpec(
        "codex",
        "/usr/local/bin/codex",
        "",
        { SHELL: "/bin/bash" },
        "linux",
        {
          accessMode: "reporting",
          projectPath: tempRoot,
          targetPath: tempRoot,
        },
      );

      const profile = spec.env.GOAT_CODEX_REPORTING_PROFILE ?? "";
      assert.match(profile, /"dist"="write"/);
      assert.doesNotMatch(profile, /"build"="write"/);
      assert.match(profile, /"\.goat-flow\/plans\/README\.md"="read"/);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("omits shared write roots when their protected layouts differ", () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "goat-terminal-profile-"));
    const controllerPath = join(tempRoot, "controller");
    const targetPath = join(tempRoot, "target");
    try {
      for (const rootPath of [controllerPath, targetPath]) {
        mkdirSync(join(rootPath, ".goat-flow/logs/quality"), {
          recursive: true,
        });
        mkdirSync(join(rootPath, "dist"), { recursive: true });
        writeFileSync(join(rootPath, ".gitignore"), "dist/\n");
        writeFileSync(join(rootPath, "dist/local.txt"), "ignored\n");
        execFileSync("git", ["-C", rootPath, "init", "--quiet"]);
        execFileSync("git", ["-C", rootPath, "add", ".gitignore"]);
      }
      writeFileSync(
        join(controllerPath, ".goat-flow/logs/quality/custom.md"),
        "tracked\n",
      );
      execFileSync("git", [
        "-C",
        controllerPath,
        "add",
        ".goat-flow/logs/quality/custom.md",
      ]);

      const spec = buildTerminalSpawnSpec(
        "codex",
        "/usr/local/bin/codex",
        "",
        { SHELL: "/bin/bash" },
        "linux",
        {
          accessMode: "reporting",
          projectPath: controllerPath,
          targetPath,
        },
      );

      const profile = spec.env.GOAT_CODEX_REPORTING_PROFILE ?? "";
      assert.doesNotMatch(profile, /"\.goat-flow\/logs"="write"/);
      assert.match(profile, /"dist"="write"/);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it(
    "omits write roots whose parent symlink escapes the project",
    { skip: process.platform === "win32" },
    () => {
      const tempRoot = mkdtempSync(join(tmpdir(), "goat-terminal-symlink-"));
      const projectPath = join(tempRoot, "project");
      const outsidePath = join(tempRoot, "outside");
      try {
        mkdirSync(projectPath);
        mkdirSync(join(outsidePath, "logs"), { recursive: true });
        symlinkSync(outsidePath, join(projectPath, ".goat-flow"), "dir");

        const claudeSpec = buildTerminalSpawnSpec(
          "claude",
          "/usr/local/bin/claude",
          "",
          { SHELL: "/bin/bash" },
          "linux",
          {
            accessMode: "reporting",
            projectPath,
            targetPath: projectPath,
          },
        );
        const claudeSettings = JSON.parse(
          claudeSpec.env.GOAT_CLAUDE_REPORTING_SETTINGS ?? "",
        ) as { permissions: { allow: string[] } };
        assert.equal(
          claudeSettings.permissions.allow.some(
            (rule) =>
              rule.startsWith("Edit(") && rule.includes(".goat-flow/logs"),
          ),
          false,
        );

        const codexSpec = buildTerminalSpawnSpec(
          "codex",
          "/usr/local/bin/codex",
          "",
          { SHELL: "/bin/bash" },
          "linux",
          {
            accessMode: "reporting",
            projectPath,
            targetPath: projectPath,
          },
        );
        assert.doesNotMatch(
          codexSpec.env.GOAT_CODEX_REPORTING_PROFILE ?? "",
          /"\.goat-flow\/logs"="write"/u,
        );
      } finally {
        rmSync(tempRoot, { recursive: true, force: true });
      }
    },
  );

  it("keeps ordinary Codex terminals on the write-enabled dashboard profile", () => {
    const spec = buildTerminalSpawnSpec(
      "codex",
      "/usr/local/bin/codex",
      "",
      { SHELL: "/bin/bash" },
      "linux",
    );

    assert.match(spec.args.join("\n"), /--sandbox danger-full-access/);
    assert.equal(spec.env.GOAT_CODEX_REPORTING_PROFILE, undefined);
  });
});
