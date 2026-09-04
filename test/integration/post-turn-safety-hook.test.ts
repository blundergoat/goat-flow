/**
 * What the hook must block and must allow in changed content: real-looking tokens in every
 * assignment shape, placeholders that stay permitted, and the source-file carve-outs that
 * keep ordinary code from tripping credential guessing.
 * Every case runs the real hook against a real git repository, so a pass means the shipped
 * scanner behaves as asserted, not a reimplementation of it.
 */
import assert from "node:assert/strict";
import {
  mkdtempSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import {
  FORCE_BASH3_ENV_KEY,
  TEST_AWS_ACCESS_KEY,
  TEST_GITHUB_TOKEN,
  TEST_NPM_TOKEN,
  TEST_SLACK_TOKEN,
  TEST_API_TOKEN,
  TEST_UNDERSCORE_API_TOKEN,
  TEST_OPENAI_PROJECT_TOKEN,
  TEST_ANTHROPIC_API_TOKEN,
  withTempRepo,
  withUnbornTempRepo,
  writeFile,
  runGit,
  runHook,
  runHookCommand,
  commitAll,
  assertHookAllows,
  assertHookBlocks,
  TEST_CLIENT_SECRET,
  TEST_INI_PASSWORD,
  TEST_PRIVATE_KEY_HEADER,
  TEST_RSA_PRIVATE_KEY_HEADER,
  TEST_RSA_PRIVATE_KEY_FOOTER,
  TEST_RSA_PRIVATE_KEY_BODY,
  TEST_JWT_TOKEN,
  TEST_DOCUMENTED_AWS_PLACEHOLDER,
  TEST_DOCUMENTED_SLACK_PLACEHOLDER,
} from "./post-turn-safety-hook.helpers.js";

const POST_TURN_SCANNER_VARIANTS = [
  { displayName: "native scanner", forceBash3Fallback: "0" },
  { displayName: "Bash 3 compatibility scanner", forceBash3Fallback: "1" },
] as const;

describe("post-turn-safety hook: secret and marker detection", () => {
  it("removes the native scan workspace when the process exits", () => {
    withTempRepo((root) => {
      const temporaryRoot = mkdtempSync(
        join(tmpdir(), "goat-flow-post-turn-workspace-"),
      );
      try {
        const result = runHook(root, {
          TMPDIR: temporaryRoot,
          [FORCE_BASH3_ENV_KEY]: "0",
        });

        assert.equal(result.status, 0, result.stderr);
        assert.deepEqual(readdirSync(temporaryRoot), []);
      } finally {
        rmSync(temporaryRoot, { recursive: true, force: true });
      }
    });
  });

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

    // Each case creates a temporary Git repo, writes the secret fixture, and runs the hook.
    for (const fixture of fixtures) {
      it(`blocks ${fixture.name}`, () => {
        withTempRepo((projectRoot) => {
          writeFile(projectRoot, fixture.path, fixture.content);

          assertHookBlocks(projectRoot, fixture.pattern);
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
          "se" + "cret: '%env(APP_SECRET)%'",
          "se" + 'cret: "%env(APP_SECRET)%"',
          "pass" + "word: '%database_password%'",
          "se" + "cret: '%mercure_jwt_secret%'",
          "client_se" +
            "cret: '%env(string:key:xero_client_secret:json:aws_secret:ENV_AWSPROD_EU_XERO)%'",
          "private_key: '%env(string:key:braintree_private_key:json:aws_secret:ENV_AWSPROD_EU_BRAINTREE)%'",
          "bearer_to" + "ken: '%env(API_TOKEN)%'",
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
          "pass" + 'word: "$(secretctl read database_password)"',
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
    ];

    // Each case creates a temporary Git repo, writes the safe fixture, and runs the hook.
    for (const fixture of fixtures) {
      it(`allows ${fixture.name}`, () => {
        withTempRepo((projectRoot) => {
          writeFile(projectRoot, fixture.path, fixture.content);

          assertHookAllows(projectRoot);
        });
      });
    }
  });

  it("blocks a new finding that carries its own suppression marker", () => {
    withTempRepo((root) => {
      writeFile(
        root,
        ".env",
        `API_KEY=${TEST_API_TOKEN} # goat-flow-allow-secret\n`,
      );

      const result = assertHookBlocks(root, /API token/u);
      assert.equal(result.stderr.includes(TEST_API_TOKEN), false);
    });
  });

  it("leaves an unchanged reviewed suppression outside changed scope", () => {
    withTempRepo((root) => {
      writeFile(
        root,
        "reviewed.env",
        `API_KEY=${TEST_API_TOKEN} # goat-flow-allow-secret\n`,
      );
      commitAll(root, "record reviewed suppression");
      writeFile(root, "notes.txt", "safe user-facing change\n");

      assertHookAllows(root);
    });
  });

  // Fixture purpose: covers segmented provider tokens that must never appear in hook feedback.
  const providerTokenFixtures = [
    {
      displayName: "underscore token",
      path: "underscore.txt",
      value: TEST_UNDERSCORE_API_TOKEN,
    },
    {
      displayName: "OpenAI project token",
      path: "openai-project.txt",
      value: TEST_OPENAI_PROJECT_TOKEN,
    },
    {
      displayName: "Anthropic token",
      path: "anthropic.txt",
      value: TEST_ANTHROPIC_API_TOKEN,
    },
  ];
  // Each current provider shape must give users the same safe diagnostic on both scanners.
  for (const providerTokenFixture of providerTokenFixtures) {
    // Separate names show whether native or compatibility scanning failed for the user.
    for (const scannerVariant of POST_TURN_SCANNER_VARIANTS) {
      // This case creates a temporary Git repo, writes a token, and runs the shell hook.
      it(`blocks the ${providerTokenFixture.displayName} with the ${scannerVariant.displayName} without printing its body`, () => {
        withTempRepo((projectRoot) => {
          writeFile(
            projectRoot,
            providerTokenFixture.path,
            `provider token ${providerTokenFixture.value}\n`,
          );
          const hookResult = runHook(projectRoot, {
            [FORCE_BASH3_ENV_KEY]: scannerVariant.forceBash3Fallback,
          });

          assert.equal(hookResult.status, 2, hookResult.stderr);
          assert.match(hookResult.stderr, /API token/u);
          assert.equal(
            hookResult.stderr.includes(providerTokenFixture.value),
            false,
          );
        });
      });
    }
  }

  // Each named case creates a temporary Git repo and sends malformed provider input.
  for (const scannerVariant of POST_TURN_SCANNER_VARIANTS) {
    it(`fails closed on malformed Stop input with the ${scannerVariant.displayName}`, () => {
      withTempRepo((projectRoot) => {
        const hookResult = runHook(
          projectRoot,
          { [FORCE_BASH3_ENV_KEY]: scannerVariant.forceBash3Fallback },
          "{invalid-json",
        );

        assert.equal(hookResult.status, 2, hookResult.stderr);
        assert.match(hookResult.stderr, /invalid Stop payload/iu);
      });
    });
  }

  it("runs self-test explicitly and rejects unknown options", () => {
    withTempRepo((root) => {
      const selfTestResult = runHookCommand(root, ["--self-test"]);
      assert.equal(selfTestResult.status, 0, selfTestResult.stderr);
      assert.match(selfTestResult.stdout, /post-turn-safety self-test: ok/u);

      const unknownOptionResult = runHookCommand(root, ["--unknown"]);
      assert.equal(unknownOptionResult.status, 2, unknownOptionResult.stderr);
      assert.match(unknownOptionResult.stderr, /Usage:/u);
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

  it("blocks high-confidence secrets in untracked text files", () => {
    withTempRepo((root) => {
      writeFile(root, ".env", `AWS_ACCESS_KEY_ID=${TEST_AWS_ACCESS_KEY}\n`);

      assertHookBlocks(root, /AWS access key/u);
    });
  });

  it("does not follow untracked symlinks outside the repository", () => {
    const outsideRoot = mkdtempSync(
      join(tmpdir(), "goat-flow-post-turn-symlink-"),
    );
    try {
      const outsideFile = join(outsideRoot, "outside.txt");
      writeFileSync(outsideFile, `AWS_ACCESS_KEY_ID=${TEST_AWS_ACCESS_KEY}\n`);
      withTempRepo((root) => {
        symlinkSync(outsideFile, join(root, "untracked-link.txt"));

        assertHookAllows(root);
      });
    } finally {
      rmSync(outsideRoot, { recursive: true, force: true });
    }
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
          "pass" + 'word = "hunter2hunter2hunter2"',
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
});
