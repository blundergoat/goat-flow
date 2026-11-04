/** Real filesystem fixtures protect shipped generation, mirror drift and fail-closed checks. */
import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { pathToFileURL } from "node:url";
import ts from "typescript";
import { generateHookRuntime } from "../../scripts/generate-hook-runtime.mjs";

function fixture(t: TestContext): string {
  const root = mkdtempSync(join(tmpdir(), "goat-hook-generation-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  // Synthetic package metadata isolates generation from the developer's checkout.
  writeFileSync(
    join(root, "package.json"),
    JSON.stringify({ version: "1.19.0" }),
  );
  writeFileSync(
    join(root, "package-lock.json"),
    JSON.stringify({
      packages: { "node_modules/typescript": { version: ts.version } },
    }),
  );
  return root;
}

function addSources(root: string): void {
  mkdirSync(join(root, "src/hooks/nested"), { recursive: true });
  writeFileSync(
    join(root, "src/hooks/main.mts"),
    '#!/usr/bin/env node\nimport { value } from "./nested/value.mjs";\n/** Retain this source-owned license/comment contract. */\nexport const answer: number = value;\n',
  );
  writeFileSync(
    join(root, "src/hooks/nested/value.mts"),
    "export const value: number = 42;\n",
  );
  mkdirSync(join(root, "workflow/hooks"), { recursive: true });
  writeFileSync(
    join(root, "workflow/hooks/shared.mjs"),
    "export const shared = true;\n",
  );
}

test("generation rejects shorthand pattern classes but preserves explicit ASCII and literal backslashes", (t) => {
  for (const pattern of [
    String.raw`/\s+/u`,
    String.raw`/\S/u`,
    String.raw`/\w/u`,
    String.raw`/\d/u`,
    String.raw`/\p{Letter}/u`,
    String.raw`new RegExp("\\s")`,
    String.raw`RegExp("\\w")`,
  ]) {
    const root = fixture(t);
    addSources(root);
    writeFileSync(
      join(root, "src/hooks/main.mts"),
      `export const pattern = ${pattern};\n`,
    );
    assert.throws(
      () => generateHookRuntime(root, "--write"),
      /explicit ASCII classes/u,
    );
    assert.equal(existsSync(join(root, "workflow/hooks/main.mjs")), false);
    assert.equal(existsSync(join(root, ".goat-flow/hooks/main.mjs")), false);
  }
  const computed = fixture(t);
  addSources(computed);
  writeFileSync(
    join(computed, "src/hooks/main.mts"),
    'const pattern = "x"; export const value = RegExp(pattern);\n',
  );
  assert.throws(
    () => generateHookRuntime(computed, "--write"),
    /literal pattern/u,
  );
  assert.equal(existsSync(join(computed, "workflow/hooks/main.mjs")), false);
  const root = fixture(t);
  addSources(root);
  writeFileSync(
    join(root, "src/hooks/main.mts"),
    String.raw`// Documentation may name \s without becoming a pattern.
export const ascii = /[ \t\n\v\f\r]+/u;
export const literal = /\\s/u;
export const text = "\\s";
`,
  );
  generateHookRuntime(root, "--write");
  generateHookRuntime(root, "--check");
});

test("generation preserves runnable nested modules, source comments, stamps and canonical mirrors", async (t) => {
  const root = fixture(t);
  addSources(root);
  generateHookRuntime(root, "--write");
  generateHookRuntime(root, "--check");
  for (const name of ["main.mjs", "nested/value.mjs", "shared.mjs"]) {
    const canonical = readFileSync(join(root, "workflow/hooks", name));
    assert.deepEqual(
      readFileSync(join(root, ".goat-flow/hooks", name)),
      canonical,
    );
  }
  const main = join(root, "workflow/hooks/main.mjs");
  const source = readFileSync(main, "utf8");
  assert(source.startsWith("#!/usr/bin/env node\n"));
  assert(source.includes("goat-flow-hook-version: 1.19.0"));
  assert(
    source.includes(
      "/** Retain this source-owned license/comment contract. */",
    ),
  );
  assert.equal((await import(pathToFileURL(main).href)).answer, 42);
  assert.equal(existsSync(join(root, "dist/hooks")), false);
});

test("check refuses byte drift, missing mirrors, version drift and orphan modules without writing", (t) => {
  const root = fixture(t);
  addSources(root);
  generateHookRuntime(root, "--write");
  const canonical = join(root, "workflow/hooks/nested/value.mjs");
  const mirror = join(root, ".goat-flow/hooks/nested/value.mjs");
  for (const path of [canonical, mirror]) {
    writeFileSync(path, "stale output\n");
    assert.throws(
      () => generateHookRuntime(root, "--check"),
      /Hook runtime is stale/u,
    );
    assert.equal(readFileSync(path, "utf8"), "stale output\n");
    generateHookRuntime(root, "--write");
  }
  unlinkSync(mirror);
  assert.throws(
    () => generateHookRuntime(root, "--check"),
    /Hook runtime is stale/u,
  );
  assert.equal(existsSync(mirror), false);
  generateHookRuntime(root, "--write");
  const previous = readFileSync(canonical);
  writeFileSync(
    join(root, "package.json"),
    JSON.stringify({ version: "1.19.1" }),
  );
  assert.throws(
    () => generateHookRuntime(root, "--check"),
    /Hook runtime is stale/u,
  );
  assert.deepEqual(readFileSync(canonical), previous);
  generateHookRuntime(root, "--write");
  const orphan = join(root, ".goat-flow/hooks/orphan.mjs");
  writeFileSync(orphan, "orphan runtime\n");
  for (const mode of ["--check", "--write"] as const) {
    assert.throws(
      () => generateHookRuntime(root, mode),
      /Orphan installed hook/u,
    );
    assert.equal(readFileSync(orphan, "utf8"), "orphan runtime\n");
  }
});

test("missing sources, compiler mismatch and malformed input refuse generation before output writes", (t) => {
  const root = fixture(t);
  assert.throws(
    () => generateHookRuntime(root, "--check"),
    /No hook runtime sources/u,
  );
  addSources(root);
  writeFileSync(
    join(root, "package-lock.json"),
    JSON.stringify({
      packages: { "node_modules/typescript": { version: "0.0.0" } },
    }),
  );
  assert.throws(
    () => generateHookRuntime(root, "--write"),
    /Resolved typescript differs/u,
  );
  assert.equal(existsSync(join(root, ".goat-flow/hooks")), false);
  writeFileSync(
    join(root, "package-lock.json"),
    JSON.stringify({
      packages: { "node_modules/typescript": { version: ts.version } },
    }),
  );
  writeFileSync(join(root, "src/hooks/main.mts"), "export const value: = ;\n");
  assert.throws(() => generateHookRuntime(root, "--write"));
  assert.equal(existsSync(join(root, ".goat-flow/hooks")), false);
});
