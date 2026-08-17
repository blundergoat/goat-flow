/**
 * Adapter from the validated manifest to the audit-facing `ProjectStructure`.
 * Audit checks read this narrowed shape rather than the full manifest, so projecting it lives in one place; building from the validated manifest (not
 * raw JSON) is what keeps malformed shapes out of audit logic.
 */
import { loadManifest } from "../manifest/manifest.js";
import type { ProjectStructure } from "./types.js";

/**
 * Build the audit-facing `ProjectStructure` from the validated manifest.
 * Replaces the previous pass-through from raw JSON (`getProjectStructure()`), which allowed malformed shapes to leak into audit logic.
 * Skill name arrays are copied and each agent's optional fields (`hooks_dir`, `settings`, `hooks`) are included only when the manifest defines them.
 *
 * @returns the narrowed project structure - required files/dirs, canonical and stale skill names with
 *   references, and per-agent paths - that audit checks consume in place of the raw manifest
 */
export function buildProjectStructure(): ProjectStructure {
  const manifest = loadManifest();
  return {
    required_files: manifest.required_files,
    required_dirs: manifest.required_dirs,
    skills: {
      canonical: [...manifest.facts.skills.names],
      stale_names: [...manifest.facts.skills.stale_names],
      references: manifest.skills.references ?? {},
    },
    agents: Object.fromEntries(
      Object.entries(manifest.agents).map(([id, agent]) => [
        id,
        {
          instruction_file: agent.instruction_file,
          skills_dir: agent.skills_dir,
          ...(agent.hooks_dir !== undefined
            ? { hooks_dir: agent.hooks_dir }
            : {}),
          ...(agent.settings !== undefined ? { settings: agent.settings } : {}),
          ...(agent.hooks !== undefined ? { hooks: agent.hooks } : {}),
        },
      ]),
    ),
  };
}
