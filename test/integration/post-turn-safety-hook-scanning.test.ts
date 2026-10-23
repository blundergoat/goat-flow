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
import { hookSelection } from "../helpers/hook-entrypoint.js";
import { symlinkTestOptions } from "../helpers/symlink-capability.js";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, it } from "node:test";

import {
  PROJECT_ROOT,
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
  hookFindingSignatures,
  withCommandShim,
  withScannerFileFault,
  assertHookIncomplete,
  assertHookAllows,
  assertHookBlocks,
  TEST_CLIENT_SECRET,
  TEST_INI_PASSWORD,
  TEST_PRIVATE_KEY_HEADER,
  TEST_DOCUMENTED_SLACK_PLACEHOLDER,
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
  if (hookSelection() !== "reference") {
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
  }
  /** Confirm both scanner paths tell the user that declared coverage is incomplete.
   *
   * @param root - fixture repository with a path the hook cannot fully scan
   * @param env - optional fault controls; empty uses normal user commands
   * @returns nothing; either scanner allowing the turn fails the user contract
   */
  function assertIncompleteOnBothScanners(
    root: string,
    env: Record<string, string> = {},
  ): void {
    // Native and compatibility scanners must show the same blocking result to the user.
    for (const forceFallback of ["0", "1"]) {
      assertHookIncomplete(root, {
        ...env,
        [FORCE_BASH3_ENV_KEY]: forceFallback,
      });
    }
  }

  describe("incomplete scan failures", () => {
    it("blocks when the repository root is unavailable on both paths", () => {
      const root = mkdtempSync(join(tmpdir(), "goat-flow-post-turn-no-git-"));
      try {
        assertIncompleteOnBothScanners(root);
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
            assertIncompleteOnBothScanners(root, {
              ...shimEnv,
              GOAT_FLOW_TEST_MISSING_ROOT: join(root, "missing-root"),
            });
          },
        );
      });
    });

    if (hookSelection() === "reference")
      it("blocks when the scan workspace cannot be created", () => {
        withTempRepo((root) => {
          writeFile(root, "settings.env", "API_KEY=your_api_key_here\n");
          withCommandShim(
            resolveExecutable("mktemp"),
            { status: 2 },
            (shimEnv) => {
              assertIncompleteOnBothScanners(root, shimEnv);
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
            assertIncompleteOnBothScanners(root, shimEnv);
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
            assertIncompleteOnBothScanners(root, shimEnv);
          },
        );
      });
    });

    it("blocks when a native candidate grep fails", () => {
      withTempRepo((root) => {
        writeFile(root, "settings.env", "safe=1\n");
        if (hookSelection() !== "reference") {
          withScannerFileFault("readFileSync", (environment) =>
            assertIncompleteOnBothScanners(root, environment),
          );
          return;
        }
        withCommandShim(
          resolveExecutable("grep"),
          { when: { any: ["-aUHnZE", "-iaUHnZE"] }, status: 2 },
          (shimEnv) => {
            assertHookIncomplete(root, {
              ...shimEnv,
              [FORCE_BASH3_ENV_KEY]: "0",
            });
          },
        );
      });
    });

    it("blocks when the binary-content gate fails on both paths", () => {
      withTempRepo((root) => {
        writeFile(root, "settings.env", "safe=1\n");
        if (hookSelection() !== "reference") {
          withScannerFileFault("readSync", (environment) =>
            assertIncompleteOnBothScanners(root, environment),
          );
          return;
        }
        withCommandShim(
          resolveExecutable("grep"),
          { when: { any: ["-IlZ", "-Iq"] }, status: 2 },
          (shimEnv) => {
            assertIncompleteOnBothScanners(root, shimEnv);
          },
        );
      });
    });

    it("blocks when byte counting fails on both paths", () => {
      withTempRepo((root) => {
        writeFile(root, "settings.env", "safe=1\n");
        if (hookSelection() !== "reference") {
          withScannerFileFault("lstatSync", (environment) =>
            assertIncompleteOnBothScanners(root, environment),
          );
          return;
        }
        withCommandShim(resolveExecutable("wc"), { status: 2 }, (shimEnv) => {
          assertIncompleteOnBothScanners(root, shimEnv);
        });
      });
    });

    it("blocks when selected content disappears after byte counting", () => {
      withTempRepo((root) => {
        if (hookSelection() !== "reference") {
          withScannerFileFault("vanish", (environment) => {
            for (const variant of ["0", "1"]) {
              writeFile(root, "settings.env", "safe=1\n");
              assertHookIncomplete(root, {
                ...environment,
                [FORCE_BASH3_ENV_KEY]: variant,
              });
            }
          });
          return;
        }
        withCommandShim(
          resolveExecutable("wc"),
          { delegateThenRemoveEnvironment: "GOAT_FLOW_TEST_VANISH_PATH" },
          (shimEnv) => {
            // Recreate the user's file because each scanner sees the shim delete it once.
            for (const forceFallback of ["0", "1"]) {
              writeFile(root, "settings.env", "safe=1\n");
              assertHookIncomplete(root, {
                ...shimEnv,
                GOAT_FLOW_TEST_VANISH_PATH: join(root, "settings.env"),
                [FORCE_BASH3_ENV_KEY]: forceFallback,
              });
            }
          },
        );
      });
    });

    if (hookSelection() === "reference")
      it("blocks when fallback text normalization fails", () => {
        withTempRepo((root) => {
          writeFile(root, "settings.env", `API_KEY=${TEST_API_TOKEN}\n`);
          withCommandShim(resolveExecutable("tr"), { status: 2 }, (shimEnv) => {
            assertHookIncomplete(root, {
              ...shimEnv,
              [FORCE_BASH3_ENV_KEY]: "1",
            });
          });
        });
      });

    it("blocks when changed-content coverage inventory fails on both paths", () => {
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
            assertIncompleteOnBothScanners(root, shimEnv);
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
        content: Buffer.from([0, 1, 2, ...Buffer.from(TEST_AWS_ACCESS_KEY)]),
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
        assertIncompleteOnBothScanners(root);
        if (hookSelection() !== "reference" && fixture.path === "large.txt") {
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

  describe("Bash 3 compatibility scan", () => {
    const compatibilityEnv = {
      GOAT_FLOW_POST_TURN_SAFETY_FORCE_BASH3_FALLBACK: "1",
    };

    /**
     * Confirms that stock macOS Bash and newer Bash give the user one Stop result.
     *
     * @param root - non-empty fixture root both scanners inspect
     * @param expectedStatus - 0 allows the turn; 2 means the user sees a block
     * @param expectedPattern - optional explanation; absent compares outcome and findings only
     * @param env - optional scanner controls; empty uses normal user commands
     * @returns nothing; any user-visible scanner difference fails the active test
     */
    function assertScannerParity(
      root: string,
      expectedStatus: 0 | 2,
      expectedPattern?: RegExp,
      env: Record<string, string> = {},
    ): void {
      const nativeResult = runHook(root, {
        ...env,
        GOAT_FLOW_POST_TURN_SAFETY_FORCE_BASH3_FALLBACK: "0",
      });
      const compatibilityResult = runHook(root, {
        ...env,
        ...compatibilityEnv,
      });
      const diagnostics = [
        `native status=${nativeResult.status}`,
        `native stderr:\n${nativeResult.stderr}`,
        `fallback status=${compatibilityResult.status}`,
        `fallback stderr:\n${compatibilityResult.stderr}`,
      ].join("\n");

      assert.equal(nativeResult.status, expectedStatus, diagnostics);
      assert.equal(
        compatibilityResult.status,
        nativeResult.status,
        diagnostics,
      );
      assert.deepStrictEqual(
        hookFindingSignatures(compatibilityResult.stderr),
        hookFindingSignatures(nativeResult.stderr),
        diagnostics,
      );
      // A supplied warning pattern confirms both paths explain the same user action.
      if (expectedPattern) {
        assert.match(nativeResult.stderr, expectedPattern, diagnostics);
        assert.match(compatibilityResult.stderr, expectedPattern, diagnostics);
      }
    }

    it("blocks fine-grained GitHub tokens on both paths", () => {
      withTempRepo((root) => {
        writeFile(
          root,
          "tokens.env",
          `GITHUB_TOKEN=${TEST_FINE_GRAINED_GITHUB_TOKEN}\n`,
        );

        assertScannerParity(root, 2, /GitHub token/u);
      });
    });

    it("blocks a double-quoted credential terminated by a semicolon on both paths", () => {
      withTempRepo((root) => {
        writeFile(
          root,
          "deploy.sh",
          'export DB_PASSWORD="correct-horse-battery-staple";\n',
        );

        assertScannerParity(root, 2, /credential assignment/u);
      });
    });

    it("blocks a single-quoted credential terminated by a semicolon on both paths", () => {
      withTempRepo((root) => {
        writeFile(
          root,
          "deploy.sh",
          "export DB_PASSWORD='correct-horse-battery-staple';\n",
        );

        assertScannerParity(root, 2, /credential assignment/u);
      });
    });

    // Both common Git path shapes must decode to the file name the user recognizes.
    for (const path of ["space name.env", "café.env"]) {
      it(`decodes the Git diff header for ${path} on both paths`, () => {
        withTempRepo((root) => {
          writeFile(root, path, "safe=1\n");
          commitAll(root, `add ${path}`);
          writeFile(root, path, `OPENAI_API_KEY=${TEST_API_TOKEN}\n`);

          assertHookBlocks(root, new RegExp(`API token in ${path}`, "u"));
        });
      });
    }

    it("pins mnemonic Git diff prefixes on both paths", () => {
      withTempRepo((root) => {
        writeFile(root, "mnemonic.env", "safe=1\n");
        commitAll(root, "add mnemonic prefix fixture");
        runGit(root, ["config", "diff.mnemonicPrefix", "true"]);
        writeFile(root, "mnemonic.env", `API_KEY=${TEST_API_TOKEN}\n`);

        assertScannerParity(root, 2, /API token in mnemonic\.env/u);
      });
    });

    it("pins custom Git diff source and destination prefixes on both paths", () => {
      withTempRepo((root) => {
        writeFile(root, "custom.env", "safe=1\n");
        commitAll(root, "add custom prefix fixture");
        runGit(root, ["config", "diff.srcPrefix", "before/"]);
        runGit(root, ["config", "diff.dstPrefix", "after/"]);
        writeFile(root, "custom.env", `API_KEY=${TEST_API_TOKEN}\n`);

        assertScannerParity(root, 2, /API token in custom\.env/u);
      });
    });

    it("combines staged and unstaged conflict-marker state on both paths", () => {
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

        assertScannerParity(root, 2, /merge conflict marker/u);
      });
    });

    it("does not let added content impersonate a fallback diff header", () => {
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

        assertScannerParity(root, 2, /merge conflict marker/u);
      });
    });

    it("blocks a leading-plus token assignment on both paths and allows its placeholder control", () => {
      withTempRepo((root) => {
        writeFile(root, "leading-plus.env", "+API_KEY=your_api_key_here\n");
        commitAll(root, "add leading plus placeholder");
        writeFile(
          root,
          "leading-plus.env",
          `+API_KEY=${TEST_API_TOKEN}\n+API_KEY=your_api_key_here\n`,
        );

        assertScannerParity(root, 2, /API token/u);
      });
    });

    it("allows source assignments on both paths", () => {
      withTempRepo((root) => {
        writeFile(root, "app.py", `API_TOKEN = "${TEST_CLIENT_SECRET}"\n`);

        assertScannerParity(root, 0);
      });
    });

    it("uses the optimized token thresholds on both paths", () => {
      withTempRepo((root) => {
        writeFile(
          root,
          "tokens.txt",
          [TEST_SHORT_GITHUB_TOKEN, TEST_SHORT_NPM_TOKEN, ""].join("\n"),
        );

        assertScannerParity(root, 0);
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

        assertScannerParity(root, 2, /AWS access key/u);
      });
    });

    it("allows safe placeholders", () => {
      withTempRepo((root) => {
        writeFile(root, ".env.example", "API_KEY=your_api_key_here\n");

        assertHookAllows(root, compatibilityEnv);
      });
    });

    it("blocks a staged-only raw token", () => {
      withTempRepo((root) => {
        writeFile(root, "settings.env", "API_KEY=your_api_key_here\n");
        commitAll(root, "add safe settings");
        writeFile(root, "settings.env", `API_KEY=${TEST_API_TOKEN}\n`);
        runGit(root, ["add", "settings.env"]);
        writeFile(root, "settings.env", "API_KEY=your_api_key_here\n");

        assertHookBlocks(root, /API token/u, compatibilityEnv);
      });
    });

    it("blocks an unstaged private-key header", () => {
      withTempRepo((root) => {
        writeFile(root, "key.pem", "safe\n");
        commitAll(root, "add key fixture");
        writeFile(root, "key.pem", `${TEST_PRIVATE_KEY_HEADER}\nbody\n`);

        assertHookBlocks(root, /private key block/u, compatibilityEnv);
      });
    });

    it("blocks an untracked merge-conflict triplet", () => {
      withTempRepo((root) => {
        writeFile(
          root,
          "conflict.txt",
          "<<<<<<< HEAD\nleft\n=======\nright\n>>>>>>> branch\n",
        );

        assertHookBlocks(root, /merge conflict marker/u, compatibilityEnv);
      });
    });

    it("blocks literal credential assignments", () => {
      withTempRepo((root) => {
        writeFile(root, "config.ini", `password=${TEST_INI_PASSWORD}\n`);

        assertHookBlocks(
          root,
          /credential assignment \(password\)/u,
          compatibilityEnv,
        );
      });
    });

    // Writes three commented credentials so both scanners must block the same user edit.
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

        assertScannerParity(root, 2, /credential assignment/u);
      });
    });

    // Writes a bare-dollar expression so both scanners leave the user's turn unblocked.
    it("allows a bare dollar inside a double-quoted assignment", () => {
      withTempRepo((root) => {
        writeFile(root, "config.env", `API_KEY="${TEST_CLIENT_SECRET}$"\n`);

        assertScannerParity(root, 0);
      });
    });

    // Writes and commits an oversized tracked file so both scanners honor the user's byte cap.
    it("applies the byte cap to tracked worktree diffs", () => {
      withTempRepo((root) => {
        writeFile(root, "large.env", "safe=1\n");
        commitAll(root, "add capped fixture");
        writeFile(
          root,
          "large.env",
          `safe=${"x".repeat(80)}\nAPI_KEY=${TEST_CLIENT_SECRET}\n`,
        );

        assertScannerParity(root, 2, /credential assignment/u, {
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

        assertScannerParity(root, 2, /credential assignment/u, {
          GOAT_FLOW_POST_TURN_SAFETY_MAX_BYTES: "64",
        });
      });
    });

    // Writes and commits a fixture, then adds a line whose token follows a carriage return the candidate filters must cross.
    it("blocks a tracked token after a carriage return on both paths", () => {
      withTempRepo((root) => {
        writeFile(root, "notes.txt", "base\n");
        commitAll(root, "add notes");
        writeFile(
          root,
          "notes.txt",
          `base\nsafe\rkey ${TEST_AWS_ACCESS_KEY}\n`,
        );

        assertScannerParity(root, 2, /AWS access key in notes\.txt/u);
      });
    });

    // Writes and commits a fixture, then adds a private-key header that starts after a carriage return.
    it("blocks a tracked private-key header after a carriage return on both paths", () => {
      withTempRepo((root) => {
        writeFile(root, "notes.txt", "base\n");
        commitAll(root, "add notes");
        writeFile(root, "notes.txt", `base\n\r${TEST_PRIVATE_KEY_HEADER}\n`);

        assertScannerParity(root, 2, /private key block in notes\.txt/u);
      });
    });

    // Writes an untracked file where only the labelled API-token form can match, because an underscore precedes the token.
    it("blocks a labelled API token after a carriage return in an untracked file on both paths", () => {
      withTempRepo((root) => {
        writeFile(root, "new.txt", `OPENAI_KEY=\rprefix_${TEST_API_TOKEN}\n`);

        assertScannerParity(root, 2, /API token in new\.txt/u);
      });
    });

    // Writes an untracked file whose only NUL byte lies beyond the first 32 KiB, so both scanners must still call it binary.
    it("reports a binary gap when the first NUL byte follows the first 32 KiB on both paths", () => {
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

        assertScannerParity(
          root,
          2,
          /binary untracked path not scanned in bundle\.dat/u,
        );
      });
    });

    // Writes, commits and then deletes a non-UTF-8 name beside a staged clean edit; staged deduplication must not report it.
    it(
      "ignores an unstaged deletion of a non-UTF-8 tracked name on both paths",
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

          assertScannerParity(root, 0);
        });
      },
    );

    // Writes three untracked files with findings so a leading-zero limit must still cap direct output at two.
    it("caps direct-mode findings when MAX_FINDINGS has a leading zero on both paths", () => {
      withTempRepo((root) => {
        for (const name of ["a.txt", "b.txt", "c.txt"])
          writeFile(root, name, `key ${TEST_AWS_ACCESS_KEY}\n`);

        assertScannerParity(
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
        const compatibilityResult = runHook(root, {
          GOAT_FLOW_POST_TURN_SAFETY_MAX_SECONDS: "0",
          [FORCE_BASH3_ENV_KEY]: "1",
        });

        assert.equal(result.status, 2);
        assert.equal(compatibilityResult.status, 2);
        assert.match(
          result.stderr,
          /post-turn-safety: scan incomplete, \d+ file\(s\) unscanned/u,
        );
        assert.match(compatibilityResult.stderr, /scan incomplete/u);
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
        resolve(
          PROJECT_ROOT,
          ".goat-flow/hooks",
          HOOK_PATH.split(/[\\/]/u).at(-1)!,
        ),
        "utf8",
      ),
      readFileSync(HOOK_PATH, "utf8"),
    );
  });
});
