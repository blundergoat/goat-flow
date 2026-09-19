/**
 * Verify the saved policy choices used by hook launchers and upgrade reviews.
 *
 * Malformed or untrusted config must never become an off switch.
 * Mixed-choice upgrades require review when ownership changes, including pristine installed files.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  parsePolicyChoices,
  readPolicyChoices,
  policyUpgradeReview,
} from "../../workflow/hooks/hook-policy-state.cjs";

test("resolves full YAML syntax and distinguishes explicit choices from defaults", () => {
  // Empty or absent choices must retain enabled defaults instead of becoming an implicit off switch.
  for (const text of [
    "",
    "null",
    "# empty\n",
    "ui: {theme: dark}",
    "hooks: {}",
    "hooks: {deny-dangerous: {}}",
  ])
    assert.deepEqual(parsePolicyChoices(text), {}, text);
  // Accepted YAML spellings must resolve the user's explicit boolean false consistently.
  for (const text of [
    '"hooks": {"deny-dangerous": {enabled: false}}',
    "hooks:\n  deny-dangerous:\n    enabled: !!bool false\n",
    "choice: &off {enabled: false}\nhooks: {deny-dangerous: *off}",
    "choice: &on {enabled: true}\nhooks:\n  deny-dangerous: {<<: *on, enabled: false}",
    "hooks: {guard-destructive-shell: {enabled: false}, deny-dangerous: {enabled: false}}",
  ])
    assert.deepEqual(
      parsePolicyChoices(text),
      { "deny-dangerous": false },
      text,
    );
  assert.deepEqual(
    parsePolicyChoices("hooks: {deny-git-mutations: {enabled: true}}"),
    { "deny-git-mutations": true },
  );
});

test("requires review for either mixed choice pair only when installed ownership bytes change", () => {
  const choicePairs = [
    { "deny-dangerous": true, "deny-git-mutations": true },
    { "deny-dangerous": true, "deny-git-mutations": false },
    { "deny-dangerous": false, "deny-git-mutations": true },
    { "deny-dangerous": false, "deny-git-mutations": false },
  ];
  // Users can Sync unchanged choices or toggle into a different pair while installing the new ownership files.
  for (const original of choicePairs) {
    // Each requested switch pair is compared with the saved pair before deciding whether protection ownership needs review.
    for (const requested of choicePairs) {
      const needsReview =
        original["deny-dangerous"] !== original["deny-git-mutations"] ||
        requested["deny-dangerous"] !== requested["deny-git-mutations"];
      // Missing ownership evidence must require the same review as known old bytes; identical current files must not prompt repeatedly.
      for (const originalIdentity of [null, "old", "current"]) {
        const files = [
          {
            path: "deny-dangerous/guard-runtime.sh",
            originalIdentity,
            incomingIdentity: "current",
          },
        ];
        assert.deepEqual(
          policyUpgradeReview(original, requested, true, files),
          needsReview && originalIdentity !== "current"
            ? { original, requested, paths: [files[0].path] }
            : null,
        );
        assert.equal(
          policyUpgradeReview(original, requested, false, files),
          null,
        );
      }
    }
  }
  assert.equal(policyUpgradeReview({}, {}, true, []), null);
});

test("rejects malformed documents and invalid policy or sibling decisions", () => {
  // Malformed or ambiguous YAML must be rejected rather than interpreted as permission to skip protection.
  for (const text of [
    "[",
    "hooks: {}\nhooks: {}",
    "hooks: {}\n---\nhooks: {}",
    "[]",
    "false",
    "hooks: null",
    "hooks: []",
    "hooks: {deny-dangerous: null}",
    'hooks: {deny-dangerous: {enabled: "false"}}',
    "hooks: {deny-dangerous: {enabled: 0}}",
    "hooks: {deny-dangerous: {enabled: null}}",
    "hooks: {deny-dangerous: {enabled: false, enabled: false}}",
    "hooks: {deny-dangerous: {enabled: false}, deny-git-mutations: {enabled: nope}}",
    "hooks: {deny-dangerous: {enabled: false}, guard-secret-paths: {enabled: true}}",
    "hooks: {deny-dangerous: {enabled: false}, guard-repository-writes: []}",
  ])
    assert.throws(() => parsePolicyChoices(text), /Hook config/, text);
});

test("normalizes each legacy dangerous choice without changing the Git choice", () => {
  // Every retired guard spelling must retain the same conflict checks as the current switch.
  for (const alias of [
    "guard-destructive-shell",
    "guard-secret-paths",
    "guard-repository-writes",
  ]) {
    assert.deepEqual(
      parsePolicyChoices(
        `hooks: {${alias}: {enabled: false}, deny-git-mutations: {enabled: true}}`,
      ),
      {
        "deny-dangerous": false,
        "deny-git-mutations": true,
      },
    );
  }
});

test("defaults genuinely absent config on and reads through a physical root alias", (t) => {
  const root = fs.mkdtempSync(join(tmpdir(), "goat-policy-state-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  assert.deepEqual(readPolicyChoices(root), {});
  const project = join(root, "project");
  fs.mkdirSync(join(project, ".goat-flow"), { recursive: true });
  assert.deepEqual(readPolicyChoices(project), {});
  fs.writeFileSync(
    join(project, ".goat-flow/config.yaml"),
    "hooks: {deny-dangerous: {enabled: false}}",
  );
  fs.symlinkSync(project, join(root, "alias"), "dir");
  assert.deepEqual(readPolicyChoices(join(root, "alias")), {
    "deny-dangerous": false,
  });
});

test("rejects linked directories, linked config and nonregular config", (t) => {
  const root = fs.mkdtempSync(join(tmpdir(), "goat-policy-shapes-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const outside = join(root, "outside");
  fs.mkdirSync(outside);
  fs.writeFileSync(
    join(outside, "config.yaml"),
    "hooks: {deny-dangerous: {enabled: false}}",
  );
  // Linked or non-file config paths must fail trust checks before their saved choice can influence a launcher.
  for (const shape of [
    "directory-link",
    "file-link",
    "dangling-link",
    "hard-link",
    "directory-file",
  ]) {
    const project = join(root, shape),
      directory = join(project, ".goat-flow"),
      config = join(directory, "config.yaml");
    fs.mkdirSync(project);
    // A linked workflow directory reproduces config escaping the selected project's physical setup folder.
    if (shape === "directory-link") fs.symlinkSync(outside, directory, "dir");
    else {
      fs.mkdirSync(directory);
      // A hard-linked config reproduces a saved choice with another filesystem owner.
      if (shape === "hard-link")
        fs.linkSync(join(outside, "config.yaml"), config);
      // A directory at the config path cannot supply the user's YAML settings.
      else if (shape === "directory-file") fs.mkdirSync(config);
      else
        fs.symlinkSync(
          join(outside, shape === "dangling-link" ? "absent" : "config.yaml"),
          config,
        );
    }
    assert.throws(() => readPolicyChoices(project), /Hook config/, shape);
  }
});

test("rejects unreadable config instead of defaulting it on or off", (t) => {
  // Root bypasses this fixture's permission failure, so skip without claiming that unreadable-file behavior was tested.
  if (process.getuid?.() === 0) return t.skip("root bypasses file permissions");
  const root = fs.mkdtempSync(join(tmpdir(), "goat-policy-permissions-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(join(root, ".goat-flow"));
  const config = join(root, ".goat-flow/config.yaml");
  fs.writeFileSync(config, "hooks: {deny-dangerous: {enabled: false}}", {
    mode: 0,
  });
  assert.throws(() => readPolicyChoices(root), /EACCES/);
});

test("rejects replacement after the validated descriptor was read", (t) => {
  const root = fs.mkdtempSync(join(tmpdir(), "goat-policy-replace-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(join(root, ".goat-flow"));
  const config = join(root, ".goat-flow/config.yaml");
  fs.writeFileSync(config, "hooks: {deny-dangerous: {enabled: false}}");
  const read = fs.readFileSync;
  const mocked = t.mock.method(
    fs,
    "readFileSync",
    (...args: Parameters<typeof fs.readFileSync>) => {
      const content = read(...args);
      // Replacing the pathname while its descriptor is read reproduces a changed choice that must fail identity checks.
      if (typeof args[0] === "number") {
        fs.renameSync(config, config + ".old");
        fs.writeFileSync(config, "hooks: {deny-dangerous: {enabled: true}}");
      }
      return content;
    },
  );
  assert.throws(() => readPolicyChoices(root), /identity changed/);
  mocked.mock.restore();
});
