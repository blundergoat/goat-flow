/**
 * Provide the installation rules that audit checks compare with the user's project.
 *
 * The validated manifest owns required paths, supported agents, and canonical or retired skill names.
 * This narrower view keeps those shared rules consistent across setup, agent, and drift findings.
 */
import { loadManifest } from "../manifest/manifest.js";
import type { ProjectStructure } from "./types.js";

/**
 * Build the validated installation rules used to explain missing or outdated project files.
 * Copy skill-name lists and include optional agent settings only when the manifest defines them.
 *
 * @returns - required project paths, skill names and references, and agent paths; absent references become an empty map
 */
export function buildProjectStructure(): ProjectStructure {
  const manifest = loadManifest();
  return {
    required_files: manifest.required_files,
    required_dirs: manifest.required_dirs,
    skills: {
      canonical: [...manifest.facts.skills.names],
      stale_names: [...manifest.facts.skills.stale_names],
      // Without declared references, audit checks have no extra skill reference files to require.
      references: manifest.skills.references ?? {},
    },
    // Every supported agent keeps its own installation paths, including agents the current report may later filter out.
    agents: Object.fromEntries(
      Object.entries(manifest.agents).map(([agentId, agent]) => [
        agentId,
        {
          instruction_file: agent.instruction_file,
          skills_dir: agent.skills_dir,
          // An agent without a hooks directory must not acquire a directory requirement from this projection.
          ...(agent.hooks_dir !== undefined
            ? { hooks_dir: agent.hooks_dir }
            : {}),
          // Omitted settings leave this agent without a settings-file requirement.
          ...(agent.settings !== undefined ? { settings: agent.settings } : {}),
          // Only declared hook support is passed to checks that assess this agent's installation.
          ...(agent.hooks !== undefined ? { hooks: agent.hooks } : {}),
        },
      ]),
    ),
  };
}
