/**
 * Template-vs-installed drift detection for goat-flow skills (M04).
 *
 * Compares the canonical templates shipped in goat-flow against the
 * installed copies inside a consumer project (or the goat-flow repo
 * itself when run on its own root):
 *
 *   - Per-skill SKILL.md for every name in SKILL_NAMES:
 *       workflow/skills/<name>/SKILL.md  vs
 *       .claude/skills/<name>/SKILL.md
 *       .agents/skills/<name>/SKILL.md
 *   - Shared meta references (template → installed in .goat-flow/skill-reference/):
 *       workflow/skills/reference/README.md                 vs .goat-flow/skill-reference/README.md
 *       workflow/skills/reference/skill-preamble.md         vs .goat-flow/skill-reference/skill-preamble.md
 *       workflow/skills/reference/skill-conventions.md      vs .goat-flow/skill-reference/skill-conventions.md
 *   - Standalone playbooks (template → installed in .goat-flow/skill-playbooks/):
 *       workflow/skills/playbooks/README.md                 vs .goat-flow/skill-playbooks/README.md
 *       workflow/skills/playbooks/browser-use.md            vs .goat-flow/skill-playbooks/browser-use.md
 *       workflow/skills/playbooks/code-comments.md          vs .goat-flow/skill-playbooks/code-comments.md
 *       workflow/skills/playbooks/gruff-code-quality.md            vs .goat-flow/skill-playbooks/gruff-code-quality.md
 *       workflow/skills/playbooks/observability.md          vs .goat-flow/skill-playbooks/observability.md
 *       workflow/skills/playbooks/changelog.md              vs .goat-flow/skill-playbooks/changelog.md
 *       workflow/skills/playbooks/page-capture.md           vs .goat-flow/skill-playbooks/page-capture.md
 *       workflow/skills/playbooks/release-notes.md          vs .goat-flow/skill-playbooks/release-notes.md
 *       workflow/skills/playbooks/skill-quality-testing.md  vs .goat-flow/skill-playbooks/skill-quality-testing.md
 *   - Orphan directories under .claude/skills or .agents/skills whose
 *     name is not in SKILL_NAMES. Names that appear in manifest.stale_names
 *     are reported as deprecated instead of a plain orphan.
 *
 * Comparison is semantic: YAML frontmatter is parsed and compared
 * structurally (after stripping null/undefined leaves to avoid false
 * negatives on bare keys like `description:`), body content is
 * compared after trimEnd() + single trailing newline normalization.
 * This avoids false positives on key reorder or trailing whitespace.
 */
import { readFileSync, existsSync } from "node:fs";
import { posix as pathPosix, resolve as resolvePath } from "node:path";
import { load } from "js-yaml";
import { isDeepStrictEqual } from "node:util";
import type { ReadonlyFS } from "../types.js";
import { SKILL_NAMES } from "../constants.js";
import { getTemplatePath } from "../paths.js";
import {
  getInstalledSkillRoots,
  getSkillFiles,
  loadManifest,
} from "../manifest/manifest.js";
import { listHookSpecs, type HookSpec } from "../server/hooks-registry.js";
import type { AgentId } from "../types.js";
import type { AgentProfile } from "../manifest/types.js";
import type { DriftFinding, DriftReport } from "./types.js";

const KNOWN_AGENT_IDS = new Set(["claude", "codex", "antigravity", "copilot"]);

/** Remove nullish values from nested data before comparing manifests. */
function stripNullish(frontmatterValue: unknown): unknown {
  if (frontmatterValue === null || frontmatterValue === undefined) {
    return undefined;
  }
  if (Array.isArray(frontmatterValue)) {
    return frontmatterValue.map(stripNullish).filter((v) => v !== undefined);
  }
  if (typeof frontmatterValue === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(
      frontmatterValue as Record<string, unknown>,
    )) {
      const cleaned = stripNullish(v);
      if (cleaned !== undefined) out[k] = cleaned;
    }
    return out;
  }
  return frontmatterValue;
}

/**
 * Parse YAML frontmatter and body text from a markdown file.
 *
 * The parser swallows malformed YAML into a sentinel object and never throws so
 * drift checks can report content mismatch without aborting the whole audit.
 *
 * @param raw - Full markdown file contents, including optional YAML frontmatter.
 * @returns Parsed frontmatter plus body text after the closing marker.
 */
export function parseMarkdownFrontmatter(raw: string): {
  frontmatter: unknown;
  body: string;
} {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return { frontmatter: {}, body: raw };
  const rawFrontmatter = match[1] ?? "";
  const body = match[2] ?? "";
  let parsedRaw: unknown;
  try {
    parsedRaw = load(rawFrontmatter) ?? {};
  } catch {
    return { frontmatter: { __parseError: rawFrontmatter }, body };
  }
  const cleaned = stripNullish(parsedRaw);
  return { frontmatter: cleaned ?? {}, body };
}

/** Normalize markdown body text before drift comparisons. */
function normalizeBody(body: string): string {
  return body.replace(/^\n+/, "").trimEnd() + "\n";
}

/**
 * Compare skill markdown using goat-flow's drift semantics.
 *
 * Installed skill copies can reorder YAML keys or trim trailing whitespace
 * during setup; those edits are not functional drift, but body or frontmatter
 * value changes still are.
 *
 * @param expected - Template markdown content from `workflow/skills`.
 * @param existing - Installed markdown content from an agent or skill-reference tree.
 * @returns True when normalized frontmatter and body content match.
 */
export function skillContentsEquivalent(
  expected: string,
  existing: string,
): boolean {
  const expectedMarkdown = parseMarkdownFrontmatter(expected);
  const existingMarkdown = parseMarkdownFrontmatter(existing);
  if (
    !isDeepStrictEqual(
      expectedMarkdown.frontmatter,
      existingMarkdown.frontmatter,
    )
  ) {
    return false;
  }
  return (
    normalizeBody(expectedMarkdown.body) ===
    normalizeBody(existingMarkdown.body)
  );
}

/**
 * Runtime dependencies for `checkDrift`.
 *
 * The filesystem is rooted at the audited project, while `templateRoot` points
 * at goat-flow's package layout; separating them keeps consumer-project audits
 * from accidentally reading templates from the target project.
 */
interface CheckDriftOptions {
  /** ReadonlyFS rooted at the project being audited (for installed-copy reads). */
  fs: ReadonlyFS;
  /** Absolute path to the project being audited. Present for parity with other audit options; not currently used for IO. */
  projectPath: string;
  /**
   * Absolute path whose layout mirrors goat-flow's own root (must contain
   * workflow/skills/...). Defaults to the goat-flow package root resolved
   * at runtime so consumer projects work out of the box.
   */
  templateRoot?: string;
}

/**
 * Pair one canonical workflow file with its installed project copy.
 *
 * Shared references and playbooks are not per-skill directories, so the drift
 * audit keeps this explicit map in lockstep with the setup manifest.
 */
interface SharedFileSpec {
  /** Relative to templateRoot. */
  template: string;
  /** Relative to projectPath. */
  installed: string;
}

const SHARED_FILES: SharedFileSpec[] = [
  // Meta references (composed into every skill)
  {
    template: "workflow/skills/reference/README.md",
    installed: ".goat-flow/skill-reference/README.md",
  },
  {
    template: "workflow/skills/reference/skill-preamble.md",
    installed: ".goat-flow/skill-reference/skill-preamble.md",
  },
  {
    template: "workflow/skills/reference/skill-conventions.md",
    installed: ".goat-flow/skill-reference/skill-conventions.md",
  },
  // Standalone playbooks (loaded on-demand)
  {
    template: "workflow/skills/playbooks/README.md",
    installed: ".goat-flow/skill-playbooks/README.md",
  },
  {
    template: "workflow/skills/playbooks/browser-use.md",
    installed: ".goat-flow/skill-playbooks/browser-use.md",
  },
  {
    template: "workflow/skills/playbooks/code-comments.md",
    installed: ".goat-flow/skill-playbooks/code-comments.md",
  },
  {
    template: "workflow/skills/playbooks/gruff-code-quality.md",
    installed: ".goat-flow/skill-playbooks/gruff-code-quality.md",
  },
  {
    template: "workflow/skills/playbooks/observability.md",
    installed: ".goat-flow/skill-playbooks/observability.md",
  },
  {
    template: "workflow/skills/playbooks/changelog.md",
    installed: ".goat-flow/skill-playbooks/changelog.md",
  },
  {
    template: "workflow/skills/playbooks/page-capture.md",
    installed: ".goat-flow/skill-playbooks/page-capture.md",
  },
  {
    template: "workflow/skills/playbooks/release-notes.md",
    installed: ".goat-flow/skill-playbooks/release-notes.md",
  },
  {
    template: "workflow/skills/playbooks/skill-quality-testing.md",
    installed: ".goat-flow/skill-playbooks/skill-quality-testing.md",
  },
  {
    template:
      "workflow/skills/playbooks/skill-quality-testing/tdd-iteration.md",
    installed:
      ".goat-flow/skill-playbooks/skill-quality-testing/tdd-iteration.md",
  },
  {
    template:
      "workflow/skills/playbooks/skill-quality-testing/adversarial-framing.md",
    installed:
      ".goat-flow/skill-playbooks/skill-quality-testing/adversarial-framing.md",
  },
  {
    template: "workflow/skills/playbooks/skill-quality-testing/deployment.md",
    installed: ".goat-flow/skill-playbooks/skill-quality-testing/deployment.md",
  },
];

/**
 * Read a workflow template file relative to the package root.
 *
 * Missing or unreadable templates return null; this swallows file-read failures
 * so callers can report the exact drift finding path instead of turning one
 * filesystem failure into an exception that hides the rest of the audit.
 */
function readTemplate(templateRoot: string, relative: string): string | null {
  const abs = resolvePath(templateRoot, relative);
  if (!existsSync(abs)) return null;
  try {
    return readFileSync(abs, "utf-8");
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return (
    value !== null &&
    typeof value === "object" &&
    Array.isArray(value) === false
  );
}

function isAgentId(value: string): value is AgentId {
  return KNOWN_AGENT_IDS.has(value);
}

/** Read the configured list of deprecated skill names from the validated manifest. */
function getStaleSkillNames(): Set<string> {
  return new Set(loadManifest().facts.skills.stale_names);
}

/** Compare installed skills against their workflow templates for drift.
 *
 *  The manifest declares every supported agent's `skills_dir`, but a given
 *  consumer project may only have installed one agent (e.g. only `.claude/`).
 *  Iterating over absent agent roots reports phantom drift ("file missing")
 *  for every uninstalled tree. Filter to roots present on disk so single-
 *  agent installs report honest results. */
function compareSkills(
  fs: ReadonlyFS,
  templateRoot: string,
  findings: DriftFinding[],
): number {
  let checked = 0;
  const skillRoots = getInstalledSkillRoots().filter((dir) => fs.exists(dir));
  for (const name of SKILL_NAMES) {
    for (const relativeFile of getSkillFiles(name)) {
      const templateRel = `workflow/skills/${name}/${relativeFile}`;
      const template = readTemplate(templateRoot, templateRel);
      if (template === null) {
        findings.push({
          kind: "missing",
          path: templateRel,
          message: `${name}: manifest declares ${templateRel} but the workflow template is missing`,
        });
        continue;
      }

      for (const agentDir of skillRoots) {
        const installedRel = `${agentDir}/${name}/${relativeFile}`;
        checked++;
        if (!fs.exists(installedRel)) {
          findings.push({
            kind: "missing",
            path: installedRel,
            message: `${name}: template at ${templateRel} has no installed copy at ${installedRel}`,
          });
          continue;
        }
        const installed = fs.readFile(installedRel);
        if (installed === null) continue;
        if (!skillContentsEquivalent(template, installed)) {
          findings.push({
            kind: "content",
            path: installedRel,
            message: `${name}: template (${templateRel}) and installed copy (${installedRel}) differ`,
          });
        }
      }
    }
  }
  return checked;
}

/** Compare shared setup files against their workflow templates for drift. */
function compareSharedFiles(
  fs: ReadonlyFS,
  templateRoot: string,
  findings: DriftFinding[],
): number {
  let checked = 0;
  for (const spec of SHARED_FILES) {
    const template = readTemplate(templateRoot, spec.template);
    if (template === null) {
      findings.push({
        kind: "missing",
        path: spec.template,
        message: `shared template missing: ${spec.template}`,
      });
      continue;
    }
    checked++;
    if (!fs.exists(spec.installed)) {
      findings.push({
        kind: "missing",
        path: spec.installed,
        message: `${spec.template} has no installed copy at ${spec.installed}`,
      });
      continue;
    }
    const installed = fs.readFile(spec.installed);
    if (installed === null) continue;
    if (!skillContentsEquivalent(template, installed)) {
      findings.push({
        kind: "content",
        path: spec.installed,
        message: `${spec.template} and ${spec.installed} differ`,
      });
    }
  }
  return checked;
}

/**
 * Find installed skill directories that are no longer canonical.
 *
 * This branch-heavy scan exists because agent skill roots can contain editor
 * files, docs, or partially-created directories. The SKILL.md guard avoids
 * false positives. The function reports deprecated manifest names separately
 * from unexpected orphans so cleanup messaging stays actionable.
 */
function findOrphans(fs: ReadonlyFS, findings: DriftFinding[]): void {
  const canonical = new Set<string>(SKILL_NAMES);
  const stale = getStaleSkillNames();
  for (const agentDir of getInstalledSkillRoots()) {
    if (!fs.exists(agentDir)) continue;
    for (const entry of fs.listDir(agentDir)) {
      if (canonical.has(entry)) continue;
      const fullPath = `${agentDir}/${entry}`;
      // Only flag real skill directories. listDir returns files too
      // (.DS_Store, README.md, etc.); a skill is identified by SKILL.md.
      if (!fs.exists(`${fullPath}/SKILL.md`)) continue;
      if (stale.has(entry)) {
        findings.push({
          kind: "deprecated",
          path: fullPath,
          message: `deprecated skill still installed: ${entry} at ${fullPath}`,
        });
      } else {
        findings.push({
          kind: "orphan",
          path: fullPath,
          message: `orphan directory in ${agentDir}: ${entry} (not a canonical goat-flow skill)`,
        });
      }
    }
  }
}

/** Compare installed hook scripts against their workflow templates. */
function hookTemplateRel(
  agentId: string,
  agent: AgentProfile,
  hookFile: string,
): string {
  const hookConfigName = agent.hook_config_file
    ? pathPosix.basename(agent.hook_config_file)
    : null;
  if (hookConfigName && hookFile === hookConfigName) {
    return pathPosix.join(
      "workflow/hooks/agent-config",
      `${agentId}-hooks.json`,
    );
  }
  return pathPosix.join("workflow/hooks", hookFile);
}

/** Compare installed hook scripts against their workflow templates. */
function hookEventKey(agentId: AgentId, spec: HookSpec): string {
  if (agentId === "copilot") {
    return spec.event === "PreToolUse" ? "preToolUse" : "postToolUse";
  }
  return spec.event;
}

function hookCommandPath(agent: AgentProfile, script: string): string {
  if (!agent.hooks_dir) return script;
  return pathPosix.join(agent.hooks_dir, script);
}

function copilotHookEntry(agent: AgentProfile, spec: HookSpec): object {
  const path = hookCommandPath(agent, spec.primaryScript);
  return {
    type: "command",
    bash: path,
    powershell: `if (Get-Command bash -ErrorAction SilentlyContinue) { bash ${path} } else { Write-Output '{"permissionDecision":"deny","permissionDecisionReason":"Bash, Git Bash, or WSL is required to run ${path} on Windows."}' }`,
    timeoutSec: 30,
  };
}

function entryReferencesSpec(entry: unknown, spec: HookSpec): boolean {
  if (!isRecord(entry)) return false;
  const commands = [
    typeof entry.command === "string" ? entry.command : "",
    typeof entry.bash === "string" ? entry.bash : "",
    typeof entry.powershell === "string" ? entry.powershell : "",
  ].join("\n");
  if (spec.scriptFiles.some((script) => commands.includes(script))) {
    return true;
  }
  if (Array.isArray(entry.hooks)) {
    return entry.hooks.some((hook) => entryReferencesSpec(hook, spec));
  }
  return false;
}

function ensureHooksObject(
  config: Record<string, unknown>,
): Record<string, unknown> {
  const hooks = config.hooks;
  if (isRecord(hooks)) return hooks;
  const next: Record<string, unknown> = {};
  config.hooks = next;
  return next;
}

function ensureHookEntries(
  config: Record<string, unknown>,
  event: string,
): unknown[] {
  const hooks = ensureHooksObject(config);
  const entries = hooks[event];
  if (Array.isArray(entries)) return entries;
  const next: unknown[] = [];
  hooks[event] = next;
  return next;
}

function readExplicitHooks(fs: ReadonlyFS): Record<string, unknown> | null {
  const config = fs.readFile(".goat-flow/config.yaml");
  if (config === null) return null;
  let parsed: unknown;
  try {
    parsed = load(config) ?? {};
  } catch {
    return null;
  }
  if (!isRecord(parsed) || !isRecord(parsed.hooks)) return null;
  return parsed.hooks;
}

function enabledFromHookConfig(value: unknown): boolean | null {
  if (!isRecord(value) || typeof value.enabled !== "boolean") return null;
  return value.enabled;
}

function explicitHookEnabled(fs: ReadonlyFS, hookId: string): boolean | null {
  const hooks = readExplicitHooks(fs);
  if (hooks === null) return null;
  const explicit = enabledFromHookConfig(hooks[hookId]);
  if (explicit !== null) return explicit;
  if (hookId !== "gruff-code-quality") return null;
  return enabledFromHookConfig(hooks["gruff-on-change"]);
}

function hooksObject(config: Record<string, unknown>): Record<string, unknown> {
  return ensureHooksObject(config);
}

function deleteHookEventIfEmpty(
  config: Record<string, unknown>,
  event: string,
): void {
  const hooks = hooksObject(config);
  if (Array.isArray(hooks[event]) && hooks[event].length === 0) {
    Reflect.deleteProperty(hooks, event);
  }
}

function removeHookEntries(
  config: Record<string, unknown>,
  event: string,
  spec: HookSpec,
): void {
  const entries = ensureHookEntries(config, event);
  const next = entries.filter((entry) => !entryReferencesSpec(entry, spec));
  const hooks = hooksObject(config);
  if (next.length === 0) {
    Reflect.deleteProperty(hooks, event);
    return;
  }
  hooks[event] = next;
}

/**
 * Copilot keeps hook registrations in `.github/hooks/hooks.json`, which is
 * also the manifest-declared installed hook artifact. The static template only
 * represents default guardrails; dashboard/CLI toggles can add optional hooks.
 * Drift therefore compares against template plus desired toggle state.
 */
function expectedHookConfig(
  fs: ReadonlyFS,
  agentId: string,
  agent: AgentProfile,
  template: string,
): string {
  if (agentId !== "copilot" || !isAgentId(agentId)) return template;

  let config: unknown;
  try {
    config = JSON.parse(template);
  } catch {
    return template;
  }
  if (!isRecord(config)) return template;

  let changed = false;
  for (const spec of listHookSpecs()) {
    const enabled = explicitHookEnabled(fs, spec.id);
    if (enabled === null) continue;
    changed = true;
    const event = hookEventKey(agentId, spec);
    removeHookEntries(config, event, spec);
    if (!enabled) {
      deleteHookEventIfEmpty(config, event);
      continue;
    }
    ensureHookEntries(config, event).push(copilotHookEntry(agent, spec));
  }

  if (!changed) return template;
  return `${JSON.stringify(config, null, 2)}\n`;
}

/** Compare installed hook scripts against their workflow templates. */
function compareHooks(
  fs: ReadonlyFS,
  templateRoot: string,
  findings: DriftFinding[],
): number {
  let checked = 0;
  const manifest = loadManifest();
  for (const [agentId, agent] of Object.entries(manifest.agents)) {
    if (!agent.hooks_dir || !agent.hooks) continue;
    if (!fs.exists(agent.hooks_dir)) continue;
    for (const hookFile of agent.hooks) {
      const templateRel = hookTemplateRel(agentId, agent, hookFile);
      const template = readTemplate(templateRoot, templateRel);
      const installedRel = pathPosix.join(agent.hooks_dir, hookFile);
      checked++;
      if (template === null) {
        findings.push({
          kind: "missing",
          path: templateRel,
          message: `declared hook ${installedRel} has no template at ${templateRel}`,
        });
        continue;
      }
      const expected = expectedHookConfig(fs, agentId, agent, template);
      if (!fs.exists(installedRel)) {
        findings.push({
          kind: "missing",
          path: installedRel,
          message: `hook template ${templateRel} has no installed copy at ${installedRel}`,
        });
        continue;
      }
      const installed = fs.readFile(installedRel);
      if (installed === null) continue;
      if (installed.trimEnd() !== expected.trimEnd()) {
        findings.push({
          kind: "content",
          path: installedRel,
          message: `hook template (${templateRel}) and installed copy (${installedRel}) differ`,
        });
      }
    }
  }
  return checked;
}

/**
 * Run all drift comparisons and return a consolidated report.
 *
 * @param options - Project filesystem plus optional goat-flow template root.
 * @returns Drift status, findings, and count of compared template/install pairs.
 */
export function checkDrift(options: CheckDriftOptions): DriftReport {
  const { fs } = options;
  const templateRoot = options.templateRoot ?? getTemplatePath("");
  const findings: DriftFinding[] = [];
  let checked = 0;
  checked += compareSkills(fs, templateRoot, findings);
  checked += compareSharedFiles(fs, templateRoot, findings);
  checked += compareHooks(fs, templateRoot, findings);
  findOrphans(fs, findings);
  return {
    status: findings.length === 0 ? "pass" : "fail",
    findings,
    checked,
  };
}
