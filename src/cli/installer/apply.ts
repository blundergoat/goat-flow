/** Apply the admitted install decisions; the public caller owns claims and verified state. */
import {
  lstatSync,
  readFileSync,
  readdirSync,
  rmSync,
  unlinkSync,
} from "node:fs";
import { basename, extname, join, posix } from "node:path";
import { load } from "js-yaml";
import { inspectPolicyUpgrade } from "../../../workflow/hooks/hook-policy-state.cjs";
import { getAgentProfile, getAgentProfiles } from "../agents/registry.js";
import { loadConfig } from "../config/reader.js";
import { loadManifest, getSkillFiles } from "../manifest/manifest.js";
import { readManagedTargetEvidence } from "../managed-setup-write-set.js";
import { readManagedInstallStateFacade } from "../managed-setup-state.js";
import { getPackageVersion, getTemplatePath } from "../paths.js";
import { prepareAgentHookState } from "../server/agent-hook-writer.js";
import { entryReferencesSpec } from "../server/agent-hook-command.js";
import { readAllHookStates, type HookState } from "../server/hook-registrar.js";
import { listHookSpecs, type HookSpec } from "../server/hooks-registry.js";
import type { AgentId, AgentProfile } from "../types.js";
import { compareVersions, isReleaseVersion } from "../version-compare.js";
import {
  copyInstallerFile,
  installerDestination,
  installerDirectory,
  transformInstallerFile,
  writeInstallerFile,
} from "./atomic-files.js";
import { migrateClaudePermissions } from "./claude-permissions.js";
import { migrateCodexFeatures } from "./codex-features.js";
import {
  migrateCodexPermissions,
  validateCodexPermissions,
} from "./codex-permissions.js";
import {
  ensureConfigHooks,
  ensureIgnoreEntry,
  updateConfigVersion,
} from "./config.js";
import { migrateInstallerDirectories } from "./migrations.js";
import {
  inspectRuntimeRetirement,
  removeRetiredRuntimeFile,
  retiredRuntimeReferences,
} from "./retired-runtime.js";
import {
  findRetiredPathReferences,
  isUserOwnedPlaybook,
  keptRetiredFileAdvice,
  RENAMED_PLAYBOOKS,
  retiredPathCallerFiles,
} from "../retired-paths.js";
import { createFS } from "../facts/fs.js";
import { hashFile } from "../managed-setup-write-set.js";

/** Per-path decisions come from the public preview and are never widened here. */
export interface InstallerApplyOptions {
  projectPath: string;
  agent: AgentId;
  preservePaths?: readonly string[];
  replaceUserPaths?: readonly string[];
  updateConfigVersion?: boolean;
  cleanDeprecated?: boolean;
  /** The public caller sets this only after it owns and revalidates the complete claim batch. */
  hasManagedAdmission?: boolean;
  retirementPaths?: readonly string[];
  /** Edited retired files `--force-path` named, each with the bytes the preview showed; a later change keeps the file. */
  forcedRetirements?: readonly { path: string; sha256: string }[];
  reviewedRuntimePaths?: readonly string[];
  output?: (message: string) => void;
  diagnostic?: (message: string) => void;
}

/** A version refusal happens before directories, migrations or payloads can change. */
export function installerVersionBlocker(project: string): string | null {
  const config = installerDestination(project, ".goat-flow/config.yaml");
  if (!lstatSync(config, { throwIfNoEntry: false })) return null;
  const content = readFileSync(config, "utf8");
  const version = (load(content) as { version?: unknown } | null)?.version;
  if (
    typeof version !== "string" ||
    !isReleaseVersion(version) ||
    !version.split(".").every((part) => Number.isSafeInteger(Number(part)))
  ) {
    return "Config version cannot be safely compared. Review the saved version in .goat-flow/config.yaml; use a numeric X.Y.Z release before installing.";
  }
  if (compareVersions(version, getPackageVersion()) > 0) {
    return `Project version ${version} is newer than this CLI ${getPackageVersion()}. Upgrade the CLI before installing; the project's files must remain unchanged.`;
  }
  if (
    !/^(?:version|"version"|'version')[ \t]*:[ \t]*(?:&[^\s#]+[ \t]+)?(["']?)\d+\.\d+\.\d+\1[ \t]*(?:#[^\r\n]*)?\r?$/mu.test(
      content,
    )
  ) {
    return `Config version ${version} cannot be safely refreshed. Review the saved version in .goat-flow/config.yaml and put it on a single top-level line before installing.`;
  }
  if (compareVersions(version, "1.16.0") < 0) {
    return `Project version ${version} needs an intermediate upgrade. Install goat-flow 1.18.0 first, then retry this release; one-step upgrades start at 1.16.0.`;
  }
  return null;
}

/** Sibling settings enroll only through an actual managed command, including grouped rows. */
function containsManagedRegistration(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  if (listHookSpecs().some((spec) => entryReferencesSpec(value, spec)))
    return true;
  return Object.values(value).some(containsManagedRegistration);
}

/** Preserve unknown or malformed user JSON; public verification reports unusable registrations. */
function migrateRegistration(
  project: string,
  agent: AgentProfile,
  selectedHook: string | null,
  preserved: ReadonlySet<string>,
  diagnostic: (message: string) => void = console.error,
): boolean {
  const path = agent.hookConfigFile;
  if (!path || preserved.has(path)) return false;
  const destination = installerDestination(project, path);
  if (!lstatSync(destination, { throwIfNoEntry: false })) return false;
  const content = readFileSync(destination, "utf8");
  const parsed = readRegistrationObject(content, selectedHook);
  if (parsed === null) return false;
  if (selectedHook && !containsManagedRegistration(parsed)) return false;
  const next = updatedRegistration(
    project,
    agent,
    selectedHook,
    content,
    diagnostic,
  );
  if (next === content) return false;
  writeInstallerFile(project, path, next);
  return true;
}

/** Compute registrations from the registry while the file writer retains path admission. */
function updatedRegistration(
  project: string,
  agent: AgentProfile,
  selectedHook: string | null,
  content: string,
  diagnostic: (message: string) => void,
): string {
  let next = content;
  const config = loadConfig(project).config;
  const postTurn = readAllHookStates(project).find(
    (state) => state.id === "post-turn-safety",
  );
  const scanRoots = postTurn?.scanRoots;
  if (selectedHook === null) reportPostTurnSkip(postTurn, agent, diagnostic);
  for (const spec of listHookSpecs()) {
    if (selectedHook && spec.id !== selectedHook) continue;
    const isEnabled = registrationEnabled(spec, agent, config, scanRoots);
    next = prepareAgentHookState(next, agent, spec, isEnabled);
  }
  return next;
}

/** Report why an enabled, supported Stop hook cannot yet be registered. */
function reportPostTurnSkip(
  postTurn: HookState | undefined,
  agent: AgentProfile,
  diagnostic: (message: string) => void,
): void {
  if (
    !postTurn?.enabled ||
    !postTurn.scanRoots?.issue ||
    isUnsupportedHook(agent, "post-turn-safety")
  )
    return;
  diagnostic(`post-turn-safety not registered: ${postTurn.scanRoots.issue}`);
  diagnostic(
    "fix: Configure valid scan roots or disable this hook before registering it.",
  );
}

/** The registry owns provider support independently of project scan-root configuration. */
function isUnsupportedHook(agent: AgentProfile, hookId: string): boolean {
  return Boolean(
    listHookSpecs().find((spec) => spec.id === hookId)?.unsupportedAgents?.[
      agent.id
    ],
  );
}

/** Refresh an admitted project with native filesystem operations and narrow settings transforms. */
export function applyInstaller(options: InstallerApplyOptions): void {
  const project = options.projectPath;
  const output = options.output ?? console.log;
  const preserved = new Set(options.preservePaths);
  const replaceable = new Set(options.replaceUserPaths);
  const manifest = loadManifest();
  const profile = manifest.agents[options.agent];
  const agent = getAgentProfile(options.agent);
  if (!profile?.skills_dir)
    throw new Error(`manifest profile for '${options.agent}' is incomplete`);
  assertProjectAdmission(options, profile);
  const retirement = prepareRuntimeRetirement(options);

  let copied = 0;
  let skipped = 0;
  let removed = 0;
  // Copy one template, skipping preserved destinations and existing user-owned files; path admission throws on an unsafe destination.
  const copy = (
    source: string,
    destination: string,
    isUserOwned = false,
  ): void => {
    if (preserved.has(destination)) {
      skipped += 1;
      output(
        `  · ${destination} (preserved local content; this package does not change it)`,
      );
      return;
    }
    const target = installerDestination(project, destination);
    if (
      isUserOwned &&
      !replaceable.has(destination) &&
      lstatSync(target, { throwIfNoEntry: false })
    ) {
      skipped += 1;
      output(`  · ${destination} (exists, template not copied)`);
      return;
    }
    const sourcePath = getTemplatePath(source);
    if (!lstatSync(sourcePath, { throwIfNoEntry: false })?.isFile())
      throw new Error(
        `missing installer template: ${sourcePath}. Manifest/template drift detected.`,
      );
    const mode = templateMode(source, destination);
    copyInstallerFile(project, destination, sourcePath, {
      createOnly: isUserOwned && !replaceable.has(destination),
      mode,
    });
    copied += 1;
    output(`  ✓ ${destination}`);
  };

  output(`goat-flow install: ${basename(project)} (agent: ${options.agent})`);
  migrateInstallerDirectories(project, output);
  for (const directory of manifest.required_dirs)
    installerDirectory(project, directory.replace(/\/$/u, ""));

  // Copy shared docs before config and registrations; hook runtime bytes follow the policy split below.
  copyManifestTemplates(manifest, copy, false);
  prepareProjectAnchors(project, preserved);
  removed += installSkillFiles(options, manifest, profile.skills_dir, copy);
  configureProject(options, preserved);

  installHookFiles(options, profile, manifest, copy, preserved);

  installSettings(options, profile.settings, copy, preserved);

  // An existing hook config keeps its other content but can still have its registrations rewritten; say so after its "exists" line.
  if (
    profile.hooks_dir &&
    migrateRegistration(project, agent, null, preserved, options.diagnostic)
  )
    output(`  ✓ ${agent.hookConfigFile} (hook registrations updated in place)`);
  removed += finishRuntimeRetirement(options, retirement.files, output);
  writeInitialPlanMarker(project);
  removed += retireRenamedPlaybooks(options, retirement.expected, output);
  reportRetiredPathReferences(project, output);
  output(
    `HELPER DONE: ${copied} files copied, ${skipped} skipped, ${removed} stale removed`,
  );
}

/**
 * Reject unresolved customization before any runtime or registration can change.
 * Hashes from an older release's per-agent records count once they agree, because install converts them to shared state unchanged.
 *
 * @param options - admitted install options, including the runtime paths the user reviewed
 * @returns the retired runtime files with their status, and the recorded hashes later retirement checks compare against
 * @throws Error when a registered retired file has edited bytes the user has not reviewed
 */
function prepareRuntimeRetirement(options: InstallerApplyOptions): {
  files: ReturnType<typeof inspectRuntimeRetirement>;
  expected: ReadonlyMap<string, string>;
} {
  const project = options.projectPath;
  const manifest = loadManifest();
  const expected = assertManagedAdmission(options).expectedHashes;
  const retirement = inspectRuntimeRetirement(
    project,
    expected,
    new Set(Object.keys(manifest.file_ownership)),
  );
  const reviewed = new Set(options.reviewedRuntimePaths);
  if (
    retirement.some(
      (file) => file.needsMigrationReview && !reviewed.has(file.path),
    )
  ) {
    throw new Error(
      "Runtime migration is incomplete: review registered local runtime changes before switching registrations or retiring dependencies.",
    );
  }

  return { files: retirement, expected };
}

/** Hook entrypoints retain executable mode; ordinary templates remain data files. */
function templateMode(source: string, destination: string): number {
  return destination.startsWith(".goat-flow/hooks/") &&
    [".sh", ".mjs"].includes(extname(source))
    ? 0o755
    : 0o644;
}

/** Install runtime files after protecting existing providers and before registering the selected agent. */
function installHookFiles(
  options: InstallerApplyOptions,
  profile: InstallManifest["agents"][AgentId],
  manifest: InstallManifest,
  copy: CopyTemplate,
  preserved: ReadonlySet<string>,
): void {
  const project = options.projectPath;
  if (profile.hooks_dir) {
    // Protect Git mutations for enrolled providers before replacing shared policy files.
    protectEnrolledPolicies(project, preserved);
    copyManifestTemplates(manifest, copy, true);
    const hookConfig = profile.hook_config_file;
    if (hookConfig && hookConfig !== profile.settings)
      copy(
        `workflow/hooks/agent-config/${options.agent}-hooks.json`,
        hookConfig,
        true,
      );
  }
}

/**
 * Remove only preview-admitted retired files whose bytes still match what the preview proved, and return their actual count.
 * An unedited file matches its install record; an edited file matches the bytes shown when `--force-path` named it. Any other file stays,
 * with one line saying it no longer runs. While another provider still runs the retired runtime, every file stays and the closing summary
 * reports the cleanup as pending.
 *
 * @param options - admitted install options carrying the preview's removal paths and forced deletions
 * @param retirement - retired runtime files inspected before registrations changed
 * @param output - install log writer
 * @returns how many files were deleted
 * @throws Error when a file is due for deletion but the selected provider's own config still runs the retired runtime, because
 *   re-running this install cannot fix that
 */
function finishRuntimeRetirement(
  options: InstallerApplyOptions,
  retirement: ReturnType<typeof inspectRuntimeRetirement>,
  output: (message: string) => void,
): number {
  const project = options.projectPath;
  const forced = new Map(
    (options.forcedRetirements ?? []).map((file) => [file.path, file.sha256]),
  );
  const removable = retirement.flatMap((file) => {
    // Only rows the preview showed as removals are deleted here.
    if (!options.retirementPaths?.includes(file.path)) return [];
    // Unedited bytes are already proven by the install record.
    if (file.canRemove) return [file];
    const sha256 = forced.get(file.path);
    // An edited file is deleted only at the exact bytes the preview showed when --force-path named it.
    return sha256 === undefined
      ? []
      : [{ ...file, expectedSha256: sha256, canRemove: true }];
  });
  const kept = retirement.filter(
    (file) =>
      !removable.some((removal) => removal.path === file.path) &&
      readManagedTargetEvidence(project, file.path).status !== "missing",
  );
  // Nothing retired is left on disk, so no provider dependency needs checking.
  if (removable.length === 0 && kept.length === 0) return 0;
  const references = retiredRuntimeReferences(project);
  const ownReference = references.find(
    (reference) => reference.agent === options.agent,
  );
  // A dependency left in the selected provider's own config is one that re-running this install cannot clear, so a planned deletion
  // fails. With nothing due for deletion the files are simply reported as still in use below.
  if (ownReference && removable.length > 0) {
    throw new Error(
      `Runtime migration is incomplete: ${ownReference.path} still references the retired runtime after this install. Its dependencies were preserved.`,
    );
  }
  // Other providers still run these files; the install of the last of them removes them.
  if (references.length > 0) {
    output(
      `  · ${removable.length + kept.length} retired runtime file(s) kept: still used by ${references.map((reference) => reference.path).join(", ")}`,
    );
    return 0;
  }
  // No provider depends on the retired runtime any more, so each admitted file is rechecked and removed.
  for (const file of removable) {
    removeRetiredRuntimeFile(project, file);
    // A forced removal is a new row built from the preview's bytes; an unedited one is the inspected row itself.
    output(
      !retirement.includes(file)
        ? `  ✗ ${file.path} (removed: named by --force-path; restore it from Git history if needed)`
        : `  ✗ ${file.path} (removed verified retired runtime)`,
    );
  }
  // Edited or unrecorded files stay; each line says what that means and how to finish.
  for (const file of kept)
    output(
      `  · ${file.path} (kept: edited or unrecorded retired hook file; ${keptRetiredFileAdvice(file.path, readManagedTargetEvidence(project, file.path).status === "regular")})`,
    );
  return removable.length;
}

/** Only undeclared Markdown references belong to skill cleanup; preserve other user files. */
function pruneSkillReferences(
  project: string,
  skill: string,
  expected: ReadonlySet<string>,
  output: (message: string) => void,
): number {
  let removed = 0;
  const walk = (directory: string): void => {
    const absolute = join(project, directory);
    const stat = lstatSync(absolute, { throwIfNoEntry: false });
    if (!stat) return;
    installerDestination(project, `${directory}/.goat-flow-directory-check`);
    for (const entry of readdirSync(absolute, { withFileTypes: true })) {
      const path = `${directory}/${entry.name}`;
      if (entry.isDirectory()) walk(path);
      else if (
        entry.isFile() &&
        entry.name.endsWith(".md") &&
        !expected.has(posix.relative(skill, path))
      ) {
        unlinkSync(installerDestination(project, path));
        removed += 1;
        output(`  ✗ ${path} (removed stale reference)`);
      }
    }
  };
  walk(`${skill}/references`);
  return removed;
}

/** An existing marker or ambiguous directory list always preserves the user's choice. */
function writeInitialPlanMarker(project: string): void {
  const marker = ".goat-flow/plans/.active";
  if (
    lstatSync(installerDestination(project, marker), { throwIfNoEntry: false })
  )
    return;
  const versions = readdirSync(join(project, ".goat-flow/plans"), {
    withFileTypes: true,
  }).filter(
    (entry) => entry.isDirectory() && /^\d+\.\d+\.\d+/u.test(entry.name),
  );
  if (versions.length === 1 && versions[0])
    writeInstallerFile(project, marker, `${versions[0].name}\n`, {
      createOnly: true,
    });
}

/**
 * Delete an old playbook only when the preview admitted it and its bytes still match what the preview proved: the install record
 * for an unedited copy, or the bytes shown when `--force-path` named an edited one. A symlink, a playbook marked user-owned, or any
 * other copy stays, with one line naming its replacement.
 *
 * @param options - admitted install options carrying the preview's removal paths and forced deletions
 * @param expected - recorded hashes from shared or older per-agent install state
 * @param output - install log writer
 * @returns how many old playbooks were deleted
 */
function retireRenamedPlaybooks(
  options: InstallerApplyOptions,
  expected: ReadonlyMap<string, string>,
  output: (message: string) => void,
): number {
  const forced = new Map(
    (options.forcedRetirements ?? []).map((file) => [file.path, file.sha256]),
  );
  let removed = 0;
  for (const [relative, replacement] of RENAMED_PLAYBOOKS)
    removed += retireOldPlaybook(
      options,
      { relative, replacement, isForced: forced.has(relative) },
      forced.get(relative) ?? expected.get(relative),
      output,
    );
  return removed;
}

/**
 * Report whether the preview admitted deleting this retired path and its bytes still match the hash that admission rested on.
 *
 * @param options - admitted install options carrying the preview's removal paths
 * @param relative - project-relative retired path
 * @param proven - the forced preview bytes or the install record hash; undefined proves nothing
 * @returns true only when deletion is admitted and the current file hash equals `proven`
 */
function isProvenRemoval(
  options: InstallerApplyOptions,
  relative: string,
  proven: string | undefined,
): boolean {
  return (
    options.retirementPaths?.includes(relative) === true &&
    proven !== undefined &&
    hashFile(join(options.projectPath, relative)) === proven
  );
}

/**
 * Delete or keep one old playbook and write its outcome line.
 *
 * @param options - admitted install options carrying the preview's removal paths
 * @param playbook - old path, its replacement, and whether `--force-path` named it
 * @param proven - hash the bytes must still match: the forced preview bytes or the install record; undefined proves nothing
 * @param output - install log writer
 * @returns 1 when the file was deleted, otherwise 0
 */
function retireOldPlaybook(
  options: InstallerApplyOptions,
  playbook: { relative: string; replacement: string; isForced: boolean },
  proven: string | undefined,
  output: (message: string) => void,
): number {
  const { relative, replacement } = playbook;
  const path = join(options.projectPath, relative);
  const stat = lstatSync(path, { throwIfNoEntry: false });
  // A linked copy belongs to whatever it points at, so it is never deleted.
  if (stat?.isSymbolicLink()) {
    output(`  · ${relative} (kept symlink; use ${replacement})`);
    return 0;
  }
  // Nothing is installed at the old path.
  if (!stat?.isFile()) return 0;
  installerDestination(options.projectPath, relative);
  // Explicit user-owned frontmatter opts the copy out of cleanup.
  if (isUserOwnedPlaybook(readFileSync(path, "utf8"))) {
    output(`  · ${relative} (kept user-owned playbook; use ${replacement})`);
    return 0;
  }
  // The preview admitted this removal and the bytes still match what it proved.
  if (isProvenRemoval(options, relative, proven)) {
    unlinkSync(path);
    output(
      playbook.isForced
        ? `  ✗ ${relative} (removed: named by --force-path; restore it from Git history if needed)`
        : `  ✗ ${relative} (removed renamed playbook; use ${replacement})`,
    );
    return 1;
  }
  output(
    `  · ${relative} (kept: edited or unrecorded old playbook; ${keptRetiredFileAdvice(relative, true)})`,
  );
  return 0;
}

/**
 * Report each line in the project's instruction files, scripts, CI workflows and `package.json` that calls a retired path, with what
 * to use instead. Those files are only read for this report; install never changes them.
 *
 * @param project - installed project root
 * @param output - install log writer
 */
function reportRetiredPathReferences(
  project: string,
  output: (message: string) => void,
): void {
  const instructions = [
    ...new Set(getAgentProfiles().map((agent) => agent.instructionFile)),
  ];
  const lines: string[] = [];
  for (const path of [
    ...instructions,
    ...retiredPathCallerFiles(createFS(project)),
  ]) {
    // Only a safe regular file is read; a link or unreadable path is skipped.
    if (readManagedTargetEvidence(project, path).status !== "regular") continue;
    const text = readFileSync(join(project, path), "utf8");
    let shownLine = 0;
    // Each calling line is shown once, followed by the replacement for each retired path on it.
    for (const reference of findRetiredPathReferences(
      text,
      instructions.includes(path),
    )) {
      // References arrive in line order, so a repeated line number means another path on the line already shown.
      if (reference.line !== shownLine)
        lines.push(`  ${path}:${reference.line}: ${reference.text}`);
      shownLine = reference.line;
      lines.push(
        `    ${reference.token} → ${reference.replacement ?? reference.note}`,
      );
    }
  }
  // A project that calls no retired path gets no heading.
  if (lines.length === 0) return;
  output(
    "Project files that still call removed goat-flow paths (reported only; nothing was changed):",
  );
  for (const line of lines) output(line);
}

/** Seed missing config or apply only current-version and hook-toggle convergence. */
function configureProject(
  options: InstallerApplyOptions,
  preserved: ReadonlySet<string>,
): void {
  const project = options.projectPath;
  const configPath = ".goat-flow/config.yaml";
  const configFile = installerDestination(project, configPath);
  if (!lstatSync(configFile, { throwIfNoEntry: false })) {
    writeInstallerFile(
      project,
      configPath,
      `version: "${getPackageVersion()}"\n\nskills:\n  install: all\n${ensureConfigHooks("")}`,
      { createOnly: true },
    );
  } else if (!preserved.has(configPath)) {
    transformInstallerFile(project, configPath, (content) =>
      ensureConfigHooks(
        options.updateConfigVersion ||
          (load(content) as { version?: string }).version !==
            getPackageVersion()
          ? updateConfigVersion(content, getPackageVersion())
          : content,
      ),
    );
  }
}

/** Preserve provider settings while applying the installer's narrowly scoped migrations. */
function installSettings(
  options: InstallerApplyOptions,
  settingsPath: string | undefined,
  copy: (source: string, destination: string, isUserOwned?: boolean) => void,
  preserved: ReadonlySet<string>,
): void {
  const project = options.projectPath;
  if (settingsPath) {
    const extension = extname(settingsPath);
    copy(
      `workflow/hooks/agent-config/${options.agent}${extension}`,
      settingsPath,
      true,
    );
    if (!preserved.has(settingsPath))
      migrateProviderSettings(options, settingsPath);
    if (options.agent === "codex") {
      const problem = validateCodexPermissions(
        readFileSync(join(project, settingsPath), "utf8"),
      );
      if (problem)
        throw new Error(
          `${settingsPath} still has invalid Codex permission entries: ${problem}. Repair the active permission profile before retrying.`,
        );
    }
    if (options.agent === "claude") repairLocalSettings(options, preserved);
  }
}

/** Repair one provider's saved permissions without changing unrelated settings. */
function migrateProviderSettings(
  options: InstallerApplyOptions,
  settingsPath: string,
): void {
  const project = options.projectPath;
  const output = options.output ?? console.log;
  const diagnostic = options.diagnostic ?? console.error;
  if (options.agent === "codex") {
    if (transformInstallerFile(project, settingsPath, migrateCodexFeatures))
      output(`  ✓ ${settingsPath} (migrated: deprecated hooks flag)`);
    if (
      transformInstallerFile(project, settingsPath, (content) =>
        migrateCodexPermissions(content, diagnostic),
      )
    )
      output(`  ✓ ${settingsPath} (migrated: Codex permission profile)`);
  }
  if (
    options.agent === "claude" &&
    transformInstallerFile(project, settingsPath, (content) =>
      migrateClaudePermissions(content, diagnostic),
    )
  )
    output(
      `  ✓ ${settingsPath} (migrated: stale or superseded permission rules)`,
    );
}

/** Apply provider support, saved choices and scan-root admission to one registration. */
function registrationEnabled(
  spec: HookSpec,
  agent: AgentProfile,
  config: ReturnType<typeof loadConfig>["config"],
  scanRoots: HookState["scanRoots"] | undefined,
): boolean {
  const configured =
    config.hooks[spec.id] ??
    (spec.id === "gruff-code-quality"
      ? config.hooks["gruff-on-change"]
      : undefined);
  return (
    !isUnsupportedHook(agent, spec.id) &&
    (configured?.enabled ?? spec.defaultEnabled) &&
    (spec.id !== "post-turn-safety" ||
      ["implicit", "configured"].includes(scanRoots?.status ?? ""))
  );
}

type InstallManifest = ReturnType<typeof loadManifest>;
type CopyTemplate = (
  source: string,
  destination: string,
  isUserOwned?: boolean,
) => void;

/** Refuse unsafe projects, incomplete profiles and unresolved version or policy decisions before writes. */
function assertProjectAdmission(
  options: InstallerApplyOptions,
  profile: InstallManifest["agents"][AgentId],
): void {
  const project = options.projectPath;
  if (!lstatSync(project, { throwIfNoEntry: false })?.isDirectory())
    throw new Error(`${project} is not a directory`);
  if (
    (profile.hooks_dir || profile.deny_hook || profile.hook_config_file) &&
    (!profile.hooks_dir || !profile.deny_hook)
  ) {
    throw new Error(
      `manifest hook profile for '${options.agent}' is incomplete`,
    );
  }
  const blocker = installerVersionBlocker(project);
  if (blocker) throw new Error(blocker);
  if (inspectPolicyUpgrade(project, getTemplatePath("workflow/hooks"))) {
    throw new Error(
      "GitHub policy review is required before installation. Review the choices and affected files on the newer dashboard Hooks page, then retry. Force cannot approve this change.",
    );
  }
}

/** Keep direct writer calls out of managed or legacy local state; the public caller owns migration and claims. */
function assertManagedAdmission(
  options: InstallerApplyOptions,
): ReturnType<typeof readManagedInstallStateFacade> {
  const project = options.projectPath;
  if (
    !options.hasManagedAdmission &&
    [".goat-flow/install-state", ".goat-flow/write-claims"].some((path) =>
      lstatSync(join(project, path), { throwIfNoEntry: false }),
    )
  ) {
    throw new Error(
      `legacy local state requires migration. Run: goat-flow install ${JSON.stringify(project)} --agent ${JSON.stringify(options.agent)}`,
    );
  }
  if (
    !options.hasManagedAdmission &&
    lstatSync(join(project, ".goat-flow/state/install/managed.json"), {
      throwIfNoEntry: false,
    })
  ) {
    throw new Error(
      `managed install state requires the public CLI. Run: goat-flow install ${JSON.stringify(project)} --agent ${JSON.stringify(options.agent)}`,
    );
  }
  if (
    !options.hasManagedAdmission &&
    [
      ".goat-flow/learning-loop/decisions/README.md",
      ".goat-flow/decisions/README.md",
    ].some((path) => lstatSync(join(project, path), { throwIfNoEntry: false }))
  ) {
    throw new Error(
      `decisions guide ownership requires the public CLI. Run: goat-flow install ${JSON.stringify(project)} --agent ${JSON.stringify(options.agent)}`,
    );
  }
  const baseline = readManagedInstallStateFacade(project);
  if (baseline.status === "malformed-blocking")
    throw new Error(
      baseline.error ??
        "Managed install state requires repair through the public CLI.",
    );
  return baseline;
}

/** Copy only the selected manifest group; hooks remain after registration admission. */
function copyManifestTemplates(
  manifest: InstallManifest,
  copy: CopyTemplate,
  isHookGroup: boolean,
): void {
  for (const [destination, ownership] of Object.entries(
    manifest.file_ownership,
  )) {
    if (
      destination.startsWith(".goat-flow/hooks/") !== isHookGroup ||
      !ownership.source
    )
      continue;
    if (
      ownership.ownership === "system-owned" ||
      (!isHookGroup && ownership.ownership === "user-owned")
    )
      copy(ownership.source, destination, ownership.ownership === "user-owned");
  }
}

/** Refresh manifest skills, then honor explicit deprecated-skill cleanup. */
function installSkillFiles(
  options: InstallerApplyOptions,
  manifest: InstallManifest,
  skillsDirectory: string,
  copy: CopyTemplate,
): number {
  const project = options.projectPath;
  const output = options.output ?? console.log;
  let removed = 0;
  for (const skill of manifest.skills.canonical) {
    const files = getSkillFiles(skill);
    for (const file of files)
      copy(
        `workflow/skills/${skill}/${file}`,
        posix.join(skillsDirectory, skill, file),
      );
    removed += pruneSkillReferences(
      project,
      posix.join(skillsDirectory, skill),
      new Set(files),
      output,
    );
  }
  if (options.cleanDeprecated) {
    for (const skill of manifest.skills.stale_names) {
      const path = posix.join(skillsDirectory, skill);
      if (!lstatSync(join(project, path), { throwIfNoEntry: false })) continue;
      installerDestination(project, `${path}/.goat-flow-directory-check`);
      rmSync(join(project, path), { recursive: true });
      removed += 1;
      output(`  ✗ ${path} (removed)`);
    }
  }

  return removed;
}

/** Repair an existing Claude override without creating one or widening its authority. */
function repairLocalSettings(
  options: InstallerApplyOptions,
  preserved: ReadonlySet<string>,
): void {
  const project = options.projectPath;
  const output = options.output ?? console.log;
  const diagnostic = options.diagnostic ?? console.error;
  const localSettings = ".claude/settings.local.json";
  if (
    !preserved.has(localSettings) &&
    lstatSync(installerDestination(project, localSettings), {
      throwIfNoEntry: false,
    })
  ) {
    if (
      transformInstallerFile(project, localSettings, (content) =>
        migrateClaudePermissions(content, diagnostic),
      )
    )
      output(
        `  ✓ ${localSettings} (migrated: stale or superseded permission rules)`,
      );
  }
}

/** Invalid enrolled provider JSON refuses migration; unrelated malformed settings stay untouched. */
function readRegistrationObject(
  content: string,
  selectedHook: string | null,
): object | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    if (
      selectedHook &&
      /(?:deny-dangerous|deny-git-mutations|post-turn-safety|gruff-code-quality)\.(?:sh|mjs)/u.test(
        content,
      )
    ) {
      throw new Error(
        "Cannot establish Git protection in invalid provider JSON; existing runtime preserved",
      );
    }
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    return null;
  return parsed;
}

/** Seed the folder anchor and append only the missing dependency ignore rule. */
function prepareProjectAnchors(
  project: string,
  preserved: ReadonlySet<string>,
): void {
  const anchor = ".goat-flow/logs/sessions/.gitkeep";
  if (
    !lstatSync(installerDestination(project, anchor), { throwIfNoEntry: false })
  )
    writeInstallerFile(project, anchor, "", { createOnly: true });

  const ignore = ".gitignore";
  if (!preserved.has(ignore)) {
    const path = installerDestination(project, ignore);
    const before = lstatSync(path, { throwIfNoEntry: false })
      ? readFileSync(path, "utf8")
      : "";
    const next = ensureIgnoreEntry(before, "node_modules/");
    if (next !== before) writeInstallerFile(project, ignore, next);
  }
}

/** Existing providers receive Git protection before shared policy bytes change. */
function protectEnrolledPolicies(
  project: string,
  preserved: ReadonlySet<string>,
): void {
  for (const installedAgent of getAgentProfiles()) {
    if (installedAgent.hookConfigFile)
      migrateRegistration(
        project,
        installedAgent,
        "deny-git-mutations",
        preserved,
      );
  }
}
