/**
 * Integration tests for the universal post-turn safety hook.
 *
 * The hook must work in an arbitrary Git repository with no project-specific
 * toolchain configuration. These tests execute the shipped Bash script against
 * temporary repos instead of mocking the scanner.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { describe, it } from "node:test";

const PROJECT_ROOT = resolve(import.meta.dirname, "..", "..");
const HOOK_PATH = resolve(PROJECT_ROOT, "workflow/hooks/post-turn-safety.sh");
const FORCE_BASH3_ENV_KEY = "GOAT_FLOW_POST_TURN_SAFETY_FORCE_BASH3_FALLBACK";
const TEST_AWS_ACCESS_KEY = `AKIA${"1234567890ABCDEF"}`;
const TEST_GITHUB_TOKEN = `ghp_${"abcdefghijklmnopqrsttestuvwxyzABCD"}`;
const TEST_FINE_GRAINED_GITHUB_TOKEN = `github_pat_${"a".repeat(20)}`;
const TEST_SHORT_GITHUB_TOKEN = `ghp_${"b".repeat(20)}`;
const TEST_NPM_TOKEN = `npm_${"123456789012345678901234567890123456"}`;
const TEST_SHORT_NPM_TOKEN = `npm_${"c".repeat(20)}`;
const TEST_SLACK_TOKEN = `xoxb-${"1234567890-1234567890-abcdef"}`;
const TEST_API_TOKEN = `sk-${"12345678901234567890123456789012"}`;
const TEST_UNDERSCORE_API_TOKEN = `sk-${"d".repeat(16)}_${"e".repeat(16)}`;
const TEST_CLIENT_SECRET = ["7Hk9Lm2Qr8Tv5Wx1Zb4Nc6", "Df"].join("");
const TEST_INI_PASSWORD = ["S3cr3tP4ssw0rd", "X"].join("");
const TEST_PRIVATE_KEY_HEADER = ["-----BEGIN", "OPENSSH PRIVATE KEY-----"].join(
  " ",
);
const TEST_RSA_PRIVATE_KEY_HEADER = ["-----BEGIN", "RSA PRIVATE KEY-----"].join(
  " ",
);
const TEST_RSA_PRIVATE_KEY_FOOTER = ["-----END", "RSA PRIVATE KEY-----"].join(
  " ",
);
const TEST_RSA_PRIVATE_KEY_BODY = ["MIIEpAIBAAKCAQEA", "1234567890abcdef"].join(
  "",
);
const TEST_JWT_TOKEN = [
  "eyJhbGciOiJIUzI1NiJ9",
  "eyJzdWIiOiIxMjM0NTY3ODkwIn0",
  ["SflKxwRJSMeK", "KF2QT4fwpMeJ", "f36POk6yJV_adQssw5c"].join(""),
].join(".");
const TEST_DOCUMENTED_AWS_PLACEHOLDER = `AKIA${"IOSFODNN7EXAMPLE"}`;
const TEST_DOCUMENTED_SLACK_PLACEHOLDER = `xoxb-${"test-1234567890-1234567890"}`;

/** Writes and removes one committed temporary repository around a safety-hook scenario. */
function withTempRepo(fn: (root: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), "goat-flow-post-turn-safety-"));
  try {
    runGit(root, ["init", "-q"]);
    writeFile(root, "README.md", "# fixture\n");
    commitAll(root, "initial");
    fn(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

/** Writes and removes one unborn temporary repository around a first-commit scenario. */
function withUnbornTempRepo(fn: (root: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), "goat-flow-post-turn-safety-"));
  try {
    runGit(root, ["init", "-q"]);
    fn(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

/** Writes one fixture file and its required parent directories. */
function writeFile(root: string, path: string, content: string | Buffer): void {
  const target = join(root, path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content);
}

/** Spawns one Git fixture command and fails the active test with captured output on error. */
function runGit(root: string, args: string[]): string {
  const result = spawnSync("git", args, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  assert.equal(
    result.status,
    0,
    `git ${args.join(" ")} failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
  );
  return result.stdout.trim();
}

/** Commit the complete fixture state so later edits are visible as changed repository content. */
function commitAll(root: string, message: string): void {
  runGit(root, ["add", "."]);
  runGit(root, [
    "-c",
    "user.name=goat-flow-test",
    "-c",
    "user.email=goat-flow-test@example.invalid",
    "commit",
    "-m",
    message,
  ]);
}

function runHook(
  root: string,
  env?: Record<string, string>,
): ReturnType<typeof spawnSync> {
  return spawnSync("bash", [HOOK_PATH], {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, ...env },
  });
}

/**
 * Normalize scanner-specific prose to the common finding-family/path decision.
 *
 * Callers compare these signatures across scanner implementations, so the
 * returned shape is a stable contract: same family and path in, same signature
 * out, regardless of which scanner produced the wording.
 */
function hookFindingSignatures(stderr: string): string[] {
  return stderr
    .split("\n")
    .flatMap((line) => {
      const nativePrefix = "post-turn-safety: blocked ";
      const compatibilityPrefix = "post-turn-safety: ";
      const compatibilitySuffix = " (Bash 3 compatibility scan).";
      if (line.startsWith(nativePrefix)) {
        return [line.slice(nativePrefix.length)];
      }
      if (
        line.startsWith(compatibilityPrefix) &&
        line.endsWith(compatibilitySuffix)
      ) {
        return [
          line.slice(compatibilityPrefix.length, -compatibilitySuffix.length),
        ];
      }
      return [];
    })
    .sort();
}

/** Execute the real hook and prove the fixture reaches the allowed exit path. */
function assertHookAllows(root: string, env?: Record<string, string>): void {
  const explicitlySelectedScanner = env?.[FORCE_BASH3_ENV_KEY] !== undefined;
  const result = runHook(
    root,
    explicitlySelectedScanner
      ? env
      : { ...(env ?? {}), [FORCE_BASH3_ENV_KEY]: "0" },
  );
  assert.equal(
    result.status,
    0,
    `hook should allow fixture\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
  );
  if (!explicitlySelectedScanner) {
    const compatibilityResult = runHook(root, {
      ...(env ?? {}),
      [FORCE_BASH3_ENV_KEY]: "1",
    });
    assert.equal(
      compatibilityResult.status,
      result.status,
      `scanner decisions differ\nnative stderr:\n${result.stderr}\nfallback stderr:\n${compatibilityResult.stderr}`,
    );
    assert.deepStrictEqual(
      hookFindingSignatures(compatibilityResult.stderr),
      hookFindingSignatures(result.stderr),
    );
  }
}

function assertHookBlocks(
  root: string,
  expectedPattern: RegExp,
  env?: Record<string, string>,
): ReturnType<typeof spawnSync> {
  const explicitlySelectedScanner = env?.[FORCE_BASH3_ENV_KEY] !== undefined;
  const result = runHook(
    root,
    explicitlySelectedScanner
      ? env
      : { ...(env ?? {}), [FORCE_BASH3_ENV_KEY]: "0" },
  );
  assert.equal(
    result.status,
    2,
    `hook should block fixture\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
  );
  assert.match(result.stderr, expectedPattern);
  assert.doesNotMatch(result.stderr, /validation/u);
  if (!explicitlySelectedScanner) {
    const compatibilityResult = runHook(root, {
      ...(env ?? {}),
      [FORCE_BASH3_ENV_KEY]: "1",
    });
    assert.equal(
      compatibilityResult.status,
      result.status,
      `scanner decisions differ\nnative stderr:\n${result.stderr}\nfallback stderr:\n${compatibilityResult.stderr}`,
    );
    assert.deepStrictEqual(
      hookFindingSignatures(compatibilityResult.stderr),
      hookFindingSignatures(result.stderr),
    );
    assert.match(compatibilityResult.stderr, expectedPattern);
    assert.doesNotMatch(compatibilityResult.stderr, /validation/u);
  }
  return result;
}

describe("post-turn-safety hook", () => {
  describe("must-block fixtures", () => {
    const fixtures = [
      {
        name: "full merge conflict",
        path: "src/conflict.txt",
        content: [
          "<<<<<<< HEAD",
          "left",
          "=======",
          "right",
          ">>>>>>> branch",
          "",
        ].join("\n"),
        pattern: /merge conflict marker/u,
      },
      {
        name: "AWS access key",
        path: ".env",
        content: `AWS_ACCESS_KEY_ID=${TEST_AWS_ACCESS_KEY}\n`,
        pattern: /AWS access key/u,
      },
      {
        name: "GitHub token",
        path: "tokens.env",
        content: `GITHUB_TOKEN=${TEST_GITHUB_TOKEN}\n`,
        pattern: /GitHub token/u,
      },
      {
        name: "npm token",
        path: "tokens.env",
        content: `NPM_TOKEN=${TEST_NPM_TOKEN}\n`,
        pattern: /npm token/u,
      },
      {
        name: "Slack token",
        path: "tokens.env",
        content: `SLACK_BOT_TOKEN=${TEST_SLACK_TOKEN}\n`,
        pattern: /Slack token/u,
      },
      {
        name: "OpenAI token",
        path: "tokens.env",
        content: `OPENAI_API_KEY=${TEST_API_TOKEN}\n`,
        pattern: /API token/u,
      },
      {
        name: "RSA private key block",
        path: "private.pem",
        content: [
          TEST_RSA_PRIVATE_KEY_HEADER,
          TEST_RSA_PRIVATE_KEY_BODY,
          TEST_RSA_PRIVATE_KEY_FOOTER,
          "",
        ].join("\n"),
        pattern: /private key block/u,
      },
      {
        name: "bare hardcoded client secret",
        path: "config.yaml",
        content: `client_secret: ${TEST_CLIENT_SECRET}\n`,
        pattern: /credential assignment \(client_secret\)/u,
      },
      {
        name: "ini password",
        path: "app.ini",
        content: `password=${TEST_INI_PASSWORD}\n`,
        pattern: /credential assignment \(password\)/u,
      },
      {
        name: "quoted opaque password",
        path: "settings.yaml",
        content: `password: "${TEST_INI_PASSWORD}"\n`,
        pattern: /credential assignment \(password\)/u,
      },
    ];

    for (const fixture of fixtures) {
      it(`blocks ${fixture.name}`, () => {
        withTempRepo((root) => {
          writeFile(root, fixture.path, fixture.content);

          assertHookBlocks(root, fixture.pattern);
        });
      });
    }
  });

  describe("must-pass fixtures", () => {
    const fixtures = [
      {
        name: "Symfony env and parameter references",
        path: "config/packages/secrets.yaml",
        content: [
          "secret: '%env(APP_SECRET)%'",
          'secret: "%env(APP_SECRET)%"',
          "password: '%database_password%'",
          "secret: '%mercure_jwt_secret%'",
          "client_secret: '%env(string:key:xero_client_secret:json:aws_secret:ENV_AWSPROD_EU_XERO)%'",
          "private_key: '%env(string:key:braintree_private_key:json:aws_secret:ENV_AWSPROD_EU_BRAINTREE)%'",
          "bearer_token: '%env(API_TOKEN)%'",
          "",
        ].join("\n"),
      },
      {
        name: "human-readable credential prose",
        path: "translations/security.yaml",
        content: [
          "password: 'Please enter your password'",
          "token: 'Your verification token has expired'",
          "secret: 'Keep this secret safe at all times'",
          "",
        ].join("\n"),
      },
      {
        name: "template interpolations",
        path: "config/templates.yaml",
        content: [
          'api_key: "${API_TOKEN}"',
          'password: "$(secretctl read database_password)"',
          "secret: '{{ vault.secret }}'",
          "client_secret: '<%= ENV.fetch(\"CLIENT_SECRET\") %>'",
          "",
        ].join("\n"),
      },
      {
        name: "Markdown setext heading",
        path: "docs.md",
        content: "Section\n=======\n",
      },
      {
        name: "inline allow comment",
        path: ".env",
        content: `API_KEY=${TEST_API_TOKEN} # goat-flow-allow-secret\n`,
      },
    ];

    for (const fixture of fixtures) {
      it(`allows ${fixture.name}`, () => {
        withTempRepo((root) => {
          writeFile(root, fixture.path, fixture.content);

          assertHookAllows(root);
        });
      });
    }
  });

  it("blocks high-confidence secrets in untracked text files", () => {
    withTempRepo((root) => {
      writeFile(root, ".env", `AWS_ACCESS_KEY_ID=${TEST_AWS_ACCESS_KEY}\n`);

      assertHookBlocks(root, /AWS access key/u);
    });
  });

  it("blocks private key blocks in tracked diffs", () => {
    withTempRepo((root) => {
      writeFile(root, "keys.txt", "safe\n");
      commitAll(root, "add key placeholder");
      writeFile(root, "keys.txt", `${TEST_PRIVATE_KEY_HEADER}\nabc\n`);

      assertHookBlocks(root, /private key block/u);
    });
  });

  it("blocks merge conflict markers in changed text", () => {
    withTempRepo((root) => {
      writeFile(
        root,
        "src/conflict.txt",
        "<<<<<<< HEAD\nleft\n=======\nright\n>>>>>>> branch\n",
      );

      assertHookBlocks(root, /merge conflict marker/u);
    });
  });

  it("allows safe placeholders in env examples", () => {
    withTempRepo((root) => {
      writeFile(root, ".env.example", "API_KEY=your_api_key_here\n");

      assertHookAllows(root);
    });
  });

  it("blocks real tokens on lines that also mention placeholder words", () => {
    withTempRepo((root) => {
      // The line contains "test", which previously short-circuited the whole
      // line past the raw token detectors and let the real token through.
      writeFile(root, "config.txt", `webhook_test = ${TEST_SLACK_TOKEN}\n`);

      assertHookBlocks(root, /Slack token/u);
    });
  });

  it("blocks API tokens when only the surrounding label is placeholder text", () => {
    withTempRepo((root) => {
      writeFile(root, "config.txt", `OPENAI test key ${TEST_API_TOKEN}\n`);

      assertHookBlocks(root, /API token/u);
    });
  });

  it("blocks bare sk-prefixed API tokens without a provider label", () => {
    withTempRepo((root) => {
      writeFile(root, "config.txt", `plain token ${TEST_API_TOKEN}\n`);

      assertHookBlocks(root, /API token/u);
    });
  });

  it("blocks exported credential assignments", () => {
    withTempRepo((root) => {
      writeFile(
        root,
        "settings.sh",
        "export API_KEY=live-secret-value-12345\n",
      );

      assertHookBlocks(root, /credential assignment \(API_KEY\)/u);
    });
  });

  it("blocks quoted credential assignments containing hash characters", () => {
    withTempRepo((root) => {
      writeFile(root, ".env", 'API_KEY="live-secret#value-12345"\n');

      assertHookBlocks(root, /credential assignment \(API_KEY\)/u);
    });
  });

  it("blocks lowercase credential assignment keys", () => {
    withTempRepo((root) => {
      writeFile(root, "settings.env", "api_key=live-secret-value-12345\n");

      assertHookBlocks(root, /credential assignment \(api_key\)/u);
    });
  });

  it("blocks Dockerfile ARG and ENV credential assignments", () => {
    withTempRepo((root) => {
      writeFile(
        root,
        "Dockerfile",
        [
          "ARG CLIENT_SECRET=LiteralDockerSecret123",
          "ARG AUTH_TOKEN LiteralDockerArgSecret123",
          'ENV API_TOKEN="LiteralDockerToken123"',
          "ENV SECRET_KEY LiteralDockerEnvSecret123",
          "",
        ].join("\n"),
      );

      const result = assertHookBlocks(
        root,
        /credential assignment \(CLIENT_SECRET\)/u,
      );
      assert.match(result.stderr, /credential assignment \(AUTH_TOKEN\)/u);
      assert.match(result.stderr, /credential assignment \(API_TOKEN\)/u);
      assert.match(result.stderr, /credential assignment \(SECRET_KEY\)/u);
    });
  });

  it("blocks Dockerfile multi-assignment ENV credentials", () => {
    withTempRepo((root) => {
      writeFile(
        root,
        "Dockerfile",
        [
          "ENV SAFE=x API_TOKEN=LiteralDockerToken123",
          "ENV CLIENT_SECRET=LiteralDockerSecret123 SAFE=x",
          "",
        ].join("\n"),
      );

      const result = assertHookBlocks(
        root,
        /credential assignment \(API_TOKEN\)/u,
      );
      assert.match(result.stderr, /credential assignment \(CLIENT_SECRET\)/u);
    });
  });

  it("allows Dockerfile non-secret multi-assignment ENV values", () => {
    withTempRepo((root) => {
      writeFile(
        root,
        "Dockerfile",
        [
          "ENV SAFE=x TOKEN_COUNT=LiteralTokenCount123 API_TOKEN=$BUILD_TOKEN",
          "ARG CLIENT_SECRET",
          "# ENV API_TOKEN=LiteralDockerToken123",
          "",
        ].join("\n"),
      );

      assertHookAllows(root);
    });
  });

  it("blocks literal credential assignment forms", () => {
    withTempRepo((root) => {
      writeFile(
        root,
        "settings.env",
        [
          `API_TOKEN = "${TEST_GITHUB_TOKEN}"`,
          'export SECRET_KEY="aVeryLongRealSecretValue123"',
          'password = "hunter2hunter2hunter2"',
          `api_key: "${TEST_API_TOKEN}"`,
          "CLIENT_SECRET=Zx9AbCdEf123456",
          'CLIENT_SECRETS="Zx9AbCdEf123456"',
          'DB_PASSWORDS="dbPasswordValue123"',
          "auth_token = 8f3c1a9b7e2d4f60aa11",
          `bearer_token = ${TEST_JWT_TOKEN}`,
          "",
        ].join("\n"),
      );

      const result = assertHookBlocks(
        root,
        /credential assignment \(API_TOKEN\)/u,
      );
      assert.match(result.stderr, /credential assignment \(SECRET_KEY\)/u);
      assert.match(result.stderr, /credential assignment \(password\)/u);
      assert.match(result.stderr, /credential assignment \(api_key\)/u);
      assert.match(result.stderr, /credential assignment \(CLIENT_SECRET\)/u);
      assert.match(result.stderr, /credential assignment \(CLIENT_SECRETS\)/u);
      assert.match(result.stderr, /credential assignment \(DB_PASSWORDS\)/u);
      assert.match(result.stderr, /credential assignment \(auth_token\)/u);
      assert.match(result.stderr, /credential assignment \(bearer_token\)/u);
    });
  });

  it("blocks camelCase credential assignment keys", () => {
    withTempRepo((root) => {
      writeFile(
        root,
        "settings.yaml",
        [
          'clientSecret: "CamelClientSecret123"',
          'authToken: "CamelAuthToken123"',
          'refreshToken: "CamelRefreshToken123"',
          'secretKey: "CamelSecretKey123"',
          'privateKey: "CamelPrivateKey123"',
          "",
        ].join("\n"),
      );

      const result = assertHookBlocks(
        root,
        /credential assignment \(clientSecret\)/u,
      );
      assert.match(result.stderr, /credential assignment \(authToken\)/u);
      assert.match(result.stderr, /credential assignment \(refreshToken\)/u);
      assert.match(result.stderr, /credential assignment \(secretKey\)/u);
      assert.match(result.stderr, /credential assignment \(privateKey\)/u);
    });
  });

  it("allows excluded camelCase credential metadata keys", () => {
    withTempRepo((root) => {
      writeFile(
        root,
        "settings.yaml",
        [
          'tokenCount: "LiteralTokenCount123"',
          'secretName: "LiteralSecretName123"',
          'passwordField: "LiteralPasswordField123"',
          'clientSecretId: "CamelSecretId123"',
          'notASecret: "LiteralNotSecret123"',
          'nonSecret: "LiteralNonSecret123"',
          'notAToken: "LiteralNotToken123"',
          "authToken: getToken()",
          "clientSecret: config.clientSecret",
          "",
        ].join("\n"),
      );

      assertHookAllows(root);
    });
  });

  it("allows interpolated double-quoted credential expressions", () => {
    withTempRepo((root) => {
      writeFile(root, ".env.local", 'API_KEY="${PREFIX}SecretValue123"\n');

      assertHookAllows(root);
    });
  });

  it("allows token-like source-code expressions", () => {
    withTempRepo((root) => {
      writeFile(
        root,
        "query_scrub.py",
        [
          'tokens = re.findall(r"[a-z0-9]+", message)',
          "token_count = len(items)",
          'next_token = page["next_token"]',
          "access_token = get_token()",
          "self.tokens = tokens",
          "tokenizer = build_tokenizer(cfg)",
          "secret = compute_secret(seed)",
          'password_field = form["password"]',
          "refresh_token = cached_token",
          "auth_token = settings.API_TOKEN1",
          "auth_token = SETTINGS.API_TOKEN1",
          "password = config.DEFAULT_PASSWORD1",
          "password = Config.DEFAULT_PASSWORD1",
          "client_secret = prefix+Suffix123",
          "client_secret = PREFIX+Suffix123",
          "",
        ].join("\n"),
      );

      assertHookAllows(root);
    });
  });

  it("does not run generic credential-assignment guessing in source files", () => {
    withTempRepo((root) => {
      writeFile(
        root,
        "app.py",
        [
          'API_TOKEN = "LiteralSourceSecret123"',
          'CLIENT_SECRET = "ClientSourceSecret123"',
          "",
        ].join("\n"),
      );

      assertHookAllows(root);
    });
  });

  it("keeps provider token scanning active in source files", () => {
    withTempRepo((root) => {
      writeFile(root, "app.py", `API_TOKEN = "${TEST_API_TOKEN}"\n`);

      assertHookBlocks(root, /API token/u);
    });
  });

  it("blocks token values with placeholder words embedded as ordinary characters", () => {
    withTempRepo((root) => {
      writeFile(root, "config.txt", `GITHUB_TOKEN=${TEST_GITHUB_TOKEN}\n`);

      assertHookBlocks(root, /GitHub token/u);
    });
  });

  it("allows documented example tokens whose value is a known placeholder", () => {
    withTempRepo((root) => {
      writeFile(
        root,
        "docs.md",
        [
          `AWS_ACCESS_KEY_ID=${TEST_DOCUMENTED_AWS_PLACEHOLDER}`,
          `SLACK_BOT_TOKEN=${TEST_DOCUMENTED_SLACK_PLACEHOLDER}`,
          "",
        ].join("\n"),
      );

      assertHookAllows(root);
    });
  });

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
