/**
 * Dashboard /api/setup/detect endpoint: detects the project stack and useful mixed-root setup
 * signals without running deep stack detection, stays bounded (under a latency budget) on large
 * root-first projects, and never calls the full stack detector from the setup-detect route helpers.
 */
import {
  assert,
  describe,
  expectRecord,
  fetchJson,
  it,
  join,
  mkdtemp,
  performance,
  PROJECT_PATH,
  readFile,
  resolve,
  rm,
  tmpdir,
  writeProjectFile,
} from "./dashboard-server.helpers.js";
describe("dashboard /api/setup/detect", () => {
  it("detects the project stack", async () => {
    const { res, body } = await fetchJson(
      `/api/setup/detect?path=${encodeURIComponent(PROJECT_PATH)}`,
    );
    assert.equal(res.status, 200);

    const payload = expectRecord(body, "Setup detect response");
    assert.ok(Array.isArray(payload.languages));
    assert.ok((payload.languages as unknown[]).includes("TypeScript"));
    assert.ok(Array.isArray(payload.frameworks));
    const commands = expectRecord(payload.commands, "Setup detect commands");
    assert.equal(typeof commands.build, "string");
    assert.equal(typeof commands.test, "string");
    assert.equal(typeof commands.lint, "string");
    assert.equal(typeof commands.format, "string");
    expectRecord(payload.agents, "Setup detect agents");
    expectRecord(payload.existing, "Setup detect existing");
    assert.ok(Array.isArray(payload.nonGoatFlow));
  });

  it("detects useful mixed-root setup signals without deep stack detection", async () => {
    const root = await mkdtemp(join(tmpdir(), "goat-flow-setup-detect-"));
    try {
      await writeProjectFile(
        root,
        "package.json",
        JSON.stringify({
          scripts: {
            build: "vite build",
            "test:unit": "vitest run",
            lint: "eslint .",
            format: "prettier --check .",
          },
          dependencies: { react: "^19.0.0" },
          devDependencies: { typescript: "^5.0.0" },
        }),
      );
      await writeProjectFile(root, "tsconfig.json", "{}");
      await writeProjectFile(
        root,
        "composer.json",
        JSON.stringify({
          require: {
            "symfony/framework-bundle": "6.4.*",
            "twig/twig": "^3.0",
          },
          scripts: { analyse: "phpstan analyse" },
        }),
      );
      await writeProjectFile(root, "symfony.lock", "{}");
      await writeProjectFile(root, "phpunit.xml.dist", "<phpunit />");
      await writeProjectFile(root, "Dockerfile", "FROM node:20\n");

      const { res, body } = await fetchJson(
        `/api/setup/detect?path=${encodeURIComponent(root)}`,
      );
      assert.equal(res.status, 200);

      const payload = expectRecord(body, "Mixed setup detect response");
      assert.deepEqual(payload.languages, [
        "JavaScript",
        "TypeScript",
        "PHP",
        "Twig",
      ]);
      assert.deepEqual(payload.frameworks, ["React", "Symfony", "Docker"]);
      const commands = expectRecord(payload.commands, "Mixed setup commands");
      assert.equal(commands.build, "vite build");
      assert.equal(commands.test, "npm run test:unit");
      assert.equal(commands.lint, "eslint .");
      assert.equal(commands.format, "prettier --check .");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("keeps setup detection bounded on large root-first projects", async () => {
    const root = await mkdtemp(join(tmpdir(), "goat-flow-large-setup-detect-"));
    try {
      await writeProjectFile(
        root,
        "package.json",
        JSON.stringify({
          scripts: { build: "npm run compile", test: "node --test" },
          devDependencies: { typescript: "^5.0.0" },
        }),
      );
      await writeProjectFile(root, "tsconfig.json", "{}");
      for (let index = 0; index < 250; index += 1) {
        await writeProjectFile(
          root,
          `packages/pkg-${index}/nested/deeper/file-${index}.txt`,
          "x",
        );
      }

      const start = performance.now();
      const { res, body } = await fetchJson(
        `/api/setup/detect?path=${encodeURIComponent(root)}`,
      );
      const durationMs = performance.now() - start;
      assert.equal(res.status, 200);
      const payload = expectRecord(body, "Large setup detect response");
      assert.ok((payload.languages as unknown[]).includes("TypeScript"));
      assert.ok(
        durationMs < 1000,
        `setup detect should stay bounded on large trees (${durationMs.toFixed(1)}ms)`,
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("does not call the full stack detector from setup-detect route helpers", async () => {
    const source = await readFile(
      resolve(PROJECT_PATH, "src/cli/server/setup-detect.ts"),
      "utf-8",
    );
    assert.doesNotMatch(source, /detectStack\(/);
    assert.doesNotMatch(source, /detectSetupStack\(/);
    assert.doesNotMatch(source, /existsGlob\(/);
  });
});
