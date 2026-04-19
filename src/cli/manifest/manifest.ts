/**
 * Single-source-of-truth manifest loader (M06a).
 *
 * Reads `workflow/manifest.json` and returns a resolved `Manifest` where every
 * `facts` field has been computed from canonical code sources (derived) or
 * validated against observed on-disk reality (static). Loading fails hard with
 * a `ManifestValidationError` when a static fact has drifted from what the
 * code actually exposes — that is the entire point of the module.
 *
 * Used by `composeQuality` and `composeSetup` to avoid hardcoded counts, and
 * by the `goat-flow manifest` CLI command.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { SKILL_NAMES } from "../constants.js";
import { SETUP_CHECKS } from "../audit/check-goat-flow.js";
import { AGENT_CHECKS } from "../audit/check-agent-setup.js";
import { HARNESS_CHECKS } from "../audit/harness/index.js";
import { getPackageVersion, getTemplatePath } from "../paths.js";
import type {
  CheckFacts,
  Manifest,
  ManifestCheckReport,
  ManifestJson,
  ObservedFacts,
  PresetFacts,
  ResolvedFacts,
  SkillFacts,
} from "./types.js";
import { ManifestValidationError } from "./types.js";

/** goat-flow architectural fact: `goat` is the dispatcher, the rest are functional. */
const DISPATCHER_NAME = "goat";

/** Read the on-disk manifest JSON. Throws on missing or malformed file. */
function readManifestJson(): ManifestJson {
  const path = getTemplatePath("workflow/manifest.json");
  const raw = readFileSync(path, "utf-8");
  const json = JSON.parse(raw) as ManifestJson;
  validateSkillReferenceSchema(json);
  return json;
}

/** Validate optional `skills.references` shape before any consumer reads it. */
function validateOneSkillReference(
  canonical: ReadonlySet<string>,
  skillName: string,
  files: unknown,
): string[] {
  const findings: string[] = [];
  if (!canonical.has(skillName)) {
    findings.push(
      `skills.references.${skillName} must reference a canonical skill name.`,
    );
  }
  if (!Array.isArray(files)) {
    findings.push(`skills.references.${skillName} must be a string array.`);
    return findings;
  }
  if (files.some((file) => typeof file !== "string")) {
    findings.push(`skills.references.${skillName} must contain only strings.`);
  }
  return findings;
}

export function validateSkillReferenceSchema(json: ManifestJson): void {
  const references = json.skills.references;
  if (references === undefined) return;
  if (
    typeof references !== "object" ||
    references === null ||
    Array.isArray(references)
  ) {
    throw new ManifestValidationError(
      "workflow/manifest.json has an invalid `skills.references` value.",
      ["skills.references must be an object keyed by canonical skill name."],
    );
  }

  const findings: string[] = [];
  const canonical = new Set(json.skills.canonical);
  for (const [skillName, files] of Object.entries(references)) {
    findings.push(...validateOneSkillReference(canonical, skillName, files));
  }

  if (findings.length > 0) {
    throw new ManifestValidationError(
      `workflow/manifest.json has invalid skill reference metadata (${findings.length} finding${findings.length === 1 ? "" : "s"}).`,
      findings,
    );
  }
}

/** Enumerate dashboard view names by listing `src/dashboard/views/*.html`. */
function readDashboardViewNames(): string[] {
  const dir = getTemplatePath(join("src", "dashboard", "views"));
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".html"))
    .map((f) => f.replace(/\.html$/, ""))
    .sort();
}

/** Count preset objects in preset-prompts.ts by matching each top-level `id:` field. */
function countPresetsFromSource(): number {
  const file = getTemplatePath(join("src", "dashboard", "preset-prompts.ts"));
  if (!existsSync(file)) return 0;
  const text = readFileSync(file, "utf-8");
  const matches = text.match(/^\s+id:\s*"[^"]+",/gm);
  return matches ? matches.length : 0;
}

/** Compute derived skill facts from `SKILL_NAMES` and the manifest's stale list. */
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
function computeChecks(o: ObservedFacts): CheckFacts {
  return {
    setup: o.setupChecks,
    agent: o.agentChecks,
    harness: o.harnessChecks,
    total: o.setupChecks + o.agentChecks + o.harnessChecks,
  };
}

/** Compare two string arrays for set-equality after sorting. */
function sameSortedSet(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const sa = [...a].sort();
  const sb = [...b].sort();
  for (let i = 0; i < sa.length; i++) {
    if (sa[i] !== sb[i]) return false;
  }
  return true;
}

/** Validate manifest facts against the values observed from live code. */
export function validateManifest(
  json: ManifestJson,
  observed: ObservedFacts,
): void {
  const findings: string[] = [];

  if (!json.facts) {
    const msg =
      "workflow/manifest.json is missing the top-level `facts` key (M06 expected shape).";
    throw new ManifestValidationError(msg, [msg]);
  }

  const declaredViews = json.facts.dashboard_views;
  if (!sameSortedSet(declaredViews, observed.views)) {
    findings.push(
      `facts.dashboard_views drift: manifest declares [${[...declaredViews].sort().join(", ")}]; src/dashboard/views/ has [${observed.views.join(", ")}].`,
    );
  }

  if (json.facts.presets_count !== observed.presetsCount) {
    findings.push(
      `facts.presets_count drift: manifest declares ${json.facts.presets_count}; src/dashboard/preset-prompts.ts defines ${observed.presetsCount}.`,
    );
  }

  if (!sameSortedSet(json.skills.canonical, observed.skills)) {
    findings.push(
      `skills.canonical drift: manifest declares [${[...json.skills.canonical].sort().join(", ")}]; SKILL_NAMES exports [${[...observed.skills].sort().join(", ")}].`,
    );
  }

  if (findings.length > 0) {
    throw new ManifestValidationError(
      `workflow/manifest.json has drifted from observed state (${findings.length} finding${findings.length === 1 ? "" : "s"}).`,
      findings,
    );
  }
}

/** Compose the resolved manifest from validated JSON and observed facts. */
export function composeManifest(
  json: ManifestJson,
  observed: ObservedFacts,
): Manifest {
  const jsonFacts = json.facts;
  if (!jsonFacts) {
    const msg =
      "composeManifest called before validateManifest — json.facts missing.";
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
    presets: { count: jsonFacts.presets_count } as PresetFacts,
  };
  return {
    version: json.version,
    skills: json.skills,
    agents: json.agents,
    facts,
  };
}

/** Return the canonical template-file list for one skill. */
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

/** Return unique installed skill roots declared by the manifest-backed agents. */
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

/** Load, validate, and cache the resolved workflow manifest. */
export function loadManifest(): Manifest {
  if (cached) return cached;
  const json = readManifestJson();
  const observed: ObservedFacts = {
    views: readDashboardViewNames(),
    presetsCount: countPresetsFromSource(),
    skills: SKILL_NAMES,
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

/** Run internal consistency check and return a report. Used by `goat-flow manifest --check`. */
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

/** Render the resolved manifest as a compact Markdown table. Used by `goat-flow manifest`. */
export function renderManifestMarkdown(m: Manifest): string {
  const lines: string[] = [];
  lines.push("# goat-flow manifest");
  lines.push("");
  lines.push(`**Version:** ${m.facts.version}`);
  lines.push(
    "**Agent registry authority:** `workflow/manifest.json` rendered through `src/cli/agents/registry.ts`",
  );
  lines.push("");
  lines.push("| Fact | Value | Source |");
  lines.push("|------|-------|--------|");
  lines.push(
    `| Setup checks | ${m.facts.checks.setup} | derived: \`SETUP_CHECKS.length\` |`,
  );
  lines.push(
    `| Agent checks | ${m.facts.checks.agent} | derived: \`AGENT_CHECKS.length\` |`,
  );
  lines.push(
    `| Harness checks | ${m.facts.checks.harness} | derived: \`HARNESS_CHECKS.length\` |`,
  );
  lines.push(
    `| Total checks | ${m.facts.checks.total} | derived: sum of above |`,
  );
  lines.push(
    `| Skills (total) | ${m.facts.skills.total} | derived: \`SKILL_NAMES.length\` |`,
  );
  lines.push(
    `| Skills (functional) | ${m.facts.skills.functional_count} | derived: \`SKILL_NAMES\` minus dispatcher |`,
  );
  lines.push(
    `| Dispatcher | \`${m.facts.skills.dispatcher}\` | architectural constant |`,
  );
  lines.push(
    `| Dashboard views | ${m.facts.dashboard_views.count} | static: \`workflow/manifest.json\` (validated against \`src/dashboard/views/\`) |`,
  );
  lines.push(
    `| Presets | ${m.facts.presets.count} | static: \`workflow/manifest.json\` (validated against \`src/dashboard/preset-prompts.ts\`) |`,
  );
  lines.push("");
  lines.push(
    `**Skills:** ${m.facts.skills.names.map((n) => `\`${n}\``).join(", ")}`,
  );
  lines.push("");
  lines.push("## Agents");
  lines.push("");
  lines.push(
    "| Agent | Instruction | Settings | Hook config | Hooks | Skills | Compaction |",
  );
  lines.push(
    "|------|-------------|----------|-------------|-------|--------|------------|",
  );
  for (const [id, agent] of Object.entries(m.agents)) {
    lines.push(
      `| \`${id}\` (${agent.name}) | \`${agent.instruction_file}\` | \`${agent.settings ?? "n/a"}\` | \`${agent.hook_config_file ?? agent.settings ?? "n/a"}\` | \`${agent.hooks_dir ?? "n/a"}\` | \`${agent.skills_dir}\` | \`${agent.capabilities.compaction_support}\` |`,
    );
  }
  lines.push("");
  lines.push(
    `**Dashboard views:** ${m.facts.dashboard_views.names.map((n) => `\`${n}\``).join(", ")}`,
  );
  return lines.join("\n");
}
