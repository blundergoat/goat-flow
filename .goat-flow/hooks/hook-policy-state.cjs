/**
 * Resolve the selected project's hook choices for launchers and installers without CLI dependencies.
 *
 * Invalid or untrusted config stops the caller; only an explicit boolean false permits a launcher to skip enforcement.
 * Installers also check whether moving GitHub protection changes what the user's saved switches control.
 */
const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");
const yaml = require("./vendor/js-yaml.cjs");

const POLICY_ALIASES = {
  "deny-dangerous": [
    "deny-dangerous",
    "guard-destructive-shell",
    "guard-secret-paths",
    "guard-repository-writes",
  ],
  "deny-git-mutations": ["deny-git-mutations"],
};

// Recognize the policy switches whose saved choices determine whether launchers enforce protection.
function isPolicyHook(hookId) {
  return Object.hasOwn(POLICY_ALIASES, hookId);
}

// Recognize plain YAML mappings; nulls and lists cannot hold the user's named policy choices.
function isMapping(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype ||
      Object.getPrototypeOf(value) === null)
  );
}

/** Validate an alias before conflict resolution; invalid shape or a nonboolean choice throws. */
function readEntryChoice(entry, alias) {
  // A malformed saved hook row cannot authorize disabling its protection.
  if (!isMapping(entry))
    throw new Error(`Hook config ${alias} must be a mapping`);
  // A row without enabled records no explicit choice, so the launcher's enabled default remains applicable.
  if (!Object.hasOwn(entry, "enabled")) return undefined;
  // Only a boolean can establish the user's explicit policy choice; string-like false must not disable protection.
  if (typeof entry.enabled !== "boolean")
    throw new Error(`Hook config ${alias}.enabled must be boolean`);
  return entry.enabled;
}

/** Read explicit saved policy choices; throws on malformed YAML or conflicting aliases so ambiguous config cannot authorize an off switch. */
function parsePolicyChoices(text) {
  let config;
  try {
    config = yaml.load(text, { json: false });
  } catch {
    // A hand-edited syntax error, such as an unfinished YAML list, cannot become an off switch; require config repair.
    throw new Error(
      "Hook config must contain one valid YAML document: .goat-flow/config.yaml",
    );
  }
  // An empty YAML document contains no explicit choices and leaves protection enabled by default.
  if (config === null || config === undefined) return {};
  // A non-mapping document cannot establish named policy choices and is rejected.
  if (!isMapping(config))
    throw new Error(
      "Hook config must contain a YAML mapping: .goat-flow/config.yaml",
    );
  // Without a hooks key, the user has saved no policy override.
  if (!Object.hasOwn(config, "hooks")) return {};
  // A malformed hooks container cannot authorize a disabled launcher.
  if (!isMapping(config.hooks))
    throw new Error(
      "Hook config hooks must be a mapping: .goat-flow/config.yaml",
    );
  return normalizePolicyChoices(config.hooks);
}

/** Resolve current and retired policy spellings; throws on conflicting choices so iteration order cannot disable the user's protection. */
function normalizePolicyChoices(hooks) {
  const choices = {};
  // Resolve both policy switches before deciding whether the user's launcher must enforce protection.
  for (const [canonical, aliases] of Object.entries(POLICY_ALIASES)) {
    // Check every current and retired spelling so an earlier saved choice cannot bypass conflict detection.
    for (const alias of aliases) {
      // An absent spelling supplies no saved override for this switch.
      if (!Object.hasOwn(hooks, alias)) continue;
      const enabled = readEntryChoice(hooks[alias], alias);
      // A row without an enabled choice leaves this spelling out of the explicit policy result.
      if (enabled === undefined) continue;
      // Conflicting spellings stop the caller instead of letting iteration order disable protection.
      if (Object.hasOwn(choices, canonical) && choices[canonical] !== enabled) {
        throw new Error(`Hook config has conflicting choices for ${canonical}`);
      }
      choices[canonical] = enabled;
    }
  }
  return choices;
}

/** Missing paths alone default on; throws on other read failures. A dangling link remains present for validation. */
function statIfPresent(file) {
  try {
    return fs.lstatSync(file);
  } catch (error) {
    // An absent config path returns null; other filesystem failures remain errors for the caller to handle.
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

// Compare file identity and timestamps so a replaced config cannot change protection during one read.
function sameIdentity(before, after) {
  return (
    before.dev === after.dev &&
    before.ino === after.ino &&
    before.mode === after.mode &&
    before.nlink === after.nlink &&
    before.size === after.size &&
    before.mtimeMs === after.mtimeMs &&
    before.ctimeMs === after.ctimeMs
  );
}

/** Require the captured config identity; throws if it changed so the launcher cannot skip protection using a replaced file. */
function requireIdentity(before, after) {
  // A changed or missing file invalidates the policy choice instead of granting permission to skip enforcement.
  if (!after || !sameIdentity(before, after))
    throw new Error("Hook config identity changed during read");
}

/**
 * Read one validated descriptor under the physical selected root. This detects
 *
 * unsafe file shapes and observed replacements, not a hostile checkout attacker.
 * @throws {Error} When config cannot be parsed or its path/descriptor fails trust checks.
 */
function readPolicyChoices(projectRoot) {
  const root = fs.realpathSync(projectRoot);
  const rootBefore = fs.statSync(root);
  // A non-directory project root cannot provide a trusted policy-config location.
  if (!rootBefore.isDirectory())
    throw new Error("Hook project root must be a directory");
  const directory = path.join(root, ".goat-flow");
  const dirBefore = statIfPresent(directory);
  // An absent workflow directory supplies no saved choices, after confirming the project root stayed unchanged.
  if (!dirBefore) {
    requireIdentity(rootBefore, fs.statSync(root));
    return {};
  }
  // A linked or non-directory workflow path cannot supply a trusted policy config.
  if (dirBefore.isSymbolicLink() || !dirBefore.isDirectory())
    throw new Error("Hook config directory must be a physical directory");
  const file = path.join(directory, "config.yaml");
  const before = statIfPresent(file);
  // Recheck the captured project and workflow directories before accepting a saved policy choice.
  const verifyParents = () => {
    requireIdentity(rootBefore, fs.statSync(root));
    requireIdentity(dirBefore, fs.lstatSync(directory));
  };
  // An absent config keeps policy defaults after confirming its parent directories are unchanged.
  if (!before) {
    verifyParents();
    return {};
  }
  // A linked, multiply linked or non-file config cannot authorize an off switch.
  if (before.isSymbolicLink() || !before.isFile() || before.nlink !== 1) {
    throw new Error("Hook config must be a regular file with one link");
  }
  const descriptor = fs.openSync(
    file,
    fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0),
  );
  try {
    requireIdentity(before, fs.fstatSync(descriptor));
    const text = fs.readFileSync(descriptor, "utf8");
    const choices = parsePolicyChoices(text);
    requireIdentity(before, fs.fstatSync(descriptor));
    requireIdentity(before, fs.lstatSync(file));
    verifyParents();
    return choices;
  } finally {
    fs.closeSync(descriptor);
  }
}

const POLICY_OWNERSHIP_FILES = [
  "deny-dangerous/guard-runtime.sh",
  "deny-dangerous/patterns-writes.sh",
];
const POLICY_INSTALL_DIRECTORIES = [
  ".goat-flow/hooks", ".claude/hooks", ".codex/hooks", ".agents/hooks", ".github/hooks",
];

/**
 * Resolve both switches as launchers enforce them before the user reviews an upgrade.
 *
 * @param {object} choices Saved or prepared choices; missing entries keep their protection enabled.
 * @returns {object} Explicit choices for both switches, including defaults for an empty config.
 */
function effectivePolicyChoices(choices) {
  return {
    "deny-dangerous": choices["deny-dangerous"] ?? true,
    "deny-git-mutations": choices["deny-git-mutations"] ?? true,
  };
}

/**
 * Decide whether moving GitHub protection needs a separate review before Sync or installation can proceed.
 *
 * @param {object} originalChoices Saved switches; missing entries mean protection was enabled.
 * @param {object} requestedChoices Prepared switches; missing entries retain the enabled defaults.
 *
 * @param {boolean} hasPolicyInstallation False means a fresh install has no earlier policy ownership to migrate.
 * @param {Array} files Ownership evidence; an empty list means no ownership files need review.
 *
 * @returns {object|null} Before/after choices and affected paths, or null when no policy decision is pending.
 */
function policyUpgradeReview(originalChoices, requestedChoices, hasPolicyInstallation, files) {
  const original = effectivePolicyChoices(originalChoices);
  const requested = effectivePolicyChoices(requestedChoices);
  // GitHub protection can change during migration only when the two switches disagree.
  const hasMixedPolicyChoices = (choices) => choices["deny-dangerous"] !== choices["deny-git-mutations"];
  // Missing or different ownership bytes cannot establish that the user already has the incoming GitHub policy.
  const paths = files
    .filter((file) => file.originalIdentity === null || file.originalIdentity !== file.incomingIdentity)
    .map((file) => file.path);
  // Fresh installs, matching switch pairs and unchanged ownership do not change the user's GitHub protection through migration.
  if (!hasPolicyInstallation || (!hasMixedPolicyChoices(original) && !hasMixedPolicyChoices(requested)) || paths.length === 0) return null;
  return { original, requested, paths };
}

/**
 * Fingerprint one ownership file so installers can compare the user's installed policy with the bundled policy.
 *
 * @returns {string|null} Exact byte hash, or null when the file is absent and prior ownership cannot be established.
 * @throws {Error} When the file is linked, unreadable or observed to change during inspection; installation must stop.
 */
function policyFileIdentity(file) {
  const before = statIfPresent(file);
  // A missing ownership file leaves the prior GitHub policy unknown and may require review.
  if (!before) return null;
  // A linked or non-file destination cannot establish which protection the selected project currently uses.
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1) throw new Error("Policy ownership file is unsafe");
  const bytes = fs.readFileSync(file);
  requireIdentity(before, fs.lstatSync(file));
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * Inspect current and legacy hook locations before a public installer makes its first change.
 *
 * @param {string} projectRoot Selected project whose existing hook choices must survive the upgrade.
 * @param {string} bundledHooksRoot Incoming package hooks used to compare ownership bytes.
 *
 * @returns {object|null} Required policy review, or null when installation needs no migration consent.
 * @throws {Error} When config or ownership files cannot be inspected safely; the installer must report a refusal.
 */
function inspectPolicyUpgrade(projectRoot, bundledHooksRoot) {
  const root = fs.realpathSync(projectRoot);
  const original = readPolicyChoices(root);
  // An older config may omit the Git switch; installation carries forward the general safeguard's saved choice.
  const requested = { ...original, "deny-git-mutations": original["deny-git-mutations"] ?? original["deny-dangerous"] ?? true };
  const files = [];
  let hasPolicyInstallation = false;
  // Existing users may still have provider-specific hooks, so each supported location participates in the review.
  for (const directory of POLICY_INSTALL_DIRECTORIES) {
    const installed = ["deny-dangerous.sh", "deny-git-mutations.sh", "guard-repository-writes.sh"].some((name) => statIfPresent(path.join(root, directory, name)) !== null);
    // An unused hook location has no installed policy for the user to migrate.
    if (!installed) continue;
    hasPolicyInstallation = true;
    // Capture both ownership files even when one switch is disabled; enabling it later must not bypass migration review.
    for (const name of POLICY_OWNERSHIP_FILES) {
      files.push({ path: `${directory}/${name}`, originalIdentity: policyFileIdentity(path.join(root, directory, name)), incomingIdentity: policyFileIdentity(path.join(bundledHooksRoot, name)) });
    }
  }
  return policyUpgradeReview(original, requested, hasPolicyInstallation, files);
}

module.exports = { isPolicyHook, parsePolicyChoices, readPolicyChoices, effectivePolicyChoices, policyUpgradeReview, inspectPolicyUpgrade, POLICY_OWNERSHIP_FILES };
