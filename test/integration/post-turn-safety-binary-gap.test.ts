/**
 * Real-Git regressions for secrets and stale identities behind binary coverage-gap releases.
 *
 * Most cases stop the same fixture session more than once, the way an agent retries after a blocked Stop.
 * A secret must block every replay, and a binary that changes identity must not inherit an earlier release.
 */
import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  TEST_API_TOKEN,
  TEST_GITHUB_TOKEN,
  TEST_PRIVATE_KEY_HEADER,
  TEST_RSA_PRIVATE_KEY_HEADER,
  buildStopPayload,
  commitAll,
  runGit,
  runHook,
  withScannerFileFault,
  withTempRepo,
  writeFile,
} from "./post-turn-safety-hook.helpers.js";

// A minimal GLB header: its NUL bytes make Git and the scanner treat the file as binary.
const BINARY_GLB_HEADER = Buffer.from([103, 108, 84, 70, 2, 0, 0, 0]);
// Text shaped like OpenSSH key data: base64 with upper-case letters, lower-case letters and digits that begins the way an encoded OpenSSH key does.
const TEST_PRIVATE_KEY_DATA =
  "b3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9uZQAAAAAAAAAB".repeat(2);
// The same shape with the two letters every PEM-encoded key begins with, and with a letter a PGP key begins with.
const TEST_PEM_KEY_DATA =
  "MIIEtestKeyData0123456789ABCDEFGHIJKLMNOPabcdefghijklmnop";
const TEST_PGP_KEY_DATA =
  "lQOYtestKeyData0123456789ABCDEFGHIJKLMNOPabcdefghijklmnop";
// A PGP private-key header, joined from parts so this file never holds the literal marker.
const TEST_PGP_PRIVATE_KEY_HEADER = [
  "-----BEGIN",
  "PGP PRIVATE KEY BLOCK-----",
].join(" ");
// A key the way JSON credential files store it: header, data and footer on one line, joined by escaped newlines.
const ONE_LINE_KEY_JSON = `{"private_key": "${TEST_PRIVATE_KEY_HEADER}\\n${TEST_PRIVATE_KEY_DATA}\\n${TEST_PRIVATE_KEY_HEADER.replace("BEGIN", "END")}\\n"}\n`;
// The first bytes of a Linux program. The scanner treats a file that starts with a program signature as a compiled program.
const PROGRAM_START = "\x7fELF\x02\x01\x01\0";

/**
 * Build the first bytes of a Windows program: "MZ", then the position of the "PE" signature stored at byte 60.
 *
 * @returns 68 bytes that the scanner reads as the start of a Windows program
 */
function windowsProgramStart(): Buffer {
  const start = Buffer.alloc(68);
  start.write("MZ", 0, "latin1");
  start.writeUInt32LE(64, 60);
  start.write("PE", 64, "latin1");
  return start;
}

/**
 * Run one Stop for the shared fixture session, as if the agent ended its turn.
 *
 * @param root - fixture repository the agent worked in
 * @param isReplay - true means the provider is retrying after the previous Stop blocked
 * @param env - extra hook environment; empty runs the default scanner
 * @returns hook process result; status 2 means the turn stays blocked
 */
function runStop(
  root: string,
  isReplay: boolean,
  env: Record<string, string> = {},
) {
  return runHook(root, env, buildStopPayload("binary-secret", isReplay));
}

/**
 * List the replay records the scanner saved to allow a later release.
 *
 * @param root - fixture repository whose scratchpad holds the records
 * @returns record file names; empty means no release is armed
 */
function replayRecords(root: string) {
  const directory = join(root, ".goat-flow/scratchpad");
  // No scratchpad yet means the scanner never armed a release.
  return existsSync(directory)
    ? readdirSync(directory).filter((name) =>
        name.startsWith("post-turn-safety-reentry-v1-"),
      )
    : [];
}

describe("binary coverage gaps cannot release secrets", () => {
  // Each row is a file an agent might leave behind that Git calls binary but still holds a detectable secret.
  // A private-key header alone counts, as in a text file, unless the file is a compiled program; a program needs key data too.
  for (const [name, path, content, blockedFinding] of [
    [
      "NUL beside a token",
      "settings.env",
      `API_KEY=${TEST_API_TOKEN}\0\n`,
      "API token",
    ],
    [
      "NUL beyond the binary probe",
      "settings.env",
      `API_KEY=${TEST_API_TOKEN}\n${"a".repeat(40_000)}\0`,
      "API token",
    ],
    [
      "source token beside NUL",
      "src/app.ts",
      `const key = "${TEST_API_TOKEN}";\0\n`,
      "API token",
    ],
    [
      "private key with key data beside NUL",
      "asset.bin",
      `${TEST_PRIVATE_KEY_HEADER}\n${"b3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9uZQAAAAAAAAAB".repeat(2)}\n\0`,
      "private key block",
    ],
    [
      "token beyond the digest chunk",
      "asset.bin",
      `\0${"a".repeat(1_048_560)}\n${TEST_API_TOKEN}\n`,
      "API token",
    ],
    [
      "label far before a token glued to a word character",
      "asset.bin",
      `\0API_KEY=${"a".repeat(3 * 1_048_576)}Z${TEST_API_TOKEN}\n`,
      "API token",
    ],
    [
      "placeholder token before a real one",
      "asset.bin",
      `\0sk-${"x".repeat(40)} ${TEST_API_TOKEN}\n`,
      "API token",
    ],
    [
      "UTF-16LE token",
      "notes.bin",
      Buffer.from(`API_KEY=${TEST_API_TOKEN}\n`, "utf16le"),
      "API token",
    ],
    [
      "UTF-16BE token",
      "notes.bin",
      Buffer.from(`\0API_KEY=${TEST_API_TOKEN}\n`, "utf16le").swap16(),
      "API token",
    ],
    [
      "one-line private key in JSON beside NUL",
      "asset.bin",
      `\0${ONE_LINE_KEY_JSON}`,
      "private key block",
    ],
    [
      "one-line private key in UTF-16LE JSON",
      "key.json",
      Buffer.from(ONE_LINE_KEY_JSON, "utf16le"),
      "private key block",
    ],
    [
      "one-line private key in UTF-16BE JSON",
      "key.json",
      Buffer.from(ONE_LINE_KEY_JSON, "utf16le").swap16(),
      "private key block",
    ],
    [
      "a private-key header with no key data beside NUL",
      "asset.bin",
      `\0${TEST_PRIVATE_KEY_HEADER}\nthe key itself was removed from this export\n`,
      "private key block",
    ],
    [
      "a private-key header alone in UTF-16LE text",
      "notes.txt",
      Buffer.from(
        `Paste the key under ${TEST_PRIVATE_KEY_HEADER} and save.\n`,
        "utf16le",
      ),
      "private key block",
    ],
    [
      "private key lines behind log timestamps in UTF-16LE",
      "signer.log",
      Buffer.from(
        [TEST_PRIVATE_KEY_HEADER, TEST_PRIVATE_KEY_DATA, TEST_PRIVATE_KEY_DATA]
          .map(
            (line, index) => `2026-01-02T03:04:0${index}.000000000Z ${line}\n`,
          )
          .join(""),
        "utf16le",
      ),
      "private key block",
    ],
    [
      "a private-key header in a file that only starts like a Windows program",
      "notes.bin",
      Buffer.concat([
        Buffer.from("MZ", "latin1"),
        Buffer.alloc(70),
        Buffer.from(`${TEST_PRIVATE_KEY_HEADER}\n`, "latin1"),
      ]),
      "private key block",
    ],
    [
      "OpenSSH private key lines built into a program",
      "signer",
      `${PROGRAM_START}${TEST_PRIVATE_KEY_HEADER}\n${TEST_PRIVATE_KEY_DATA}\n${TEST_PRIVATE_KEY_DATA}\n\0`,
      "private key block",
    ],
    [
      "PEM private key lines built into a program",
      "signer",
      `${PROGRAM_START}${TEST_RSA_PRIVATE_KEY_HEADER}\n${TEST_PEM_KEY_DATA}\n${TEST_PEM_KEY_DATA}\n\0`,
      "private key block",
    ],
    [
      "PGP private key lines built into a program",
      "signer",
      `${PROGRAM_START}${TEST_PGP_PRIVATE_KEY_HEADER}\n${TEST_PGP_KEY_DATA}\n${TEST_PGP_KEY_DATA}\n\0`,
      "private key block",
    ],
    [
      "an encrypted private key built into a program",
      "signer",
      `${PROGRAM_START}${TEST_RSA_PRIVATE_KEY_HEADER}\nProc-Type: 4,ENCRYPTED\nDEK-Info: AES-256-CBC,0123456789ABCDEF0123456789ABCDEF\n\0`,
      "private key block",
    ],
    [
      "one-line private key in JSON built into a program",
      "signer",
      `${PROGRAM_START}${ONE_LINE_KEY_JSON}`,
      "private key block",
    ],
    [
      "one-line private key after bare header text on the same line of a program",
      "signer",
      `${PROGRAM_START}{"note": "${TEST_PRIVATE_KEY_HEADER} marks the start of a key", ${ONE_LINE_KEY_JSON.slice(1)}`,
      "private key block",
    ],
    [
      "quoted private key lines embedded in a program",
      "signer",
      `${PROGRAM_START}${[TEST_RSA_PRIVATE_KEY_HEADER, TEST_PEM_KEY_DATA, TEST_PEM_KEY_DATA].map((line) => `  "${line}\\n" +\n`).join("")}\0`,
      "private key block",
    ],
    [
      "one-line private key with PowerShell line breaks embedded in a program",
      "signer",
      `${PROGRAM_START}$pem = "${TEST_RSA_PRIVATE_KEY_HEADER}\`n${TEST_PEM_KEY_DATA}\`n"\n\0`,
      "private key block",
    ],
    [
      "PGP private key lines after three comment lines in a program",
      "signer",
      `${PROGRAM_START}${TEST_PGP_PRIVATE_KEY_HEADER}\n${["Comment: 7A7B 2C3D 4E5F 6A7B 8C9D", "Comment: Build Signing <build@example.invalid>", "Comment: Release Signing <release@example.invalid>"].join("\n")}\n\n${TEST_PGP_KEY_DATA}\n\0`,
      "private key block",
    ],
  ] as const) {
    it(`blocks ${name} on every Stop`, () => {
      withTempRepo((root) => {
        writeFile(root, path, content);
        // The first Stop and both retries must block; a release would show up on a retry.
        for (const isReplay of [false, true, true]) {
          const result = runStop(root, isReplay);
          assert.equal(result.status, 2, result.stderr);
          assert.match(
            String(result.stderr),
            new RegExp(`blocked ${blockedFinding}`, "u"),
          );
          assert.doesNotMatch(String(result.stderr), /ending repeated Stop/u);
        }
        assert.deepEqual(replayRecords(root), []);
      });
    });
  }

  // The worktree copy looks binary, but the staged copy the user would commit holds the token.
  for (const baseline of ["attribute", "binary-head"] as const) {
    it(`blocks staged text hidden by ${baseline} and a binary worktree`, () => {
      withTempRepo((root) => {
        // A `-diff` attribute makes Git report even a text file as binary.
        if (baseline === "attribute")
          writeFile(root, ".gitattributes", "settings.env -diff\n");
        // The committed baseline is either a real binary or harmless text that the attribute makes Git treat as binary.
        writeFile(
          root,
          "settings.env",
          baseline === "binary-head" ? BINARY_GLB_HEADER : "MODE=local\n",
        );
        commitAll(root, "add binary admission baseline");
        writeFile(root, "settings.env", `API_KEY=${TEST_API_TOKEN}\n`);
        runGit(root, ["add", "settings.env"]);
        writeFile(
          root,
          "settings.env",
          Buffer.concat([BINARY_GLB_HEADER, Buffer.from([1])]),
        );
        // Every retry must still block, because the staged copy is what a commit would publish.
        for (const isReplay of [false, true, true]) {
          const result = runStop(root, isReplay);
          assert.equal(result.status, 2, result.stderr);
          assert.match(String(result.stderr), /blocked API token/u);
        }
        assert.deepEqual(replayRecords(root), []);
      });
    });
  }

  it("clears an old record when a forced-binary text view has no binary identity", () => {
    withTempRepo((root) => {
      writeFile(root, ".gitattributes", "settings.env -diff\n");
      writeFile(root, "settings.env", "MODE=baseline\n");
      commitAll(root, "add forced binary baseline");
      writeFile(root, "settings.env", BINARY_GLB_HEADER);
      assert.equal(runStop(root, false).status, 2);
      assert.equal(replayRecords(root).length, 1);

      // The agent turns the file back into text: Git still calls it binary, but it has no NUL byte to identify it.
      writeFile(root, "settings.env", "MODE=changed\n");
      const unavailable = runStop(root, true);
      assert.equal(unavailable.status, 2, unavailable.stderr);
      assert.match(
        String(unavailable.stderr),
        /binary coverage-gap identity unavailable/u,
      );
      assert.doesNotMatch(
        String(unavailable.stderr),
        /repeated-Stop state unavailable/u,
      );
      assert.deepEqual(replayRecords(root), []);

      // A real binary again has to block once on its own before the unchanged retry may release it.
      writeFile(root, "settings.env", BINARY_GLB_HEADER);
      assert.equal(runStop(root, true).status, 2);
      assert.equal(runStop(root, true).status, 0);
    });
  });

  // Each fault changes the file while it is read but keeps its bytes and size, so only the file identity reveals it.
  for (const operation of [
    "replace-during-digest",
    "touch-during-digest",
  ] as const) {
    it(`rejects ${operation} even when the size and bytes stay unchanged`, () => {
      withTempRepo((root) => {
        writeFile(root, "settings.env", BINARY_GLB_HEADER);
        assert.equal(runStop(root, false).status, 2);
        withScannerFileFault(operation, (environment) => {
          const result = runStop(root, true, environment);
          assert.equal(result.status, 2, result.stderr);
          assert.match(
            String(result.stderr),
            /binary coverage-gap identity unavailable/u,
          );
          assert.deepEqual(replayRecords(root), []);
        });
      });
    });
  }
});

/**
 * Build a binary just over the scanner's 256 MiB Git output cap: a GLB header with NUL bytes, then one long run with no line break.
 *
 * @param tail - text after the run; empty means the asset holds no secret
 * @returns asset bytes larger than 256 MiB
 */
function largeBinary(tail: string): Buffer {
  return Buffer.concat([
    BINARY_GLB_HEADER,
    Buffer.alloc(257 * 1_048_576, 0x61),
    Buffer.from(tail),
  ]);
}

describe("large binary gaps are scanned, not stuck", () => {
  it("releases a clean staged binary over 256 MiB after one block", () => {
    withTempRepo((root) => {
      // The user staged a large asset, such as an exported 3D scene, with nothing secret inside.
      writeFile(root, "scene.glb", largeBinary(""));
      runGit(root, ["add", "scene.glb"]);
      assert.equal(runStop(root, false).status, 2);
      // An unchanged retry may end the turn, because both copies were fully scanned.
      const retry = runStop(root, true);
      assert.equal(retry.status, 0, retry.stderr);
    });
  });

  it("blocks a token at the end of a staged binary over 256 MiB on every Stop", () => {
    withTempRepo((root) => {
      writeFile(root, "scene.glb", largeBinary(`\n${TEST_API_TOKEN}\n`));
      runGit(root, ["add", "scene.glb"]);
      // The worktree copy is clean, so only a full scan of the staged copy can find the token.
      writeFile(root, "scene.glb", largeBinary(""));
      // The first Stop and both retries must block, because a commit would publish the staged token.
      for (const isReplay of [false, true, true]) {
        const result = runStop(root, isReplay);
        assert.equal(result.status, 2, result.stderr);
        assert.match(String(result.stderr), /blocked API token/u);
      }
      assert.deepEqual(replayRecords(root), []);
    });
  });

  it("releases a program that only contains key-header text", () => {
    withTempRepo((root) => {
      // Like ssh or a TLS library: the header string sits in a string table, followed by text and an uppercase hex constant, not key data.
      writeFile(
        root,
        "ssh-tool",
        `${PROGRAM_START}${TEST_PRIVATE_KEY_HEADER}\0usage: ssh-tool [options] destination\0${"9292758453063D803DD603D5E777D788".repeat(2)}\n`,
      );
      const first = runStop(root, false);
      assert.equal(first.status, 2, first.stderr);
      assert.doesNotMatch(String(first.stderr), /blocked private key block/u);
      // Header text alone in a compiled program is not key material, so the unchanged retry may end the turn.
      assert.equal(runStop(root, true).status, 0);
    });
  });

  it("releases a program whose key-header text is followed by prose on the same line", () => {
    withTempRepo((root) => {
      // Like an error message in a program: the header is quoted mid-sentence, and no key data follows it.
      writeFile(
        root,
        "key-tool",
        `${PROGRAM_START}error: expected ${TEST_PRIVATE_KEY_HEADER} at the start of the key file, found something else\n`,
      );
      const first = runStop(root, false);
      assert.equal(first.status, 2, first.stderr);
      assert.doesNotMatch(String(first.stderr), /blocked private key block/u);
      // No key data follows the header on its line or on a later one, so the unchanged retry may end the turn.
      assert.equal(runStop(root, true).status, 0);
    });
  });

  // Each row is a program whose header text sits beside long text that is not key data; both layouts once blocked a real build.
  for (const [name, content] of [
    [
      "packed program strings on the header's line",
      `${PROGRAM_START}${TEST_PRIVATE_KEY_HEADER}Look for hardcoded credentialsAudit use of command executionDetect the usage of weak ciphersnode2273736754432320594787597656MapIter.Value called before Next\n`,
    ],
    [
      "a build path right after the header",
      `${PROGRAM_START}${TEST_PRIVATE_KEY_HEADER}\0/home/runner/work/Signer2/Signer2/src/PemKeyReader.c\0`,
    ],
  ] as const) {
    it(`releases a program with key-header text beside ${name}`, () => {
      withTempRepo((root) => {
        writeFile(root, "key-tool", content);
        const first = runStop(root, false);
        assert.equal(first.status, 2, first.stderr);
        assert.doesNotMatch(String(first.stderr), /blocked private key block/u);
        // Neither row holds text that begins like an encoded key where the scanner looks, so the unchanged retry may end the turn.
        assert.equal(runStop(root, true).status, 0);
      });
    });
  }

  // Each row is the start of another kind of compiled program; a build output of any kind may hold header text with no key.
  for (const [kind, start] of [
    ["Windows program", windowsProgramStart()],
    ["macOS program", Buffer.from([0xcf, 0xfa, 0xed, 0xfe, 7, 0, 0, 1])],
    [
      "Java class or macOS universal binary",
      Buffer.from([0xca, 0xfe, 0xba, 0xbe, 0, 0, 0, 0x41]),
    ],
    ["WebAssembly module", Buffer.from([0, 0x61, 0x73, 0x6d, 1, 0, 0, 0])],
    ["static library", Buffer.from("!<arch>\n", "latin1")],
    ["Python bytecode file", Buffer.from([0xcb, 0x0d, 0x0d, 0x0a, 0, 0, 0, 0])],
  ] as const) {
    it(`releases a ${kind} that only contains key-header text`, () => {
      withTempRepo((root) => {
        writeFile(
          root,
          "tool.bin",
          Buffer.concat([
            start,
            Buffer.from(
              `\0${TEST_PRIVATE_KEY_HEADER}\0usage: tool [options]\0`,
              "latin1",
            ),
          ]),
        );
        const first = runStop(root, false);
        assert.equal(first.status, 2, first.stderr);
        assert.doesNotMatch(String(first.stderr), /blocked private key block/u);
        // Header text alone in a compiled program is not key material, so the unchanged retry may end the turn.
        assert.equal(runStop(root, true).status, 0);
      });
    });
  }

  it("does not read every other byte of plain binary text as a token", () => {
    withTempRepo((root) => {
      // Like a library symbol table: ASCII with no NUL beside each character, whose every other byte spells a token shape.
      const interleaved = Array.from(
        TEST_GITHUB_TOKEN,
        (character) => `${character}x`,
      ).join("");
      writeFile(root, "libexample.so", `\0${interleaved}\n`);
      const first = runStop(root, false);
      assert.equal(first.status, 2, first.stderr);
      assert.doesNotMatch(String(first.stderr), /blocked GitHub token/u);
      // Without a real finding, the unchanged retry may end the turn as for any clean binary.
      assert.equal(runStop(root, true).status, 0);
    });
  });

  it("checks a long run of label words quickly", () => {
    withTempRepo((root) => {
      // A megabyte run of repeated label words with no token must finish well inside the scan budget.
      writeFile(root, "labels.bin", `\0${"TOKEN".repeat(209_715)}\n`);
      const started = performance.now();
      const result = runStop(root, false);
      assert.equal(result.status, 2, result.stderr);
      assert.doesNotMatch(String(result.stderr), /budget/u);
      assert.ok(performance.now() - started < 15_000, "the Stop took too long");
    });
  });

  it("removes staged copies left behind by a killed earlier Stop", () => {
    withTempRepo((root) => {
      const scratch = mkdtempSync(join(tmpdir(), "goat-flow-staged-sweep-"));
      try {
        // An earlier hook was killed mid-scan (for example by a provider timeout), so its private copy stayed in the temp folder.
        const stale = join(scratch, "goat-flow-staged-blob-stale");
        mkdirSync(stale);
        writeFileSync(join(stale, "blob"), "stale staged copy\n");
        const twoHoursAgo = new Date(Date.now() - 2 * 3_600_000);
        utimesSync(stale, twoHoursAgo, twoHoursAgo);
        writeFile(root, "scene.glb", BINARY_GLB_HEADER);
        runGit(root, ["add", "scene.glb"]);
        const environment = { TMPDIR: scratch, TMP: scratch, TEMP: scratch };
        assert.equal(runStop(root, false, environment).status, 2);
        assert.equal(existsSync(stale), false);
      } finally {
        rmSync(scratch, { recursive: true, force: true });
      }
    });
  });
});
