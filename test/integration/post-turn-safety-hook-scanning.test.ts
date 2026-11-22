/**
 * How the hook decides what to scan: dirty and staged states, ignored files, binary and
 * oversized content, renames - and the batched scanner's obligation to preserve per-line
 * semantics the shipped contract depends on.
 * Every case runs the real hook against a real git repository, so a pass means the shipped
 * scanner behaves as asserted, not a reimplementation of it.
 */
import { resolveExecutable } from "../helpers/restricted-consumer-env.js";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { hookTreeRoot } from "../helpers/hook-entrypoint.js";
import { symlinkTestOptions } from "../helpers/symlink-capability.js";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { describe, it } from "node:test";

import {
  HOOK_PATH,
  FORCE_BASH3_ENV_KEY,
  TEST_AWS_ACCESS_KEY,
  TEST_FINE_GRAINED_GITHUB_TOKEN,
  TEST_SHORT_GITHUB_TOKEN,
  TEST_SHORT_NPM_TOKEN,
  TEST_SLACK_TOKEN,
  TEST_API_TOKEN,
  withTempRepo,
  buildStopPayload,
  writeFile,
  runGit,
  commitAll,
  runHook,
  withCommandShim,
  withScannerFileFault,
  assertHookIncomplete,
  assertHookAllows,
  assertHookBlocks,
  TEST_CLIENT_SECRET,
  TEST_INI_PASSWORD,
  TEST_PRIVATE_KEY_HEADER,
  TEST_DOCUMENTED_SLACK_PLACEHOLDER,
  TEST_NPM_TOKEN,
  TEST_RSA_PRIVATE_KEY_BODY,
  TEST_RSA_PRIVATE_KEY_FOOTER,
  appendCommittedLine,
  stageAppendedLine,
} from "./post-turn-safety-hook.helpers.js";

let nonUtf8NameSkipReason: string | false | undefined;

/**
 * Write and remove one probe file to learn whether this filesystem accepts a name that is not valid UTF-8.
 *
 * @returns skip=false when such names work; otherwise the capability reason, such as APFS refusing the name
 * @throws Unexpected filesystem errors, such as a full temporary drive, rather than hiding them as capability skips
 */
function nonUtf8NameTestOptions(): { skip: string | false } {
  // Undefined means this runner has not probed yet; later cases reuse the result.
  if (nonUtf8NameSkipReason !== undefined)
    return { skip: nonUtf8NameSkipReason };
  // Native Windows paths are Unicode; byte names cannot represent this POSIX-only input.
  if (process.platform === "win32")
    return { skip: "Windows cannot represent non-UTF-8 byte file names" };
  const probeRoot = mkdtempSync(join(tmpdir(), "goat-non-utf8-name-"));
  try {
    writeFileSync(
      Buffer.concat([Buffer.from(`${probeRoot}/name`), Buffer.from([0xff])]),
      "probe\n",
    );
    nonUtf8NameSkipReason = false;
  } catch (error) {
    // Filesystems that require UTF-8 names refuse with EILSEQ or EINVAL; any other error is a real failure.
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "EILSEQ" && code !== "EINVAL") throw error;
    nonUtf8NameSkipReason = `filesystem refuses non-UTF-8 file names (${code})`;
  } finally {
    rmSync(probeRoot, { recursive: true, force: true });
  }
  return { skip: nonUtf8NameSkipReason };
}

describe("post-turn-safety hook: git states and batched scanning", () => {
  it("scans raw added content when a textconv driver hides the secret", () => {
    for (const staged of [false, true]) {
      withTempRepo((root) => {
        writeFile(root, ".gitattributes", "settings.env diff=hidden\n");
        writeFile(root, "settings.env", "safe=1\n");
        runGit(root, [
          "config",
          "diff.hidden.textconv",
          `${JSON.stringify(process.execPath)} -e "process.stdout.write('safe')"`,
        ]);
        commitAll(root, "textconv fixture");
        writeFile(root, "settings.env", `API_KEY=${TEST_API_TOKEN}\n`);
        if (staged) runGit(root, ["add", "settings.env"]);
        assertHookBlocks(root, /API token in settings\.env/u);
      });
    }
  });

  it(
    "scans a regular file replacing a tracked symlink",
    symlinkTestOptions(),
    () => {
      for (const staged of [false, true]) {
        withTempRepo((root) => {
          writeFile(root, "target.txt", "safe\n");
          symlinkSync("target.txt", join(root, "settings.env"));
          commitAll(root, "symlink fixture");
          unlinkSync(join(root, "settings.env"));
          writeFile(root, "settings.env", `API_KEY=${TEST_API_TOKEN}\n`);
          if (staged) runGit(root, ["add", "settings.env"]);
          assertHookBlocks(root, /API token in settings\.env/u);
        });
      }
    },
  );
  /** Confirm the scanner tells the user that declared coverage is incomplete.
   *
   * @param root - fixture repository with a path the hook cannot fully scan
   * @param env - optional fault controls; empty uses normal user commands
   * @returns nothing; a scanner that allows the turn fails the user contract
   */
  function assertIncompleteScan(
    root: string,
    env: Record<string, string> = {},
  ): void {
    assertHookIncomplete(root, { ...env, [FORCE_BASH3_ENV_KEY]: "0" });
  }

  describe("incomplete scan failures", () => {
    it("blocks when the repository root is unavailable", () => {
      const root = mkdtempSync(join(tmpdir(), "goat-flow-post-turn-no-git-"));
      try {
        assertIncompleteScan(root);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    });

    it("blocks when the reported repository root cannot be entered", () => {
      withTempRepo((root) => {
        withCommandShim(
          resolveExecutable("git"),
          {
            when: { prefix: ["rev-parse", "--show-toplevel"] },
            stdoutEnvironment: "GOAT_FLOW_TEST_MISSING_ROOT",
            status: 0,
          },
          (shimEnv) => {
            assertIncompleteScan(root, {
              ...shimEnv,
              GOAT_FLOW_TEST_MISSING_ROOT: join(root, "missing-root"),
            });
          },
        );
      });
    });

    it("blocks when Git cannot inventory untracked files", () => {
      withTempRepo((root) => {
        writeFile(root, "settings.env", "API_KEY=your_api_key_here\n");
        withCommandShim(
          resolveExecutable("git"),
          {
            when: {
              includes: ["ls-files", "--others", "--exclude-standard", "-z"],
            },
            status: 2,
          },
          (shimEnv) => {
            assertIncompleteScan(root, shimEnv);
          },
        );
      });
    });

    it("blocks when Git cannot produce a tracked diff", () => {
      withTempRepo((root) => {
        writeFile(root, "settings.env", "safe=1\n");
        commitAll(root, "add tracked diff fixture");
        writeFile(root, "settings.env", "safe=2\n");
        withCommandShim(
          resolveExecutable("git"),
          { when: { includes: ["diff", "--unified=0"] }, status: 2 },
          (shimEnv) => {
            assertIncompleteScan(root, shimEnv);
          },
        );
      });
    });

    it("blocks when a native candidate grep fails", () => {
      withTempRepo((root) => {
        writeFile(root, "settings.env", "safe=1\n");
        withScannerFileFault("readFileSync", (environment) =>
          assertIncompleteScan(root, environment),
        );
      });
    });

    it("blocks when the binary-content gate fails", () => {
      withTempRepo((root) => {
        writeFile(root, "settings.env", "safe=1\n");
        withScannerFileFault("readSync", (environment) =>
          assertIncompleteScan(root, environment),
        );
      });
    });

    it("blocks when byte counting fails", () => {
      withTempRepo((root) => {
        writeFile(root, "settings.env", "safe=1\n");
        withScannerFileFault("lstatSync", (environment) =>
          assertIncompleteScan(root, environment),
        );
      });
    });

    it("blocks when selected content disappears after byte counting", () => {
      withTempRepo((root) => {
        withScannerFileFault("vanish", (environment) => {
          writeFile(root, "settings.env", "safe=1\n");
          assertHookIncomplete(root, {
            ...environment,
            [FORCE_BASH3_ENV_KEY]: "0",
          });
        });
      });
    });

    it("blocks when changed-content coverage inventory fails", () => {
      withTempRepo((root) => {
        writeFile(root, "settings.env", "safe=1\n");
        commitAll(root, "add staged size fixture");
        writeFile(root, "settings.env", "safe=2\n");
        runGit(root, ["add", "settings.env"]);
        writeFile(root, "settings.env", "safe=1\n");
        // A failed Git coverage inventory means the user cannot be told every changed path was checked.
        withCommandShim(
          resolveExecutable("git"),
          { when: { includes: ["--numstat"] }, status: 2 },
          (shimEnv) => {
            assertIncompleteScan(root, shimEnv);
          },
        );
      });
    });
  });

  it("allows ignored env files that are not staged", () => {
    withTempRepo((root) => {
      writeFile(root, ".gitignore", ".env\n");
      commitAll(root, "ignore local env");
      writeFile(root, ".env", `AWS_ACCESS_KEY_ID=${TEST_AWS_ACCESS_KEY}\n`);

      assertHookAllows(root);
    });
  });

  it("blocks ignored env files once they are force-staged", () => {
    withTempRepo((root) => {
      writeFile(root, ".gitignore", ".env\n");
      commitAll(root, "ignore local env");
      writeFile(root, ".env", `AWS_ACCESS_KEY_ID=${TEST_AWS_ACCESS_KEY}\n`);
      runGit(root, ["add", "-f", ".env"]);

      assertHookBlocks(root, /AWS access key/u);
    });
  });

  it("does not block unchanged committed content", () => {
    withTempRepo((root) => {
      writeFile(
        root,
        "legacy.env",
        `AWS_ACCESS_KEY_ID=${TEST_AWS_ACCESS_KEY}\n`,
      );
      commitAll(root, "legacy committed content");

      assertHookAllows(root);
    });
  });

  // Fixture: writes untracked paths the scanner cannot read.
  // Reporting them as clean would tell a user their tree was checked when it was not.
  it("reports unscannable untracked paths as incomplete", () => {
    const fixtures = [
      {
        path: "binary.dat",
        content: Buffer.from([0, 1, 2]),
      },
      {
        path: "large.txt",
        content: `${"a".repeat(1024 * 1024 + 1)}\n${TEST_AWS_ACCESS_KEY}\n`,
      },
    ];
    // Each excluded path must block independently instead of borrowing the other's result.
    for (const fixture of fixtures) {
      withTempRepo((root) => {
        writeFile(root, fixture.path, fixture.content);
        assertIncompleteScan(root);
        if (fixture.path === "large.txt") {
          const first = runHook(
            root,
            {},
            buildStopPayload("large-file", false),
          );
          const repeated = runHook(
            root,
            {},
            buildStopPayload("large-file", true),
          );
          for (const result of [first, repeated]) {
            assert.equal(result.status, 2, result.stderr);
            assert.match(
              result.stderr,
              /large\.txt \(\d+ bytes; limit 1048576;/u,
            );
            assert.match(
              result.stderr,
              /review the file and raise GOAT_FLOW_POST_TURN_SAFETY_MAX_BYTES if appropriate/u,
            );
            assert.doesNotMatch(result.stderr, /ending repeated Stop/u);
          }
        }
      });
    }
  });

  it("allows rename and delete-only changes without content findings", () => {
    withTempRepo((root) => {
      writeFile(root, "old.txt", "safe\n");
      writeFile(root, "delete-me.txt", "safe\n");
      commitAll(root, "add files");
      runGit(root, ["mv", "old.txt", "new.txt"]);
      rmSync(join(root, "delete-me.txt"));

      assertHookAllows(root);
    });
  });

  // The batched scanner reads diffs and file contents through pre-filtering
  // greps instead of a per-line bash loop. Each case below pins a behaviour
  // that batching could silently change while the headline detectors still
  // pass: line bytes, path attribution, and diff-frame parsing.
  describe("batched scanning preserves per-line semantics", () => {
    // A Windows-edited conflict must block just like the same user's LF file; the fixture writes that CRLF file into a temporary repository.
    it("detects CRLF merge markers after normalizing the line ending", () => {
      withTempRepo((root) => {
        writeFile(
          root,
          "conflict.txt",
          "<<<<<<< HEAD\r\nleft\r\n=======\r\nright\r\n>>>>>>> branch\r\n",
        );
        assertHookBlocks(root, /merge conflict marker/u);
      });
    });

    it("still detects LF merge markers in the same shape", () => {
      withTempRepo((root) => {
        writeFile(
          root,
          "conflict.txt",
          "<<<<<<< HEAD\nleft\n=======\nright\n>>>>>>> branch\n",
        );

        assertHookBlocks(root, /merge conflict marker/u);
      });
    });

    it("attributes findings to paths that git reports quoted or with spaces", () => {
      withTempRepo((root) => {
        // Non-ASCII paths come back C-quoted from git unless quotepath is off,
        // and spaces break naive header splitting; both must resolve to the
        // real path in the finding message.
        writeFile(root, "café.env", "password=Zx9AbCdEf123456\n");
        writeFile(root, "my config.env", "password=Zx9AbCdEf654321\n");

        const result = assertHookBlocks(
          root,
          /credential assignment \(password\) in café\.env/u,
        );
        assert.match(
          result.stderr,
          /credential assignment \(password\) in my config\.env/u,
        );
      });
    });

    it("does not read added content as diff frame headers", () => {
      withTempRepo((root) => {
        // An untracked file whose own text mimics diff headers must still be
        // scanned as content, and must not retarget findings to a fake path.
        writeFile(
          root,
          "fake.txt",
          [
            "+++ b/somewhere.env",
            `+${TEST_AWS_ACCESS_KEY}`,
            "@@ -1,2 +3,4 @@",
            "",
          ].join("\n"),
        );

        const result = assertHookBlocks(root, /AWS access key in fake\.txt/u);
        assert.doesNotMatch(result.stderr, /somewhere\.env/u);
      });
    });

    it("keeps findings attributed per file across a batched diff", () => {
      withTempRepo((root) => {
        writeFile(root, "one.env", "safe=1\n");
        writeFile(root, "two.env", "safe=2\n");
        writeFile(root, "three.env", "safe=3\n");
        commitAll(root, "add env files");
        writeFile(
          root,
          "one.env",
          `safe=1\nAWS_ACCESS_KEY_ID=${TEST_AWS_ACCESS_KEY}\n`,
        );
        writeFile(root, "two.env", "safe=2\nharmless=value\n");
        writeFile(
          root,
          "three.env",
          `safe=3\nSLACK_BOT_TOKEN=${TEST_SLACK_TOKEN}\n`,
        );

        const result = assertHookBlocks(root, /AWS access key in one\.env/u);
        assert.match(result.stderr, /Slack token in three\.env/u);
        assert.doesNotMatch(result.stderr, /two\.env/u);
      });
    });
  });

  describe("scanner finding rules", () => {
    // Selects the scanner's native result variant, not the "fallback" label the switch can still request.
    const nativeScannerEnv = { [FORCE_BASH3_ENV_KEY]: "0" };

    /**
     * Confirms the Stop result and explanation the user receives for one fixture.
     *
     * @param root - non-empty fixture root the scanner inspects
     * @param expectedStatus - 0 allows the turn; 2 means the user sees a block
     * @param expectedPattern - optional explanation; absent checks the outcome only
     * @param env - optional scanner controls; empty uses normal user commands
     * @returns nothing; an unexpected outcome or explanation fails the active test
     */
    function assertScannerResult(
      root: string,
      expectedStatus: 0 | 2,
      expectedPattern?: RegExp,
      env: Record<string, string> = {},
    ): void {
      const result = runHook(root, {
        ...env,
        GOAT_FLOW_POST_TURN_SAFETY_FORCE_BASH3_FALLBACK: "0",
      });
      const diagnostics = `status=${result.status}\nstderr:\n${result.stderr}`;

      assert.equal(result.status, expectedStatus, diagnostics);
      if (expectedPattern) {
        assert.match(result.stderr, expectedPattern, diagnostics);
      }
    }

    it("blocks fine-grained GitHub tokens", () => {
      withTempRepo((root) => {
        writeFile(
          root,
          "tokens.env",
          `GITHUB_TOKEN=${TEST_FINE_GRAINED_GITHUB_TOKEN}\n`,
        );

        assertScannerResult(root, 2, /GitHub token/u);
      });
    });

    it("blocks a double-quoted credential terminated by a semicolon", () => {
      withTempRepo((root) => {
        writeFile(
          root,
          "deploy.sh",
          'export DB_PASSWORD="correct-horse-battery-staple";\n',
        );

        assertScannerResult(root, 2, /credential assignment/u);
      });
    });

    it("blocks a single-quoted credential terminated by a semicolon", () => {
      withTempRepo((root) => {
        writeFile(
          root,
          "deploy.sh",
          "export DB_PASSWORD='correct-horse-battery-staple';\n",
        );

        assertScannerResult(root, 2, /credential assignment/u);
      });
    });

    // Both common Git path shapes must decode to the file name the user recognizes.
    for (const path of ["space name.env", "café.env"]) {
      it(`decodes the Git diff header for ${path}`, () => {
        withTempRepo((root) => {
          writeFile(root, path, "safe=1\n");
          commitAll(root, `add ${path}`);
          writeFile(root, path, `OPENAI_API_KEY=${TEST_API_TOKEN}\n`);

          assertHookBlocks(root, new RegExp(`API token in ${path}`, "u"), {
            [FORCE_BASH3_ENV_KEY]: "0",
          });
        });
      });
    }

    it("pins mnemonic Git diff prefixes", () => {
      withTempRepo((root) => {
        writeFile(root, "mnemonic.env", "safe=1\n");
        commitAll(root, "add mnemonic prefix fixture");
        runGit(root, ["config", "diff.mnemonicPrefix", "true"]);
        writeFile(root, "mnemonic.env", `API_KEY=${TEST_API_TOKEN}\n`);

        assertScannerResult(root, 2, /API token in mnemonic\.env/u);
      });
    });

    it("pins custom Git diff source and destination prefixes", () => {
      withTempRepo((root) => {
        writeFile(root, "custom.env", "safe=1\n");
        commitAll(root, "add custom prefix fixture");
        runGit(root, ["config", "diff.srcPrefix", "before/"]);
        runGit(root, ["config", "diff.dstPrefix", "after/"]);
        writeFile(root, "custom.env", `API_KEY=${TEST_API_TOKEN}\n`);

        assertScannerResult(root, 2, /API token in custom\.env/u);
      });
    });

    it("combines staged and unstaged conflict-marker state", () => {
      withTempRepo((root) => {
        writeFile(root, "conflict.txt", "safe\n");
        commitAll(root, "add conflict fixture");
        writeFile(root, "conflict.txt", "<<<<<<< HEAD\nleft\n=======\n");
        runGit(root, ["add", "conflict.txt"]);
        writeFile(
          root,
          "conflict.txt",
          "<<<<<<< HEAD\nleft\n=======\nright\n>>>>>>> branch\n",
        );

        assertScannerResult(root, 2, /merge conflict marker/u);
      });
    });

    it("does not let added content impersonate a diff header", () => {
      withTempRepo((root) => {
        writeFile(root, "conflict.txt", "safe\n");
        commitAll(root, "add fallback frame fixture");
        writeFile(
          root,
          "conflict.txt",
          [
            "safe",
            "++ b/nonexistent.env",
            "<<<<<<< HEAD",
            "left",
            "=======",
            "right",
            ">>>>>>> branch",
            "",
          ].join("\n"),
        );

        assertScannerResult(root, 2, /merge conflict marker/u);
      });
    });

    it("blocks a leading-plus token assignment and allows its placeholder control", () => {
      withTempRepo((root) => {
        writeFile(root, "leading-plus.env", "+API_KEY=your_api_key_here\n");
        commitAll(root, "add leading plus placeholder");
        writeFile(
          root,
          "leading-plus.env",
          `+API_KEY=${TEST_API_TOKEN}\n+API_KEY=your_api_key_here\n`,
        );

        assertScannerResult(root, 2, /API token/u);
      });
    });

    it("allows source assignments", () => {
      withTempRepo((root) => {
        writeFile(root, "app.py", `API_TOKEN = "${TEST_CLIENT_SECRET}"\n`);

        assertScannerResult(root, 0);
      });
    });

    it("uses the optimized token thresholds", () => {
      withTempRepo((root) => {
        writeFile(
          root,
          "tokens.txt",
          [TEST_SHORT_GITHUB_TOKEN, TEST_SHORT_NPM_TOKEN, ""].join("\n"),
        );

        assertScannerResult(root, 0);
      });
    });

    it("blocks changed suppression markers while ignoring a safe placeholder", () => {
      withTempRepo((root) => {
        writeFile(
          root,
          "tokens.env",
          [
            `SLACK_BOT_TOKEN=${TEST_DOCUMENTED_SLACK_PLACEHOLDER}`,
            `AWS_ACCESS_KEY_ID=${TEST_AWS_ACCESS_KEY} # gitleaks:allow`,
            `AWS_SECRET_ACCESS_KEY=${TEST_AWS_ACCESS_KEY} # pragma: allowlist secret`,
            "",
          ].join("\n"),
        );

        assertScannerResult(root, 2, /AWS access key/u);
      });
    });

    it("allows safe placeholders", () => {
      withTempRepo((root) => {
        writeFile(root, ".env.example", "API_KEY=your_api_key_here\n");

        assertHookAllows(root, nativeScannerEnv);
      });
    });

    it("blocks a staged-only raw token", () => {
      withTempRepo((root) => {
        writeFile(root, "settings.env", "API_KEY=your_api_key_here\n");
        commitAll(root, "add safe settings");
        writeFile(root, "settings.env", `API_KEY=${TEST_API_TOKEN}\n`);
        runGit(root, ["add", "settings.env"]);
        writeFile(root, "settings.env", "API_KEY=your_api_key_here\n");

        assertHookBlocks(root, /API token/u, nativeScannerEnv);
      });
    });

    it("blocks an unstaged private-key header", () => {
      withTempRepo((root) => {
        writeFile(root, "key.pem", "safe\n");
        commitAll(root, "add key fixture");
        writeFile(root, "key.pem", `${TEST_PRIVATE_KEY_HEADER}\nbody\n`);

        assertHookBlocks(root, /private key block/u, nativeScannerEnv);
      });
    });

    it("blocks an untracked merge-conflict triplet", () => {
      withTempRepo((root) => {
        writeFile(
          root,
          "conflict.txt",
          "<<<<<<< HEAD\nleft\n=======\nright\n>>>>>>> branch\n",
        );

        assertHookBlocks(root, /merge conflict marker/u, nativeScannerEnv);
      });
    });

    it("blocks literal credential assignments", () => {
      withTempRepo((root) => {
        writeFile(root, "config.ini", `password=${TEST_INI_PASSWORD}\n`);

        assertHookBlocks(
          root,
          /credential assignment \(password\)/u,
          nativeScannerEnv,
        );
      });
    });

    // Writes three commented credentials so the scanner must block each one.
    it("matches literal assignments followed by trailing comments", () => {
      withTempRepo((root) => {
        writeFile(
          root,
          "config.env",
          [
            `API_KEY="${TEST_CLIENT_SECRET}" # rotate quarterly`,
            `password='${TEST_INI_PASSWORD}' # rotate quarterly`,
            `AUTH_TOKEN=${TEST_CLIENT_SECRET} # rotate quarterly`,
            "",
          ].join("\n"),
        );

        assertScannerResult(root, 2, /credential assignment/u);
      });
    });

    // Writes a bare-dollar expression so the scanner leaves the user's turn unblocked.
    it("allows a bare dollar inside a double-quoted assignment", () => {
      withTempRepo((root) => {
        writeFile(root, "config.env", `API_KEY="${TEST_CLIENT_SECRET}$"\n`);

        assertScannerResult(root, 0);
      });
    });

    // Writes and commits an oversized tracked file so the scanner honors the user's byte cap.
    it("applies the byte cap to tracked worktree diffs", () => {
      withTempRepo((root) => {
        writeFile(root, "large.env", "safe=1\n");
        commitAll(root, "add capped fixture");
        writeFile(
          root,
          "large.env",
          `safe=${"x".repeat(80)}\nAPI_KEY=${TEST_CLIENT_SECRET}\n`,
        );

        assertScannerResult(root, 2, /credential assignment/u, {
          GOAT_FLOW_POST_TURN_SAFETY_MAX_BYTES: "64",
        });
      });
    });

    // Writes and stages an oversized secret, then restores the worktree so scanners measure the index blob.
    it("applies the byte cap to staged-only diffs", () => {
      withTempRepo((root) => {
        writeFile(root, "large.env", "safe=1\n");
        commitAll(root, "add staged capped fixture");
        writeFile(
          root,
          "large.env",
          `safe=${"x".repeat(80)}\nAPI_KEY=${TEST_CLIENT_SECRET}\n`,
        );
        runGit(root, ["add", "large.env"]);
        writeFile(root, "large.env", "safe=1\n");

        assertScannerResult(root, 2, /credential assignment/u, {
          GOAT_FLOW_POST_TURN_SAFETY_MAX_BYTES: "64",
        });
      });
    });

    // Writes and commits a fixture, then adds a line whose token follows a carriage return the candidate filters must cross.
    it("blocks a tracked token after a carriage return", () => {
      withTempRepo((root) => {
        writeFile(root, "notes.txt", "base\n");
        commitAll(root, "add notes");
        writeFile(
          root,
          "notes.txt",
          `base\nsafe\rkey ${TEST_AWS_ACCESS_KEY}\n`,
        );

        assertScannerResult(root, 2, /AWS access key in notes\.txt/u);
      });
    });

    // Writes and commits a fixture, then adds a private-key header that starts after a carriage return.
    it("blocks a tracked private-key header after a carriage return", () => {
      withTempRepo((root) => {
        writeFile(root, "notes.txt", "base\n");
        commitAll(root, "add notes");
        writeFile(root, "notes.txt", `base\n\r${TEST_PRIVATE_KEY_HEADER}\n`);

        assertScannerResult(root, 2, /private key block in notes\.txt/u);
      });
    });

    // Writes an untracked file where only the labelled API-token form can match, because an underscore precedes the token.
    it("blocks a labelled API token after a carriage return in an untracked file", () => {
      withTempRepo((root) => {
        writeFile(root, "new.txt", `OPENAI_KEY=\rprefix_${TEST_API_TOKEN}\n`);

        assertScannerResult(root, 2, /API token in new\.txt/u);
      });
    });

    // Writes an untracked file whose only NUL byte lies beyond the first 32 KiB, so the scanner must still call it binary.
    it("reports a binary gap when the first NUL byte follows the first 32 KiB", () => {
      withTempRepo((root) => {
        writeFile(
          root,
          "bundle.dat",
          Buffer.concat([
            Buffer.alloc(35_000, "a"),
            Buffer.from([0]),
            Buffer.alloc(4999, "b"),
          ]),
        );

        assertScannerResult(
          root,
          2,
          /binary untracked path not scanned in bundle\.dat/u,
        );
      });
    });

    // Writes, commits and then deletes a non-UTF-8 name beside a staged clean edit; staged deduplication must not report it.
    it(
      "ignores an unstaged deletion of a non-UTF-8 tracked name",
      nonUtf8NameTestOptions(),
      () => {
        withTempRepo((root) => {
          const invalidName = Buffer.concat([
            Buffer.from(`${root}/old`),
            Buffer.from([0xff]),
            Buffer.from(".txt"),
          ]);
          writeFileSync(invalidName, "old\n");
          commitAll(root, "add non-UTF-8 name");
          writeFile(root, "README.md", "# fixture\nmore\n");
          runGit(root, ["add", "README.md"]);
          rmSync(invalidName);

          assertScannerResult(root, 0);
        });
      },
    );

    // Writes three untracked files with findings so a leading-zero limit must still cap direct output at two.
    it("caps direct-mode findings when MAX_FINDINGS has a leading zero", () => {
      withTempRepo((root) => {
        for (const name of ["a.txt", "b.txt", "c.txt"])
          writeFile(root, name, `key ${TEST_AWS_ACCESS_KEY}\n`);

        assertScannerResult(
          root,
          2,
          /1 additional finding\(s\) hidden by output cap/u,
          { GOAT_FLOW_POST_TURN_SAFETY_MAX_FINDINGS: "02" },
        );
      });
    });
  });

  describe("scan budget", () => {
    it("reports unscanned files instead of truncating silently", () => {
      withTempRepo((root) => {
        writeFile(root, "settings.env", "API_KEY=your_api_key_here\n");

        // A zero-second budget forces the bail path on the first check. The
        // hook must say the scan was incomplete and fail, because a silent
        // partial scan would look identical to a clean pass.
        const result = runHook(root, {
          GOAT_FLOW_POST_TURN_SAFETY_MAX_SECONDS: "0",
          [FORCE_BASH3_ENV_KEY]: "0",
        });

        assert.equal(result.status, 2);
        assert.match(
          result.stderr,
          /post-turn-safety: scan incomplete, \d+ file\(s\) unscanned/u,
        );
      });
    });

    it("completes normally under a generous budget", () => {
      withTempRepo((root) => {
        writeFile(root, "settings.env", "API_KEY=your_api_key_here\n");

        assertHookAllows(root, {
          GOAT_FLOW_POST_TURN_SAFETY_MAX_SECONDS: "600",
        });
      });
    });
  });

  it("the installed mirror matches the workflow hook source", () => {
    assert.equal(
      readFileSync(
        join(hookTreeRoot("installed"), basename(HOOK_PATH)),
        "utf8",
      ),
      readFileSync(HOOK_PATH, "utf8"),
    );
  });
});

/**
 * One recorded scanner scenario: the change a user made, optional scanner limits, and whether the Stop must block or allow it.
 *
 * Keep each `id` and `label` stable: together they form the test title that ties the row to the old scenario it replays.
 */
interface HistoricalScannerRow {
  id: string;
  label: string;
  // Writes the user's change into the fresh fixture repository before the hook runs.
  write: (root: string) => void;
  // A finding pattern that names the changed file; absent means the turn must be allowed.
  blocks?: RegExp;
  // Scanner limit settings for this run, such as `GOAT_FLOW_POST_TURN_SAFETY_MAX_SECONDS`; absent uses the defaults.
  env?: Record<string, string>;
  // Why this platform skips the row, such as Windows refusing a double quote in a file name; false or absent runs it.
  skip?: string | false;
}

// Each row replays one scenario first proven by a Bash reproduction script that no longer ships; ids keep that script's numbering.
//
// - A row without `blocks` records a shape the scanner allows today; most sit beside a `control:` row showing the same detector still fires.
// - `assertHookBlocks` and `assertHookAllows` run both scanner result variants and require them to agree.
// - Token-shaped values are assembled at runtime, so this file holds no literal the hook under test would flag.
describe("historical scanner regressions", () => {
  const awsKey = TEST_AWS_ACCESS_KEY;
  const awsLine = 'const probeKey = "' + awsKey + '";';
  const password = ["Xk9mQ2vR", "7tLp4Wz8"].join("");
  const dollarPassword = ["Xk9m", "Q2vR7tLp4Wz8"].join("$");
  const legacyNpmToken = ["6f1c2b7e-4d3a", "4b8f-9c21-7e5d0a9b3f46"].join("-");
  const stripeKey = ["sk", "live", "4eC39HqLyjWDarjtT1zdp7dc"].join("_");
  const propertiesPath = "probe/app.properties";
  const yamlPath = "probe/config.yml";
  const envFilePath = "probe/app.env";
  const quoteNamedPath = 'probe/quote"name.txt';
  // Windows cannot create the quote-named file, so rows 7a and 7b skip there and run everywhere else.
  const quoteNameSkip =
    process.platform === "win32"
      ? "Windows file names cannot contain a double quote"
      : false;
  const awsKeyInSource = /AWS access key in src\/cli\.ts/u;
  const privateKeyInSource = /private key block in src\/cli\.ts/u;
  const awsKeyInQuoteName = /AWS access key in probe\/quote"name\.txt/u;
  // Builds a commented private-key header at runtime, so no complete header literal sits in this file.
  const privateKeyHeader = (kind: string) =>
    "// " + ["-----BEGIN", kind + "-----"].join(" ");
  // Builds the credential-assignment finding the scanner reports for one key in one file.
  const assignmentFinding = (key: string, path: string) =>
    new RegExp(
      "credential assignment \\(" +
        key +
        "\\) in " +
        path.replaceAll(".", "\\."),
      "u",
    );
  // Builds one npm registry login line for a `.npmrc` file.
  const npmrcLoginLine = (token: string) =>
    "//registry.npmjs.org/:_authToken=" + token + "\n";

  // Writes the line as an unstaged edit to the fixture's committed source file.
  const edit = (line: string) => (root: string) =>
    appendCommittedLine(root, "src/cli.ts", line);
  // Writes and stages the line in that source file; isIndexOnly then restores the worktree copy.
  const stage = (line: string, isIndexOnly: boolean) => (root: string) =>
    stageAppendedLine(root, "src/cli.ts", line, isIndexOnly);
  // Writes a new untracked file with the given content.
  const create = (path: string, content: string) => (root: string) =>
    writeFile(root, path, content);
  // Builds one table row; an absent pattern means the turn must be allowed.
  const row = (
    id: string,
    label: string,
    write: (root: string) => void,
    blocks?: RegExp,
  ): HistoricalScannerRow => ({
    id,
    label,
    write,
    blocks,
  });
  // Builds one limit row: a real token finding plus a malformed limit setting that must not hide it.
  const limit = (
    id: string,
    setting: string,
    limitValue: string,
  ): HistoricalScannerRow => ({
    ...row(
      id,
      `GOAT_FLOW_POST_TURN_SAFETY_${setting}=${limitValue}`,
      edit(awsLine),
      awsKeyInSource,
    ),
    env: { ["GOAT_FLOW_POST_TURN_SAFETY_" + setting]: limitValue },
  });
  const pemBody = [
    TEST_RSA_PRIVATE_KEY_BODY,
    TEST_RSA_PRIVATE_KEY_BODY,
    TEST_RSA_PRIVATE_KEY_FOOTER,
  ];

  const rows: readonly HistoricalScannerRow[] = [
    // 1-3: an added line starting `++` shows in the diff as `+++`, the same prefix as a file header, and must still be scanned.
    row("1b", "added line '++<token>'", edit("++" + awsKey), awsKeyInSource),
    row("1c", "added line '++ <token>'", edit("++ " + awsKey), awsKeyInSource),
    row(
      "2a",
      "staged '++<token>', worktree equals index",
      stage("++" + awsKey, false),
      awsKeyInSource,
    ),
    row(
      "2b",
      "staged '++ <token>', worktree equals index",
      stage("++ " + awsKey, false),
      awsKeyInSource,
    ),
    row(
      "2c",
      "staged '++<token>', line only in the index",
      stage("++" + awsKey, true),
      awsKeyInSource,
    ),
    row(
      "2d",
      "staged '++ <token>', line only in the index",
      stage("++ " + awsKey, true),
      awsKeyInSource,
    ),
    row(
      "3",
      "untracked file with both '++' lines",
      create("probe/plusplus.txt", `++${awsKey}\n++ ${awsKey}\n`),
      /AWS access key in probe\/plusplus\.txt/u,
    ),
    // 4: each private-key header form must block, even with no key body after it.
    row(
      "4",
      "PKCS#8 unencrypted header",
      edit(privateKeyHeader("PRIVATE KEY")),
      privateKeyInSource,
    ),
    row(
      "4",
      "PKCS#8 ENCRYPTED header",
      edit(privateKeyHeader("ENCRYPTED PRIVATE KEY")),
      privateKeyInSource,
    ),
    row(
      "4",
      "PGP PRIVATE KEY BLOCK header",
      edit(privateKeyHeader("PGP PRIVATE KEY BLOCK")),
      privateKeyInSource,
    ),
    // 5: credentials in config and source files; if the scanner starts catching an allow row, update that row on purpose.
    row(
      "5a",
      "control: password=<value> in .properties",
      create(propertiesPath, `password=${password}\n`),
      assignmentFinding("password", propertiesPath),
    ),
    row(
      "5b",
      "whitespace-delimited 'password <value>' in .properties",
      create(propertiesPath, `password ${password}\n`),
    ),
    row(
      "5c",
      "colon-delimited 'password: <value>' in .properties",
      create(propertiesPath, `password: ${password}\n`),
      assignmentFinding("password", propertiesPath),
    ),
    row(
      "5d",
      "control: inline YAML 'password: <value>'",
      create(yamlPath, `db:\n  password: ${password}\n`),
      assignmentFinding("password", yamlPath),
    ),
    row(
      "5e",
      "YAML block scalar 'password: |' + value line",
      create(yamlPath, `db:\n  password: |\n    ${password}\n`),
    ),
    row(
      "5g",
      "PEM body + footer hunk without its header",
      edit(pemBody.map((line) => "// " + line).join("\n")),
    ),
    row(
      "5j",
      "single-quoted value containing '$' in .env",
      create(envFilePath, `DB_PASSWORD='${dollarPassword}'\n`),
      assignmentFinding("DB_PASSWORD", envFilePath),
    ),
    row(
      "5k",
      "control: spring_datasource_password=<value>",
      create(propertiesPath, `spring_datasource_password=${password}\n`),
      assignmentFinding("spring_datasource_password", propertiesPath),
    ),
    row(
      "5l",
      "dotted key spring.datasource.password=<value>",
      create(propertiesPath, `spring.datasource.password=${password}\n`),
    ),
    row(
      "5m",
      ".npmrc _authToken=npm_<36 chars>",
      create(".npmrc", npmrcLoginLine(TEST_NPM_TOKEN)),
      /npm token in \.npmrc/u,
    ),
    row(
      "5n",
      ".npmrc _authToken=<legacy UUID-shaped token>",
      create(".npmrc", npmrcLoginLine(legacyNpmToken)),
    ),
    row(
      "5o",
      "Stripe sk_live_ value in source",
      edit('const stripeKey = "' + stripeKey + '";'),
    ),
    row(
      "5p",
      "Stripe sk_live_ value under STRIPE_SECRET_KEY in .env",
      create(envFilePath, `STRIPE_SECRET_KEY=${stripeKey}\n`),
      assignmentFinding("STRIPE_SECRET_KEY", envFilePath),
    ),
    // 6: a malformed limit setting, such as a leading-zero seconds value, must not hide a real token.
    limit("6a", "MAX_FINDINGS", "invalid"),
    limit("6b", "MAX_SECONDS", "08"),
    limit("6c", "MAX_SECONDS", "010"),
    // 7: a token in a file whose name contains a double quote must still be found and named.
    {
      ...row(
        "7a",
        "staged quote-named file, token added in the worktree",
        (root) => {
          writeFile(root, quoteNamedPath, "benign first line\n");
          runGit(root, ["add", "--", quoteNamedPath]);
          writeFile(root, quoteNamedPath, `benign first line\n${awsLine}\n`);
        },
        awsKeyInQuoteName,
      ),
      skip: quoteNameSkip,
    },
    {
      ...row(
        "7b",
        "the same file untracked (whole-file path)",
        create(quoteNamedPath, `benign first line\n${awsLine}\n`),
        awsKeyInQuoteName,
      ),
      skip: quoteNameSkip,
    },
  ];

  // Writes each row's change into a fresh repository and spawns the hook; a block must name the changed file.
  for (const historicalRow of rows) {
    it(
      `historical scanner ${historicalRow.id}: ${historicalRow.label}`,
      { skip: historicalRow.skip ?? false },
      () => {
        withTempRepo((root) => {
          historicalRow.write(root);
          // A row with a finding pattern expects a blocked Stop that names the file; a row without one expects the turn to pass.
          if (historicalRow.blocks)
            assertHookBlocks(root, historicalRow.blocks, historicalRow.env);
          else assertHookAllows(root, historicalRow.env);
        });
      },
    );
  }
});
