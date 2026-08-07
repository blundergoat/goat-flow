/**
 * How the hook decides what to scan: dirty and staged states, ignored files, binary and
 * oversized content, renames - and the batched scanner's obligation to preserve per-line
 * semantics the shipped contract depends on.
 * Every case runs the real hook against a real git repository, so a pass means the shipped
 * scanner behaves as asserted, not a reimplementation of it.
 */
import assert from "node:assert/strict";
import { readFileSync, rmSync } from "node:fs";
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
  TEST_UNDERSCORE_API_TOKEN,
  withTempRepo,
  withUnbornTempRepo,
  writeFile,
  runGit,
  commitAll,
  runHook,
  assertHookAllows,
  assertHookBlocks,
  TEST_CLIENT_SECRET,
  TEST_INI_PASSWORD,
  TEST_PRIVATE_KEY_HEADER,
  TEST_DOCUMENTED_SLACK_PLACEHOLDER,
} from "./post-turn-safety-hook.helpers.js";

describe("post-turn-safety hook: git states and batched scanning", () => {
  it("detects new hazards added to files that were already dirty", () => {
    withTempRepo((root) => {
      writeFile(root, "settings.env", "API_KEY=your_api_key_here\n");
      const firstPass = runHook(root, { [FORCE_BASH3_ENV_KEY]: "0" });
      assert.equal(firstPass.status, 0, firstPass.stderr);
      writeFile(
        root,
        "settings.env",
        `API_KEY=your_api_key_here\nAWS_ACCESS_KEY_ID=${TEST_AWS_ACCESS_KEY}\n`,
      );

      assertHookBlocks(root, /AWS access key/u);
    });
  });

  it("blocks staged-only secrets when the worktree copy is restored", () => {
    withTempRepo((root) => {
      writeFile(root, "settings.env", "API_KEY=your_api_key_here\n");
      commitAll(root, "add placeholder settings");
      writeFile(root, "settings.env", `API_KEY=${TEST_API_TOKEN}\n`);
      runGit(root, ["add", "settings.env"]);
      runGit(root, ["restore", "--worktree", "--source=HEAD", "settings.env"]);

      assertHookBlocks(root, /API token/u);
    });
  });

  it("blocks staged-only secrets before the first commit", () => {
    withUnbornTempRepo((root) => {
      writeFile(root, "config.env", `API_KEY=${TEST_API_TOKEN}\n`);
      runGit(root, ["add", "config.env"]);
      writeFile(root, "config.env", "API_KEY=your_api_key_here\n");

      assertHookBlocks(root, /API token/u);
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

  it("skips binary content and oversized files", () => {
    withTempRepo((root) => {
      writeFile(
        root,
        "binary.dat",
        Buffer.from([0, 1, 2, ...Buffer.from(TEST_AWS_ACCESS_KEY)]),
      );
      writeFile(
        root,
        "large.txt",
        `${"a".repeat(1024 * 1024 + 1)}\n${TEST_AWS_ACCESS_KEY}\n`,
      );

      assertHookAllows(root);
    });
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
    // Covers CRLF merge markers a literal line comparison misses: writes that diff and expects no detection.
    it("leaves CRLF merge markers undetected, as a literal line comparison does", () => {
      withTempRepo((root) => {
        // The middle marker is matched as the exact string "=======", so a
        // trailing CR means no match. A grep that strips CR would newly block
        // this file and change the shipped contract.
        writeFile(
          root,
          "conflict.txt",
          "<<<<<<< HEAD\r\nleft\r\n=======\r\nright\r\n>>>>>>> branch\r\n",
        );

        assertHookAllows(root);
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
          [
            TEST_SHORT_GITHUB_TOKEN,
            TEST_SHORT_NPM_TOKEN,
            TEST_UNDERSCORE_API_TOKEN,
            "",
          ].join("\n"),
        );

        assertScannerParity(root, 0);
      });
    });

    it("allows Slack placeholders and standard suppression markers on both paths", () => {
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

        assertScannerParity(root, 0);
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

        assertScannerParity(root, 0, undefined, {
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

        assertScannerParity(root, 0, undefined, {
          GOAT_FLOW_POST_TURN_SAFETY_MAX_BYTES: "64",
        });
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
        resolve(PROJECT_ROOT, ".goat-flow/hooks/post-turn-safety.sh"),
        "utf8",
      ),
      readFileSync(HOOK_PATH, "utf8"),
    );
  });
});
