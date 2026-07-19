/**
 * Read-only diagnostics for goat-flow skill discovery and installed mirrors.
 * Use `skill doctor` when users need paths, invocation text, static blockers,
 * and existing repair commands without asking an AI runtime to trigger a skill.
 * Renderers keep text, Markdown, and JSON views on one stable report contract.
 */
import { existsSync, readFileSync } from "node:fs";
import {
  parseMarkdownFrontmatter,
  skillContentsEquivalent,
} from "./audit/check-drift.js";
import { getAgentProfile, getAgentProfiles } from "./agents/registry.js";
import { CLIError } from "./cli-error.js";
import type { ParsedCLI } from "./cli-types.js";
import { writeOutput } from "./cli-output.js";
import { AUDIT_VERSION, getSkillNames } from "./constants.js";
import { createFS } from "./facts/fs.js";
import { getTemplatePath } from "./paths.js";
import type { AgentProfile, ReadonlyFS } from "./types.js";

type DoctorStatus = "pass" | "warn" | "fail";
type SkillFileState = "readable" | "missing" | "unreadable";
type SkillMirrorStatus = "match" | "drift" | "unavailable";
type FrontmatterStatus =
  "valid" | "missing" | "invalid-yaml" | "invalid-fields" | "unavailable";
/** Canonical package read used by production and injectable unit fixtures. */
export interface CanonicalSkillRead {
  state: SkillFileState;
  content: string | null;
}

/** Discovery metadata users need to understand one installed SKILL.md. */
interface SkillFrontmatterDiagnosis {
  status: FrontmatterStatus;
  name: string | null;
  description: string | null;
  goatFlowSkillVersion: string | null;
  invocationControlFields: Record<string, unknown>;
}

/** One canonical skill viewed through one selected agent profile. */
interface SkillDoctorEntry {
  canonicalName: string;
  invocation: string;
  sourcePath: string;
  installedPath: string;
  sourceState: SkillFileState;
  installedState: SkillFileState;
  mirrorStatus: SkillMirrorStatus;
  frontmatter: SkillFrontmatterDiagnosis;
  staticEligibility: "eligible" | "blocked";
  blockingReasons: string[];
  warnings: string[];
  remediation: string[];
}

/** Agent grouping used by both human and machine-readable reports. */
interface AgentSkillDoctorResult {
  agent: {
    id: AgentProfile["id"];
    name: string;
    invocationStyle: AgentProfile["promptInvocationStyle"];
    skillSource: AgentProfile["skillSource"];
    skillsDirectory: string;
  };
  skills: SkillDoctorEntry[];
}

/** Stable skill-doctor payload for CLI output and later dashboard consumption. */
export interface SkillDoctorReport {
  reportKind: "goat-flow-skill-doctor";
  status: DoctorStatus;
  target: string;
  evidenceLimit: string;
  summary: {
    agents: number;
    checked: number;
    eligible: number;
    blocked: number;
    warnings: number;
  };
  agents: AgentSkillDoctorResult[];
}

/** Inputs for collecting one static doctor report without changing the target. */
interface SkillDoctorOptions {
  projectPath: string;
  fs: ReadonlyFS;
  agentProfiles: readonly AgentProfile[];
  canonicalSkillNames: readonly string[];
  skillFilter: string | null;
  readCanonicalSkill?: (sourcePath: string) => CanonicalSkillRead;
}

/** Internal frontmatter diagnosis plus reasons attached to the skill row. */
interface FrontmatterInspection {
  diagnosis: SkillFrontmatterDiagnosis;
  blockingReasons: string[];
  warnings: string[];
}

/** Mutable row used only while duplicate identities are added after collection. */
interface MutableSkillDoctorEntry extends SkillDoctorEntry {
  blockingReasons: string[];
  warnings: string[];
  remediation: string[];
}

/** User-facing failure for an invalid doctor selection.
 * Use when a filter or profile cannot produce an honest report.
 * The CLI adapter converts it to the familiar usage exit code 2. */
class SkillDoctorInputError extends Error {
  /** Create one usage failure whose message tells the user which input to correct. */
  constructor(message: string) {
    super(message);
    this.name = "SkillDoctorInputError";
  }
}

/** Check whether parsed YAML is an object whose fields can describe discovery. */
function isFrontmatterRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Read a canonical workflow skill from the installed package source.
 * Use to distinguish missing source from an unreadable package file.
 * The function swallows read errors into unreadable evidence so diagnosis continues.
 *
 * @param sourcePath - canonical package path; empty means package-root lookup has no skill name
 * @returns readable text, missing state, or unreadable state; filesystem errors never escape
 */
function readCanonicalSkill(sourcePath: string): CanonicalSkillRead {
  const absoluteSourcePath = getTemplatePath(sourcePath);

  // A missing package source prevents mirror verification but does not erase an installed skill.
  if (!existsSync(absoluteSourcePath))
    return { state: "missing", content: null };
  try {
    return {
      state: "readable",
      content: readFileSync(absoluteSourcePath, "utf8"),
    };
  } catch {
    // For example, package permissions can make a visible source unreadable during a user diagnosis.
    return { state: "unreadable", content: null };
  }
}

/**
 * Return explicit invocation-shaped metadata without assigning undocumented semantics.
 * Use when a skill actually declares disabled or non-invocable fields.
 */
function collectInvocationControlFields(
  frontmatter: Record<string, unknown>,
): Record<string, unknown> {
  const controls: Record<string, unknown> = {};

  // Every explicit invocation/disable key is shown so users can inspect host-specific metadata.
  for (const [fieldName, fieldValue] of Object.entries(frontmatter)) {
    // Ordinary discovery fields stay in their named report columns instead of this control bucket.
    if (!/(?:invocation|invocable|disabled?)/iu.test(fieldName)) continue;
    controls[fieldName] = fieldValue;
  }
  return controls;
}

/** Create the empty discovery shape used when frontmatter cannot supply fields. */
function emptyFrontmatterDiagnosis(
  status: FrontmatterStatus,
): SkillFrontmatterDiagnosis {
  return {
    status,
    name: null,
    description: null,
    goatFlowSkillVersion: null,
    invocationControlFields: {},
  };
}

/** Return one blocking frontmatter result with no unrelated warnings. */
function blockedFrontmatterInspection(
  status: FrontmatterStatus,
  reason: string,
): FrontmatterInspection {
  return {
    diagnosis: emptyFrontmatterDiagnosis(status),
    blockingReasons: [reason],
    warnings: [],
  };
}

/** Normalize a YAML discovery value into non-empty text or null. */
function frontmatterText(value: unknown): string | null {
  const text = typeof value === "string" ? value.trim() : null;
  return text?.length ? text : null;
}

/** Explain missing or stale goat-flow version metadata without blocking discovery. */
function versionWarnings(version: string | null): string[] {
  // Missing version metadata prevents freshness proof but not static host discovery.
  if (version === null) return ["goat-flow-skill-version is missing or empty"];

  // A different package version tells the user this installed guidance is stale.
  if (version !== AUDIT_VERSION) {
    return [
      `goat-flow-skill-version ${version} differs from package ${AUDIT_VERSION}`,
    ];
  }
  return [];
}

/** Build discovery field status after YAML has been proven to be an object. */
function inspectFrontmatterFields(
  parsedFrontmatter: Record<string, unknown>,
): FrontmatterInspection {
  const name = frontmatterText(parsedFrontmatter.name);
  const description = frontmatterText(parsedFrontmatter.description);
  const goatFlowSkillVersion = frontmatterText(
    parsedFrontmatter["goat-flow-skill-version"],
  );
  const blockingReasons: string[] = [];

  // A missing name gives the user no stable explicit invocation identity.
  if (name === null) {
    blockingReasons.push("frontmatter name is missing or empty");
  }

  // A missing description removes the trigger metadata shown to the model runtime.
  if (description === null) {
    blockingReasons.push("frontmatter description is missing or empty");
  }
  const warnings = versionWarnings(goatFlowSkillVersion);
  const invocationControlFields =
    collectInvocationControlFields(parsedFrontmatter);

  // Host-specific control fields are evidence to show, not permission to invent trigger behavior.
  if (Object.keys(invocationControlFields).length > 0) {
    warnings.push(
      "frontmatter declares invocation-control metadata; inspect the reported fields against the selected host",
    );
  }

  return {
    diagnosis: {
      status: blockingReasons.length === 0 ? "valid" : "invalid-fields",
      name,
      description,
      goatFlowSkillVersion,
      invocationControlFields,
    },
    blockingReasons,
    warnings,
  };
}

/**
 * Parse installed discovery metadata and explain every static field failure.
 * Use before duplicate-name checks so each broken file keeps its own evidence.
 */
function inspectFrontmatter(content: string | null): FrontmatterInspection {
  // Missing or unreadable content already has a precise installed-file blocker.
  if (content === null) {
    return {
      diagnosis: emptyFrontmatterDiagnosis("unavailable"),
      blockingReasons: [],
      warnings: [],
    };
  }
  const hasFrontmatterBlock = /^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/u.test(
    content,
  );

  // Without YAML frontmatter, the host has no declared name or trigger description to discover.
  if (!hasFrontmatterBlock) {
    return blockedFrontmatterInspection(
      "missing",
      "installed SKILL.md has no YAML frontmatter block",
    );
  }

  const parsedFrontmatter = parseMarkdownFrontmatter(content).frontmatter;

  // The shared parser preserves malformed YAML under a sentinel instead of throwing.
  if (
    isFrontmatterRecord(parsedFrontmatter) &&
    Object.hasOwn(parsedFrontmatter, "__parseError")
  ) {
    return blockedFrontmatterInspection(
      "invalid-yaml",
      "installed SKILL.md frontmatter cannot be parsed as YAML",
    );
  }

  // A scalar or array is valid YAML but cannot supply named discovery fields.
  if (!isFrontmatterRecord(parsedFrontmatter)) {
    return blockedFrontmatterInspection(
      "invalid-fields",
      "installed SKILL.md frontmatter must be a field map",
    );
  }
  return inspectFrontmatterFields(parsedFrontmatter);
}

/** Return the explicit user invocation syntax declared by the selected agent profile. */
function expectedInvocation(
  agentProfile: AgentProfile,
  canonicalSkillName: string,
): string {
  return agentProfile.promptInvocationStyle === "slash"
    ? `/${canonicalSkillName}`
    : `$${canonicalSkillName}`;
}

/** Read one installed skill while preserving missing versus unreadable evidence. */
function readInstalledSkill(
  fs: ReadonlyFS,
  installedPath: string,
): CanonicalSkillRead {
  // A missing path tells the user setup never installed this canonical skill.
  if (!fs.exists(installedPath)) return { state: "missing", content: null };
  const content = fs.readFile(installedPath);

  // For example, restrictive file permissions can leave a visible mirror unreadable.
  if (content === null) return { state: "unreadable", content: null };
  return { state: "readable", content };
}

/** Build static installed-file and identity blockers for one canonical skill. */
function skillBlockingReasons(
  installedState: SkillFileState,
  frontmatter: SkillFrontmatterDiagnosis,
  canonicalSkillName: string,
  frontmatterReasons: readonly string[],
): string[] {
  const blockingReasons = [...frontmatterReasons];

  // A missing installed contract leaves the selected agent with nothing to load.
  if (installedState === "missing") {
    blockingReasons.push("installed SKILL.md is missing");
  }

  // A visible but unreadable contract cannot provide instructions to the selected agent.
  if (installedState === "unreadable") {
    blockingReasons.push("installed SKILL.md exists but is unreadable");
  }

  // A mismatched name makes the expected command and installed discovery identity disagree.
  if (frontmatter.name !== null && frontmatter.name !== canonicalSkillName) {
    blockingReasons.push(
      `frontmatter name "${frontmatter.name}" does not match canonical command "${canonicalSkillName}"`,
    );
  }
  return blockingReasons;
}

/** Explain canonical source availability without treating it as model behavior. */
function canonicalSourceWarnings(source: CanonicalSkillRead): string[] {
  // Missing source prevents mirror proof but does not erase readable installed guidance.
  if (source.state === "missing") {
    return [
      "canonical workflow source is missing; mirror status is unavailable",
    ];
  }

  // Unreadable source points at a package access problem rather than a trigger failure.
  if (source.state === "unreadable") {
    return [
      "canonical workflow source exists but is unreadable; mirror status is unavailable",
    ];
  }
  return [];
}

/** Compare readable source and installed text using the existing drift semantics. */
function compareSkillMirror(
  sourceContent: string | null,
  installedContent: string | null,
): SkillMirrorStatus {
  // Either unavailable side makes an honest content comparison impossible.
  if (sourceContent === null || installedContent === null) return "unavailable";
  return skillContentsEquivalent(sourceContent, installedContent)
    ? "match"
    : "drift";
}

/** Build existing repair/check commands without allowing doctor to mutate the target. */
function skillRemediation(
  agentProfile: AgentProfile,
  hasProblems: boolean,
): string[] {
  const commands: string[] = [];

  // Installation is offered only when the report found something users may need to restore.
  if (hasProblems) {
    commands.push(
      `goat-flow install <project-path> --agent ${agentProfile.id}`,
    );
  }
  commands.push(
    `goat-flow audit <project-path> --agent ${agentProfile.id} --check-drift`,
  );
  return commands;
}

/**
 * Collect one skill row from canonical source, installed mirror, and profile metadata.
 * Use so every renderer receives the same paths, blockers, warnings, and repair commands.
 */
function inspectSkill(
  fs: ReadonlyFS,
  agentProfile: AgentProfile,
  canonicalSkillName: string,
  canonicalReader: (sourcePath: string) => CanonicalSkillRead,
): MutableSkillDoctorEntry {
  const sourcePath = `workflow/skills/${canonicalSkillName}/SKILL.md`;
  const installedPath = `${agentProfile.skillsDir}/${canonicalSkillName}/SKILL.md`;
  const source = canonicalReader(sourcePath);
  const installed = readInstalledSkill(fs, installedPath);
  const frontmatterInspection = inspectFrontmatter(installed.content);
  const blockingReasons = skillBlockingReasons(
    installed.state,
    frontmatterInspection.diagnosis,
    canonicalSkillName,
    frontmatterInspection.blockingReasons,
  );
  const mirrorStatus = compareSkillMirror(source.content, installed.content);
  const warnings = [
    ...frontmatterInspection.warnings,
    ...canonicalSourceWarnings(source),
  ];

  // Content drift means users may read older guidance even when static discovery remains possible.
  if (mirrorStatus === "drift") {
    warnings.push("installed SKILL.md differs from canonical source");
  }
  const remediation = skillRemediation(
    agentProfile,
    blockingReasons.length > 0 || warnings.length > 0,
  );

  return {
    canonicalName: canonicalSkillName,
    invocation: expectedInvocation(agentProfile, canonicalSkillName),
    sourcePath,
    installedPath,
    sourceState: source.state,
    installedState: installed.state,
    mirrorStatus,
    frontmatter: frontmatterInspection.diagnosis,
    staticEligibility: blockingReasons.length === 0 ? "eligible" : "blocked",
    blockingReasons,
    warnings,
    remediation,
  };
}

/**
 * Mark every row participating in an installed frontmatter-name collision.
 * Use after collection because duplicate evidence needs all canonical paths.
 */
function applyDuplicateNameBlockers(skills: MutableSkillDoctorEntry[]): void {
  const skillsByFrontmatterName = new Map<string, MutableSkillDoctorEntry[]>();

  // Each usable frontmatter name joins the collision group users would invoke.
  for (const skill of skills) {
    const frontmatterName = skill.frontmatter.name;

    // Missing/invalid names already carry their own precise blocker.
    if (frontmatterName === null) continue;
    const matchingSkills = skillsByFrontmatterName.get(frontmatterName) ?? [];
    matchingSkills.push(skill);
    skillsByFrontmatterName.set(frontmatterName, matchingSkills);
  }

  // Any name claimed by multiple canonical rows is ambiguous for the selected agent.
  for (const [frontmatterName, matchingSkills] of skillsByFrontmatterName) {
    // A single owner is the expected command-to-contract relationship.
    if (matchingSkills.length < 2) continue;
    const conflictingPaths = matchingSkills
      .map((skill) => skill.installedPath)
      .join(", ");

    // Every colliding row shows the complete set of paths the user must reconcile.
    for (const skill of matchingSkills) {
      skill.blockingReasons.push(
        `duplicate installed frontmatter name "${frontmatterName}" appears in ${conflictingPaths}`,
      );
      skill.staticEligibility = "blocked";
    }
  }
}

/**
 * Validate the canonical skill filter users asked to focus on.
 * The filter narrows only the rendered rows: duplicate-name evidence is always
 * collected across the complete canonical inventory first.
 */
function selectedSkillNames(
  canonicalSkillNames: readonly string[],
  skillFilter: string | null,
): readonly string[] {
  // With no filter, users receive the complete canonical skill inventory.
  if (skillFilter === null) return canonicalSkillNames;
  const normalizedFilter = skillFilter.trim();

  // Empty or unknown filters are usage errors rather than misleading empty reports.
  if (
    normalizedFilter.length === 0 ||
    !canonicalSkillNames.includes(normalizedFilter)
  ) {
    throw new SkillDoctorInputError(
      `Unknown canonical skill "${skillFilter}". Use: ${canonicalSkillNames.join(", ")}`,
    );
  }
  return [normalizedFilter];
}

/**
 * Build the complete read-only skill doctor report for selected agent profiles.
 * Use from CLI or tests; this function never writes, installs, or invokes a model.
 *
 * @param options - target, profiles, canonical names, and readers; empty profiles/filter are invalid
 * @returns stable static diagnosis grouped by the agent and skills the user selected
 * @throws `SkillDoctorInputError` when no profile or canonical filter can be diagnosed
 */
export function runSkillDoctor(options: SkillDoctorOptions): SkillDoctorReport {
  // A report without an agent profile cannot explain any actual installed mirror or invocation style.
  if (options.agentProfiles.length === 0) {
    throw new SkillDoctorInputError(
      "No supported agent profiles were selected.",
    );
  }
  const canonicalReader = options.readCanonicalSkill ?? readCanonicalSkill;
  const skillNames = selectedSkillNames(
    options.canonicalSkillNames,
    options.skillFilter,
  );

  // Each selected profile gets its own invocation style and installed-path diagnosis.
  const agents = options.agentProfiles.map((agentProfile) => {
    // Duplicate-name evidence needs every canonical row: a focused --skill run
    // must still see a collision claimed by another installed skill, so the
    // full mirror is inspected first and the filter narrows rendered rows only.
    const allSkills = options.canonicalSkillNames.map((canonicalSkillName) =>
      inspectSkill(
        options.fs,
        agentProfile,
        canonicalSkillName,
        canonicalReader,
      ),
    );
    applyDuplicateNameBlockers(allSkills);
    const skills = allSkills.filter((skill) =>
      skillNames.includes(skill.canonicalName),
    );
    return {
      agent: {
        id: agentProfile.id,
        name: agentProfile.name,
        invocationStyle: agentProfile.promptInvocationStyle,
        skillSource: agentProfile.skillSource,
        skillsDirectory: agentProfile.skillsDir,
      },
      skills,
    };
  });
  const allSkills = agents.flatMap((agentResult) => agentResult.skills);
  const blocked = allSkills.filter(
    (skill) => skill.staticEligibility === "blocked",
  ).length;
  const warnings = allSkills.reduce(
    (warningCount, skill) => warningCount + skill.warnings.length,
    0,
  );
  const status: DoctorStatus =
    blocked > 0 ? "fail" : warnings > 0 ? "warn" : "pass";

  return {
    reportKind: "goat-flow-skill-doctor",
    status,
    target: options.projectPath,
    evidenceLimit:
      "Static evidence only: files and manifest metadata cannot prove whether a model will auto-trigger a skill.",
    summary: {
      agents: agents.length,
      checked: allSkills.length,
      eligible: allSkills.length - blocked,
      blocked,
      warnings,
    },
    agents,
  };
}

/**
 * Render the stable machine-readable payload with no diagnostic text on stdout.
 *
 * @param report - completed doctor report; empty agent groups remain valid JSON arrays
 * @returns pretty JSON suitable for jq, CI, or later dashboard consumption
 */
export function renderSkillDoctorJson(report: SkillDoctorReport): string {
  return JSON.stringify(report, null, 2);
}

/**
 * Render grouped terminal evidence so each skill keeps its paths and actions together.
 * Nested loops are intentional because each path/problem must stay under its agent and skill.
 *
 * @param report - completed doctor report; empty reason lists render no problem rows
 * @returns terminal text ending in one grep-friendly summary line
 */
export function renderSkillDoctorText(report: SkillDoctorReport): string {
  const lines = [
    "Skill doctor",
    `Target: ${report.target}`,
    `Evidence limit: ${report.evidenceLimit}`,
  ];

  // Each agent group explains the exact path and invocation syntax users selected.
  for (const agentResult of report.agents) {
    lines.push("");
    lines.push(
      `${agentResult.agent.name} (${agentResult.agent.id}) · ${agentResult.agent.invocationStyle} · ${agentResult.agent.skillSource}`,
    );

    // Every canonical skill row keeps path, discovery, and repair evidence together.
    for (const skill of agentResult.skills) {
      lines.push(`  ${skill.invocation} · ${skill.staticEligibility}`);
      lines.push(
        `    Installed: ${skill.installedPath} (${skill.installedState})`,
      );
      lines.push(`    Source: ${skill.sourcePath} (${skill.sourceState})`);
      lines.push(`    Mirror: ${skill.mirrorStatus}`);
      lines.push(
        `    Frontmatter: ${skill.frontmatter.status}; name=${skill.frontmatter.name ?? "n/a"}; description=${skill.frontmatter.description ?? "n/a"}`,
      );

      // Explicit host-control metadata appears only when the installed file declares it.
      if (Object.keys(skill.frontmatter.invocationControlFields).length > 0) {
        lines.push(
          `    Invocation controls: ${JSON.stringify(skill.frontmatter.invocationControlFields)}`,
        );
      }

      // Static blockers explain why this installed contract is not eligible for discovery.
      for (const reason of skill.blockingReasons) {
        lines.push(`    Blocked: ${reason}`);
      }

      // Warnings distinguish stale source/mirrors from actual discovery blockers.
      for (const warning of skill.warnings) {
        lines.push(`    Warning: ${warning}`);
      }

      // Existing commands let users repair and then verify without doctor mutating anything.
      for (const command of skill.remediation) {
        lines.push(`    Verify/repair: ${command}`);
      }
    }
  }
  lines.push("");
  lines.push(
    `${report.status.toUpperCase()} skill doctor: ${report.summary.checked} checked · ${report.summary.eligible} eligible · ${report.summary.blocked} blocked · ${report.summary.warnings} warnings`,
  );
  return lines.join("\n");
}

/**
 * Render one table per agent so report readers retain profile-specific invocation syntax.
 * Nested loops are intentional because problem rows must remain beside their owning skill.
 *
 * @param report - completed doctor report; empty problem lists produce only skill rows
 * @returns Markdown suitable for saved reports or pull-request comments
 */
function renderSkillDoctorMarkdown(report: SkillDoctorReport): string {
  const lines = [
    "# Skill doctor",
    "",
    `**Target:** \`${report.target}\``,
    "",
    `**Evidence limit:** ${report.evidenceLimit}`,
  ];

  // Each agent table preserves user-facing invocation and exact filesystem evidence.
  for (const agentResult of report.agents) {
    lines.push("");
    lines.push(`## ${agentResult.agent.name} (${agentResult.agent.id})`);
    lines.push("");
    lines.push(
      "| Invocation | Eligibility | Installed | Source | Mirror | Frontmatter |",
    );
    lines.push("|---|---|---|---|---|---|");

    // Each canonical skill becomes one stable row for later dashboard reuse.
    for (const skill of agentResult.skills) {
      lines.push(
        `| \`${skill.invocation}\` | ${skill.staticEligibility} | \`${skill.installedPath}\` (${skill.installedState}) | \`${skill.sourcePath}\` (${skill.sourceState}) | ${skill.mirrorStatus} | ${skill.frontmatter.status} |`,
      );

      // Problems remain adjacent to the row so a user can act without cross-referencing JSON.
      for (const reason of skill.blockingReasons) {
        lines.push(`|  | **Blocked:** ${reason} |  |  |  |  |`);
      }

      // Mirror and metadata warnings remain non-blocking in the presentation.
      for (const warning of skill.warnings) {
        lines.push(`|  | **Warning:** ${warning} |  |  |  |  |`);
      }
    }
  }
  lines.push("");
  lines.push(
    `**${report.status.toUpperCase()} skill doctor:** ${report.summary.checked} checked · ${report.summary.eligible} eligible · ${report.summary.blocked} blocked · ${report.summary.warnings} warnings`,
  );
  return lines.join("\n");
}

/**
 * Run the CLI adapter for `skill doctor` using manifest-backed profiles.
 * Use from command dispatch; failures set exit status without changing target files.
 * Throws `CLIError` for invalid filters and rethrows unexpected operational errors.
 *
 * @param options - parsed command, target, profile/filter, and output format selections
 * @returns nothing after emitting the selected report format
 * @throws `CLIError` for invalid doctor input; unexpected read/runtime errors pass through
 */
export function handleSkillDoctorCommand(options: ParsedCLI): void {
  const agentProfiles = options.agent
    ? [getAgentProfile(options.agent)]
    : getAgentProfiles();
  let report: SkillDoctorReport;
  try {
    report = runSkillDoctor({
      projectPath: options.projectPath,
      fs: createFS(options.projectPath),
      agentProfiles,
      canonicalSkillNames: getSkillNames(),
      skillFilter: options.skillFilter,
    });
  } catch (error) {
    // For example, a user can pass an unknown --skill filter after choosing doctor mode.
    if (error instanceof SkillDoctorInputError) {
      throw new CLIError(error.message, 2);
    }
    throw error;
  }

  const rendered =
    options.format === "json"
      ? renderSkillDoctorJson(report)
      : options.format === "markdown"
        ? renderSkillDoctorMarkdown(report)
        : renderSkillDoctorText(report);
  writeOutput(options, rendered);

  // A blocked installed contract makes the diagnostic command useful as a CI failure.
  if (report.status === "fail") process.exitCode = 1;
}
