/**
 * Single source of truth for workflow manifest data and derived facts.
 * Use from setup, audit, quality, and dashboard flows when users need the
 * current skills, agents, checks, or required files. Invalid static metadata
 * stops loading with precise repair evidence instead of leaking stale state.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { getSkillNames } from "../constants.js";
import { SETUP_CHECKS } from "../audit/check-goat-flow.js";
import { AGENT_CHECKS } from "../audit/check-agent-setup.js";
import { HARNESS_CHECKS } from "../audit/harness/index.js";
import {
  getPackageVersion,
  getTemplatePath,
  isPackagedInstall,
  resolveFirstExistingPackagePath,
} from "../paths.js";
import type {
  CheckFacts,
  Manifest,
  ManifestCheckReport,
  ManifestJson,
  ObservedFacts,
  ResolvedFacts,
  SkillFacts,
} from "./types.js";
import { ManifestValidationError } from "./types.js";
import {
  readManifestJson,
  validateSkillReferenceSchema,
} from "./manifest-json.js";

// Re-exported here for API stability. These declarations moved into a sibling
// module to break a circular dependency (its header explains the full story);
// consumers and tests still reference them through this module.
// (search: "design.circular-import")
export {
  validateSkillReferenceSchema,
  getRequiredInstructionSections,
} from "./manifest-json.js";

/** goat-flow architectural fact: `goat` is the dispatcher, the rest are functional. */
const DISPATCHER_NAME = "goat";
const PROMPT_INVOCATION_STYLES = new Set(["slash", "dollar"]);
const SKILL_SOURCES = new Set(["installed", "agent-mirror", "github-mirror"]);

/** Raw capability block narrowed from JSON before manifest validation reports field errors. */
interface AgentCapabilityCandidate {
  terminal_binary?: unknown;
  setup_surfaces?: unknown;
  prompt_invocation_style?: unknown;
  skill_source?: unknown;
}

function readAgentCapabilityCandidate(
  agent: unknown,
): AgentCapabilityCandidate | null {
  if (typeof agent !== "object" || agent === null || Array.isArray(agent)) {
    return null;
  }
  const capabilities = (agent as { capabilities?: unknown }).capabilities;
  if (
    typeof capabilities !== "object" ||
    capabilities === null ||
    Array.isArray(capabilities)
  ) {
    return null;
  }
  return capabilities;
}

function validateAgentCapabilityFields(
  capabilities: AgentCapabilityCandidate,
  prefix: string,
): string[] {
  const findings: string[] = [];
  if (
    typeof capabilities.terminal_binary !== "string" ||
    capabilities.terminal_binary.trim().length === 0
  ) {
    findings.push(`${prefix}.terminal_binary must be a non-empty string.`);
  }

  if (
    !Array.isArray(capabilities.setup_surfaces) ||
    capabilities.setup_surfaces.length === 0 ||
    capabilities.setup_surfaces.some(
      (surface) => typeof surface !== "string" || surface.trim().length === 0,
    )
  ) {
    findings.push(`${prefix}.setup_surfaces must be a non-empty string array.`);
  }

  if (
    typeof capabilities.prompt_invocation_style !== "string" ||
    !PROMPT_INVOCATION_STYLES.has(capabilities.prompt_invocation_style)
  ) {
    findings.push(
      `${prefix}.prompt_invocation_style must be one of: slash, dollar.`,
    );
  }

  if (
    typeof capabilities.skill_source !== "string" ||
    !SKILL_SOURCES.has(capabilities.skill_source)
  ) {
    findings.push(
      `${prefix}.skill_source must be one of: installed, agent-mirror, github-mirror.`,
    );
  }
  return findings;
}

/** Reports capability metadata errors so `validateManifest` can aggregate them with drift findings. */
function validateAgentCapabilities(json: ManifestJson): string[] {
  const findings: string[] = [];
  for (const [agentId, agent] of Object.entries(json.agents)) {
    const prefix = `agents.${agentId}.capabilities`;
    const capabilities = readAgentCapabilityCandidate(agent);
    if (capabilities === null) {
      findings.push(`${prefix} must be an object.`);
      continue;
    }
    findings.push(...validateAgentCapabilityFields(capabilities, prefix));
  }
  return findings;
}

/** Enumerate dashboard view names; invariant: manifest view facts mirror these HTML files. */
function readDashboardViewNames(): string[] {
  const dir = getTemplatePath(join("src", "dashboard", "views"));
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".html"))
    .map((f) => f.replace(/\.html$/, ""))
    .sort();
}

/** Relative locations where the dashboard preset catalog may exist. */
const PRESET_CATALOG_PATHS = [
  join("src", "dashboard", "preset-prompts.json"),
  join("dist", "dashboard", "preset-prompts.json"),
] as const;

/** Count preset objects in the dashboard preset catalog; throws when no usable catalog exists. */
function countPresetsFromSource(): number {
  let absolute: string;
  try {
    absolute = resolveFirstExistingPackagePath(PRESET_CATALOG_PATHS);
  } catch {
    throw new ManifestValidationError(
      "Could not find a dashboard preset catalog in src/ or dist/.",
      PRESET_CATALOG_PATHS.map((relative) => `${relative} not found.`),
    );
  }
  const relative =
    PRESET_CATALOG_PATHS.find(
      (candidate) => getTemplatePath(candidate) === absolute,
    ) ?? PRESET_CATALOG_PATHS[0];
  const raw = JSON.parse(readFileSync(absolute, "utf-8")) as unknown;
  if (!Array.isArray(raw)) {
    throw new ManifestValidationError(
      `${relative} must contain a JSON array.`,
      [`${relative} must contain a JSON array.`],
    );
  }
  return raw.length;
}

/** Compute derived skill facts from `getSkillNames()` and the manifest's stale list. */
function computeSkills(
  names: readonly string[],
  staleNames: readonly string[],
): SkillFacts {
  return {
    total: names.length,
    names,
    dispatcher: DISPATCHER_NAME,
    functional_count: names.filter((n) => n !== DISPATCHER_NAME).length,
    stale_names: staleNames,
  };
}

/** Compute derived check counts from the three check arrays. */
function computeChecks(observed: ObservedFacts): CheckFacts {
  return {
    setup: observed.setupChecks,
    agent: observed.agentChecks,
    harness: observed.harnessChecks,
    total: observed.setupChecks + observed.agentChecks + observed.harnessChecks,
  };
}

/** Compare string arrays as sets; invariant: manifest order is not semantically meaningful. */
function sameSortedSet(
  leftValues: readonly string[],
  rightValues: readonly string[],
): boolean {
  if (leftValues.length !== rightValues.length) return false;
  const sortedLeft = [...leftValues].sort();
  const sortedRight = [...rightValues].sort();
  for (let i = 0; i < sortedLeft.length; i++) {
    if (sortedLeft[i] !== sortedRight[i]) return false;
  }
  return true;
}

/**
 * Validate manifest facts against the values observed from live code.
 *
 *  In packaged installs the `src/` tree isn't shipped (package.json `files`
 *  ships only `dist/` + `workflow/`), so source-derived drift checks for
 *  static facts (`dashboard_views`) would always trip against empty observed
 *  values. That fact was validated at publish time - here we trust the
 *  manifest and skip it. Preset count is derived from the shipped preset
 *  catalog, and skill-canonical drift is still checked because `getSkillNames()`
 *  ships in `dist/`.
 *
 * @param json - Parsed manifest JSON from `workflow/manifest.json`.
 * @param observed - Facts observed from the current source or packaged install.
 */
export function validateManifest(
  json: ManifestJson,
  observed: ObservedFacts,
): void {
  validateSkillReferenceSchema(json);
  const findings: string[] = [];
  findings.push(...validateAgentCapabilities(json));

  if (!json.facts) {
    const msg = "workflow/manifest.json is missing the top-level `facts` key.";
    throw new ManifestValidationError(msg, [msg]);
  }

  const packaged = isPackagedInstall();

  if (!packaged) {
    const declaredViews = json.facts.dashboard_views;
    if (!sameSortedSet(declaredViews, observed.views)) {
      findings.push(
        `facts.dashboard_views drift: manifest declares [${[...declaredViews].sort().join(", ")}]; src/dashboard/views/ has [${observed.views.join(", ")}].`,
      );
    }
  }

  if (!sameSortedSet(json.skills.canonical, observed.skills)) {
    findings.push(
      `skills.canonical drift: manifest declares [${[...json.skills.canonical].sort().join(", ")}]; getSkillNames() returns [${[...observed.skills].sort().join(", ")}].`,
    );
  }

  if (findings.length > 0) {
    throw new ManifestValidationError(
      `workflow/manifest.json has drifted from observed state (${findings.length} finding${findings.length === 1 ? "" : "s"}).`,
      findings,
    );
  }
}

/**
 * Compose the resolved manifest from validated JSON and observed facts.
 *
 * @param json - Manifest JSON that has already passed `validateManifest`.
 * @param observed - Current facts used to fill derived fields.
 * @returns Resolved manifest used by CLI, dashboard, and prompt composers.
 */
export function composeManifest(
  json: ManifestJson,
  observed: ObservedFacts,
): Manifest {
  const jsonFacts = json.facts;
  if (!jsonFacts) {
    const msg =
      "composeManifest called before validateManifest - json.facts missing.";
    throw new ManifestValidationError(msg, [msg]);
  }
  const facts: ResolvedFacts = {
    version: observed.version,
    skills: computeSkills(observed.skills, json.skills.stale_names),
    checks: computeChecks(observed),
    dashboard_views: {
      count: jsonFacts.dashboard_views.length,
      names: [...jsonFacts.dashboard_views].sort(),
    },
    presets: { count: observed.presetsCount },
  };
  return {
    version: json.version,
    required_files: json.required_files,
    required_dirs: json.required_dirs,
    skills: json.skills,
    agents: json.agents,
    instruction_file: json.instruction_file,
    facts,
  };
}

/**
 * Return the canonical template-file list for one skill.
 *
 * @param name - Canonical skill name from `getSkillNames()`.
 * @returns `SKILL.md` plus manifest-declared reference files for that skill.
 */
export function getSkillFiles(name: string): string[] {
  const references = loadManifest().skills.references ?? {};
  const files = references[name];
  return [
    "SKILL.md",
    ...(Array.isArray(files)
      ? files.filter((file) => typeof file === "string")
      : []),
  ];
}

/**
 * Return unique installed skill roots declared by the manifest-backed agents.
 *
 * @returns Deduplicated skill-root paths with trailing slashes removed.
 */
export function getInstalledSkillRoots(): string[] {
  return [
    ...new Set(
      Object.values(loadManifest().agents)
        .map((agent) => agent.skills_dir.replace(/\/$/, ""))
        .filter((dir) => dir.length > 0),
    ),
  ];
}

let cached: Manifest | null = null;

/**
 * Load, validate, and cache the resolved workflow manifest.
 *
 * @returns Resolved manifest for the current package/workspace.
 */
export function loadManifest(): Manifest {
  if (cached) return cached;
  const json = readManifestJson();
  const observed: ObservedFacts = {
    views: readDashboardViewNames(),
    presetsCount: countPresetsFromSource(),
    skills: getSkillNames(),
    setupChecks: SETUP_CHECKS.length,
    agentChecks: AGENT_CHECKS.length,
    harnessChecks: HARNESS_CHECKS.length,
    version: getPackageVersion(),
  };
  validateManifest(json, observed);
  cached = composeManifest(json, observed);
  return cached;
}

/** Clear the module-level cache (tests only). */
export function resetManifestCache(): void {
  cached = null;
}

/**
 * Run internal consistency validation for `goat-flow manifest --check`.
 *
 * Reports `ManifestValidationError` because the CLI needs a structured result;
 * unexpected errors still throw so operational failures are not hidden.
 *
 * @returns Pass/fail report with manifest-drift findings.
 */
export function checkManifest(): ManifestCheckReport {
  try {
    loadManifest();
    return { status: "pass", findings: [] };
  } catch (err) {
    if (err instanceof ManifestValidationError) {
      return {
        status: "fail",
        findings: err.findings.map((f) => ({
          rule: "manifest-drift",
          message: f,
        })),
      };
    }
    throw err;
  }
}

/**
 * Render the resolved manifest as a compact Markdown table. Used by `goat-flow manifest`.
 *
 * @param manifest - Resolved manifest to present.
 * @returns Markdown summary of derived facts and agent surfaces.
 */
export function renderManifestMarkdown(manifest: Manifest): string {
  const lines: string[] = [];
  lines.push("# goat-flow manifest");
  lines.push("");
  lines.push(`**Version:** ${manifest.facts.version}`);
  lines.push(
    "**Agent registry authority:** `workflow/manifest.json` rendered through `src/cli/agents/registry.ts`",
  );
  lines.push("");
  lines.push("| Fact | Value | Source |");
  lines.push("|------|-------|--------|");
  lines.push(
    `| Setup checks | ${manifest.facts.checks.setup} | derived: \`SETUP_CHECKS.length\` |`,
  );
  lines.push(
    `| Agent checks | ${manifest.facts.checks.agent} | derived: \`AGENT_CHECKS.length\` |`,
  );
  lines.push(
    `| Harness checks | ${manifest.facts.checks.harness} | derived: \`HARNESS_CHECKS.length\` |`,
  );
  lines.push(
    `| Total checks | ${manifest.facts.checks.total} | derived: sum of above |`,
  );
  lines.push(
    `| Skills (total) | ${manifest.facts.skills.total} | derived: \`getSkillNames().length\` |`,
  );
  lines.push(
    `| Skills (functional) | ${manifest.facts.skills.functional_count} | derived: \`getSkillNames()\` minus dispatcher |`,
  );
  lines.push(
    `| Dispatcher | \`${manifest.facts.skills.dispatcher}\` | architectural constant |`,
  );
  lines.push(
    `| Dashboard views | ${manifest.facts.dashboard_views.count} | static: \`workflow/manifest.json\` (validated against \`src/dashboard/views/\`) |`,
  );
  lines.push(
    `| Presets | ${manifest.facts.presets.count} | derived: preset catalog JSON length |`,
  );
  lines.push("");
  lines.push(
    `**Skills:** ${manifest.facts.skills.names.map((n) => `\`${n}\``).join(", ")}`,
  );
  lines.push("");
  lines.push("## Agents");
  lines.push("");
  lines.push(
    "| Agent | Instruction | Settings | Hook config | Hooks | Skills |",
  );
  lines.push(
    "|------|-------------|----------|-------------|-------|--------|",
  );
  for (const [id, agent] of Object.entries(manifest.agents)) {
    lines.push(
      `| \`${id}\` (${agent.name}) | \`${agent.instruction_file}\` | \`${agent.settings ?? "n/a"}\` | \`${agent.hook_config_file ?? agent.settings ?? "n/a"}\` | \`${agent.hooks_dir ?? "n/a"}\` | \`${agent.skills_dir}\` |`,
    );
  }
  lines.push("");
  lines.push(
    `**Dashboard views:** ${manifest.facts.dashboard_views.names.map((n) => `\`${n}\``).join(", ")}`,
  );
  return lines.join("\n");
}
