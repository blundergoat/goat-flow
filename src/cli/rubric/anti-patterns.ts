/**
 * Anti-pattern definitions for the scanner.
 * These deductions model harmful workflow smells that are easier to flag as penalties than as ordinary rubric checks.
 */
import type {
  AntiPatternDef,
  FactContext,
  AntiPatternResult,
} from "../types.js";
import { SKILL_VERSION } from "../constants.js";
import { getProjectStructure } from "../paths.js";

/** Regex matching backtick-wrapped project paths in instruction file content. */
const INSTRUCTION_PATH_PATTERN =
  /`((?:src|config|templates?|app|apps|lib|docs|scripts|setup|workflow|ai|\.claude|\.agents|\.github)\/[^`]+)`/g;

/** Find stale instruction refs using the ReadonlyFS abstraction. */
function findStaleInstructionRefs(ctx: FactContext): string[] {
  const content = ctx.agentFacts.instruction.content;
  if (!content) return [];

  const staleRefs: string[] = [];
  for (const match of content.matchAll(INSTRUCTION_PATH_PATTERN)) {
    const path = match[1];
    if (path === undefined || /[*?{}]/.test(path)) continue;
    const cleanPath = path.replace(/:[0-9]+(?:[-,][0-9]+)*$/, "");
    // Skip framework paths (workflow/) — these exist in the goat-flow repo
    // but not in user projects. They appear in CLAUDE.md as examples.
    if (cleanPath.startsWith("workflow/")) continue;
    if (!ctx.fs.exists(cleanPath)) staleRefs.push(cleanPath);
  }

  return staleRefs;
}

/**
 * Anti-Pattern Deductions (max -15)
 * Add deductions only for misleading or actively harmful states.
 */
export const antiPatterns: AntiPatternDef[] = [
  // === AP1-AP3: Instruction File Anti-Patterns ===
  {
    id: "AP1",
    name: "Instruction file over 150 lines",
    deduction: -3,
    confidence: "high",
    evaluate: (ctx: FactContext): AntiPatternResult => {
      const lines = ctx.agentFacts.instruction.lineCount;
      const triggered = lines > 150;
      return {
        id: "AP1",
        name: "Instruction file over 150 lines",
        triggered,
        deduction: triggered ? -3 : 0,
        confidence: "high",
        message: triggered
          ? `${lines} lines (hard limit: 150)`
          : `${lines} lines (OK)`,
        evidence: ctx.agentFacts.agent.instructionFile,
      };
    },
    recommendation:
      "Instruction files over 150 lines get truncated during context compaction, causing agents to lose critical rules mid-session. The agent may start following the execution loop, then after compaction, forget VERIFY exists and ship unvalidated code. Compress below 150 lines to keep the full file in context.",
    recommendationKey: "ap-compress-instruction-file",
  },
  // AP2 removed - penalized project-specific skills (e.g., deploy/, preflight/) by assuming all skills need goat- prefix.
  // See .goat-flow/footguns/ "Scanner AP2 penalizes project-specific skills" (2026-04-01, RESOLVED).
  // AP3 (DoD in both instruction file and guidelines) removed - low confidence, DoD location is a style choice not a defect.
  // AP4 (Footguns without file:line evidence) removed - already covered by rubric check 2.3.4. Anti-pattern was double-penalizing.
  {
    id: "AP5",
    name: "settings.json invalid JSON",
    deduction: -5,
    confidence: "high",
    na: (ctx) => ctx.agentFacts.agent.settingsFile === null,
    evaluate: (ctx: FactContext): AntiPatternResult => {
      if (ctx.agentFacts.settings.exists === false)
        return {
          id: "AP5",
          name: "settings.json invalid JSON",
          triggered: false,
          deduction: 0,
          confidence: "high",
          message: "No settings file",
        };
      const triggered = ctx.agentFacts.settings.valid === false;
      return {
        id: "AP5",
        name: "settings.json invalid JSON",
        triggered,
        deduction: triggered ? -5 : 0,
        confidence: "high",
        message: triggered
          ? "settings.json is invalid JSON"
          : "settings.json is valid",
        evidence: ctx.agentFacts.agent.settingsFile ?? undefined,
      };
    },
    recommendation:
      "Invalid settings.json means every hook registration, deny pattern, and permission rule is silently ignored -- the agent runs completely unprotected while you think enforcement is active. This is the highest-impact single point of failure in the entire workflow.",
    recommendationKey: "ap-fix-settings-json",
  },
  {
    id: "AP6",
    name: "Post-turn hook swallows failures",
    deduction: -5,
    confidence: "medium",
    evaluate: (ctx: FactContext): AntiPatternResult => {
      if (ctx.agentFacts.hooks.postTurnExists === false)
        return {
          id: "AP6",
          name: "Post-turn hook swallows failures",
          triggered: false,
          deduction: 0,
          confidence: "medium",
          message: "No post-turn hook",
        };
      const triggered = ctx.agentFacts.hooks.postTurnSwallowsFailures;
      return {
        id: "AP6",
        name: "Post-turn hook swallows failures",
        triggered,
        deduction: triggered ? -5 : 0,
        confidence: "medium",
        message: triggered
          ? "Post-turn hook uses || true on validation commands, so lint/typecheck failures are hidden"
          : "Post-turn hook does not swallow validation failures",
      };
    },
    recommendation:
      "Appending `|| true` to validation commands makes the hook always exit 0, silently hiding every lint, typecheck, and format failure. The agent thinks its code passes validation when it doesn't, and you only discover the breakage downstream. Remove `|| true` so failures propagate honestly.",
    recommendationKey: "ap-fix-hook-exit",
  },

  // === AP7-AP9: Local Files and Gitignore Anti-Patterns ===
  // AP7 (Local per-directory instruction file over 20 lines) removed - arbitrary line limit. AP1 already covers the main file.
  {
    id: "AP8",
    name: "Generic Ask First boundaries",
    deduction: -1,
    confidence: "medium",
    evaluate: (ctx: FactContext): AntiPatternResult => {
      const section = findSection(ctx, "ask first");
      if (section === null)
        return {
          id: "AP8",
          name: "Generic Ask First boundaries",
          triggered: false,
          deduction: 0,
          confidence: "medium",
          message: "No Ask First section",
        };
      // Known template text that indicates the boundaries were not customized
      const genericMarkers = [
        "auth, routing, deployment, API, DB",
        "Public API, dependencies, config",
        "Shared sourced files, CONFIGURATION",
      ];
      const triggered = genericMarkers.some((m) => section.includes(m));
      return {
        id: "AP8",
        name: "Generic Ask First boundaries",
        triggered,
        deduction: triggered ? -1 : 0,
        confidence: "medium",
        message: triggered
          ? "Ask First matches template text"
          : "Ask First appears project-specific",
      };
    },
    recommendation:
      "Template Ask First text like \"auth, routing, deployment, API, DB\" doesn't map to your actual repo structure, so agents can't tell when they've crossed a boundary. Replace with project-specific paths and domain terms (e.g., `src/auth/`, `.goat-flow/decisions/`) so boundary violations are detectable, not theoretical.",
    recommendationKey: "ap-fix-generic-ask-first",
  },
  {
    id: "AP9",
    name: "settings.local.json committed",
    deduction: -2,
    confidence: "high",
    na: (ctx) => ctx.agentFacts.agent.settingsFile === null,
    evaluate: (ctx: FactContext): AntiPatternResult => {
      if (ctx.facts.shared.gitignore.exists === false) {
        return {
          id: "AP9",
          name: "settings.local.json committed",
          triggered: true,
          deduction: -2,
          confidence: "high",
          message: "No .gitignore - settings.local.json is not protected",
        };
      }
      const triggered = ctx.facts.shared.gitignore.hasRequiredEntries === false;
      return {
        id: "AP9",
        name: "settings.local.json committed",
        triggered,
        deduction: triggered ? -2 : 0,
        confidence: "high",
        message: triggered
          ? "settings.local.json not in .gitignore"
          : "settings.local.json is gitignored",
      };
    },
    recommendation:
      "settings.local.json contains personal preferences (allow overrides, local paths) that differ per developer. Without a .gitignore entry, one developer's local settings get committed and override everyone else's, or worse, personal allow-list entries weaken shared deny rules for the whole team.",
    recommendationKey: "ap-gitignore-settings-local",
  },
  // AP10 removed - settings.local.json is a personal preference file, not a project quality signal.
  // AP11 (Empty learning loop scaffolding) removed - was already 0 deduction. Empty dirs are valid for new projects.
  {
    id: "AP12",
    name: "Stale file references in footguns.md",
    deduction: -3,
    confidence: "high",
    evaluate: (ctx: FactContext): AntiPatternResult => {
      const { staleRefs, totalRefs } = ctx.facts.shared.footguns;
      if (totalRefs === 0)
        return {
          id: "AP12",
          name: "Stale file references in footguns.md",
          triggered: false,
          deduction: 0,
          confidence: "high",
          message: "No file references to check",
        };
      const triggered = staleRefs.length > 0;
      return {
        id: "AP12",
        name: "Stale file references in footguns.md",
        triggered,
        deduction: triggered ? -3 : 0,
        confidence: "high",
        message: triggered
          ? `${staleRefs.length} stale refs: ${staleRefs.slice(0, 3).join(", ")}`
          : "All file references resolve",
        evidence: triggered ? staleRefs.join(", ") : undefined,
      };
    },
    recommendation:
      "Stale file:line references in footguns point agents at code that no longer exists, eroding trust in the entire learning loop. Agents either ignore all footgun entries (because some are wrong) or waste turns trying to find moved files. Update paths after renames or remove entries for deleted files.",
    recommendationKey: "ap-fix-stale-references",
  },
  // AP22 (Duplicate learning-loop surfaces) removed - duplicate surfaces are already caught by the canonical layout check in 2.3.5b (also now removed). Legacy cleanup is handled by the upgrade path.

  // === AP13-AP15: New anti-patterns (B3-B5) ===
  {
    id: "AP13",
    name: "Stale code references in instruction file",
    deduction: -3,
    confidence: "high",
    evaluate: (ctx: FactContext): AntiPatternResult => {
      const content = ctx.agentFacts.instruction.content;
      if (!content)
        return {
          id: "AP13",
          name: "Stale code references in instruction file",
          triggered: false,
          deduction: 0,
          confidence: "high",
          message: "No instruction file",
        };
      const stale = findStaleInstructionRefs(ctx);
      const triggered = stale.length > 0;
      return {
        id: "AP13",
        name: "Stale code references in instruction file",
        triggered,
        deduction: triggered ? -3 : 0,
        confidence: "high",
        message: triggered
          ? `${stale.length} stale code refs in ${ctx.agentFacts.agent.instructionFile}: ${stale.slice(0, 3).join(", ")}`
          : "All code references resolve",
        evidence: triggered ? stale.join(", ") : undefined,
      };
    },
    recommendation:
      "Stale code references in the instruction file send agents to files that no longer exist. The agent follows the path, hits a missing file, and either hallucinates its contents or loses confidence in the rest of the instruction file. Update all paths after renames and deletes so the instruction file remains a reliable map.",
    recommendationKey: "ap-fix-stale-instruction-refs",
  },
  {
    id: "AP14",
    name: "Duplicate skill directories",
    deduction: -2,
    confidence: "high",
    evaluate: (ctx: FactContext): AntiPatternResult => {
      // Flag duplicate installs where a legacy skill coexists with its goat-* counterpart.
      const installedDirs = ctx.agentFacts.skills.installedDirs;
      const goatSkills = installedDirs.filter((s) => s.startsWith("goat-"));
      const nonGoat = installedDirs.filter(
        (s) => !s.startsWith("goat-") && s !== "goat",
      );
      const duplicates = nonGoat.filter((s) =>
        goatSkills.includes(`goat-${s}`),
      );
      const triggered = duplicates.length > 0;
      return {
        id: "AP14",
        name: "Duplicate skill directories",
        triggered,
        deduction: triggered ? -2 : 0,
        confidence: "high",
        message: triggered
          ? `Duplicate skills: ${duplicates.map((s) => `${s}/ + goat-${s}/`).join(", ")}`
          : "No duplicate skills",
      };
    },
    recommendation:
      "Duplicate skill directories (e.g., both `plan/` and `goat-plan/`) confuse the dispatcher -- it may route to the legacy version with outdated instructions while the updated version sits unused. Remove the non-goat-prefixed duplicate so there's exactly one copy of each skill.",
    recommendationKey: "ap-fix-duplicate-skills",
  },
  {
    id: "AP15",
    name: "Outdated skill versions",
    deduction: -6,
    confidence: "high",
    evaluate: (ctx: FactContext): AntiPatternResult => {
      const { found, outdatedCount, versions } = ctx.agentFacts.skills;
      if (found.length === 0)
        return {
          id: "AP15",
          name: "Outdated skill versions",
          triggered: false,
          deduction: 0,
          confidence: "high",
          message: "No skills to check",
        };
      const triggered = outdatedCount > 0;
      const outdatedNames = found.filter(
        (s) => versions[s] === null || versions[s] !== SKILL_VERSION,
      );
      /** Scale deduction: -2 per outdated skill, capped at -6 */
      const scaledDeduction = Math.max(-6, -2 * outdatedCount);
      return {
        id: "AP15",
        name: "Outdated skill versions",
        triggered,
        deduction: triggered ? scaledDeduction : 0,
        confidence: "high",
        message: triggered
          ? `${outdatedCount}/${found.length} skills are outdated (expected version ${SKILL_VERSION}): ${outdatedNames.slice(0, 5).join(", ")}`
          : `All ${found.length} skills at version ${SKILL_VERSION}`,
        evidence: triggered ? outdatedNames.join(", ") : undefined,
      };
    },
    recommendation: `Outdated skills are missing improvements, bug fixes, and structural changes from the current version. Agents using old skill versions may follow deprecated workflows, produce incompatible output formats, or skip newly added safety gates. Update to version ${SKILL_VERSION} by re-running setup or updating the frontmatter.`,
    recommendationKey: "ap-fix-outdated-skills",
  },
  // AP17 (Dangling file references in skills) removed - low confidence heuristic with too many false positives from template/example paths.
  // AP18 (Unanswered ADAPT comments in skills) removed - ADAPT comments were removed from skill templates in M08.
  {
    id: "AP19",
    name: "Hardcoded absolute paths in hooks",
    deduction: -2,
    confidence: "high",
    evaluate: (ctx: FactContext): AntiPatternResult => {
      const { absolutePathHooks } = ctx.agentFacts.hooks;
      const triggered = absolutePathHooks.length > 0;
      return {
        id: "AP19",
        name: "Hardcoded absolute paths in hooks",
        triggered,
        deduction: triggered ? -2 : 0,
        confidence: "high",
        message: triggered
          ? `${absolutePathHooks.length} hook(s) with hardcoded absolute paths: ${absolutePathHooks.join(", ")}. Use $(git rev-parse --show-toplevel) instead.`
          : "All hooks use portable paths",
      };
    },
    recommendation:
      "Hardcoded absolute paths in hooks (e.g., /home/user/project/) break when the repo is cloned to a different location, checked out by CI, or used by another developer. Replace with $(git rev-parse --show-toplevel) so hooks work portably across machines and environments.",
    recommendationKey: "ap-fix-hook-paths",
  },
  // === AP20: Non-canonical goat-flow skill directories ===
  {
    id: "AP20",
    name: "Non-canonical goat-flow skill directories",
    deduction: -3,
    confidence: "high",
    evaluate: (ctx: FactContext): AntiPatternResult => {
      // Dynamic: read canonical list from project-structure.json instead of hardcoding
      const structure = getProjectStructure();
      const skills = structure.skills as
        | { canonical?: string[]; stale_generic?: string[] }
        | undefined;
      const canonicalList: string[] = skills?.canonical ?? [];
      const staleGenericList: string[] = skills?.stale_generic ?? [];
      const canonicalSet = new Set<string>(canonicalList);
      // Any goat-prefixed skill directory NOT in the canonical list is non-canonical
      const nonCanonical = ctx.agentFacts.skills.installedDirs.filter(
        (s) => (s.startsWith("goat-") || s === "goat") && !canonicalSet.has(s),
      );
      // Also flag known stale generic skill names from project-structure.json
      const staleGenericSet = new Set<string>(staleGenericList);
      const legacyFound = ctx.agentFacts.skills.installedDirs.filter((s) =>
        staleGenericSet.has(s),
      );
      const allStale = [...new Set([...nonCanonical, ...legacyFound])].sort();
      const triggered = allStale.length > 0;
      return {
        id: "AP20",
        name: "Non-canonical goat-flow skill directories",
        triggered,
        deduction: triggered ? -3 : 0,
        confidence: "high",
        message: triggered
          ? `Found ${allStale.length} non-canonical skill dir(s): ${allStale.join(", ")}. These are likely from a previous goat-flow version and confuse agents.`
          : "All skill directories are canonical",
        evidence: triggered
          ? `Run \`goat-flow upgrade\` or manually delete: ${allStale.join(", ")}`
          : undefined,
      };
    },
    recommendation:
      "Non-canonical skill directories left from a previous goat-flow version confuse agents -- they may invoke stale workflows with outdated instructions, missing gates, or incompatible output formats. Remove them with `goat-flow upgrade` or delete manually so agents only find current, supported skills.",
    recommendationKey: "ap-remove-stale-skills",
  },
  // AP21 (Stale goat-flow-owned router entries) removed - marker system removed.
  // === AP23: Overly broad deny patterns ===
  {
    id: "AP23",
    name: "Overly broad deny patterns",
    deduction: -2,
    confidence: "medium",
    evaluate: (ctx: FactContext): AntiPatternResult => {
      const parsed = ctx.agentFacts.settings.parsed as Record<
        string,
        unknown
      > | null;
      const permissions = parsed?.permissions as
        | Record<string, unknown>
        | undefined;
      const rawDeny = permissions?.deny;
      const denyList = Array.isArray(rawDeny) ? (rawDeny as string[]) : [];
      if (denyList.length === 0)
        return {
          id: "AP23",
          name: "Overly broad deny patterns",
          triggered: false,
          deduction: 0,
          confidence: "medium",
          message: "No deny patterns configured",
        };
      const tooBroad = findBroadDenyPatterns(denyList);
      const triggered = tooBroad.length > 0;
      return {
        id: "AP23",
        name: "Overly broad deny patterns",
        triggered,
        deduction: triggered ? -2 : 0,
        confidence: "medium",
        message: triggered
          ? `${tooBroad.length} overly broad deny pattern(s): ${tooBroad.join(", ")}. These block legitimate commands. Use specific patterns like Bash(*git push*) instead of Bash(*git*).`
          : "Deny patterns are specific enough",
        evidence: triggered ? tooBroad.join(", ") : undefined,
      };
    },
    recommendation:
      "Overly broad deny patterns like Bash(*git*) block legitimate commands (git status, git diff, git log) alongside dangerous ones, forcing agents to work without version control visibility. Use specific patterns like Bash(*git push*) and Bash(*git commit*) so only destructive commands are blocked while safe read-only commands still work.",
    recommendationKey: "ap-fix-broad-deny-patterns",
  },
];

/** Return deny patterns that block common substrings too aggressively. */
function findBroadDenyPatterns(denyList: string[]): string[] {
  const tooBroad: string[] = [];
  for (const p of denyList) {
    // Bash(*git*) blocks anything mentioning "git" - too broad
    if (/^Bash\(\*git\*\)$/i.test(p)) tooBroad.push(p);
    // Bash(*test*) blocks all test commands
    if (/^Bash\(\*test\*\)$/i.test(p)) tooBroad.push(p);
    // Bash(*run*) blocks npm run, cargo run, etc.
    if (/^Bash\(\*run\*\)$/i.test(p)) tooBroad.push(p);
  }
  return tooBroad;
}

/**
 * Search the instruction file sections for a heading containing the given name.
 * Returns the section body text, or null if no matching heading is found.
 */
function findSection(ctx: FactContext, name: string): string | null {
  // Iterate over all parsed section headings in the instruction file
  for (const [heading, content] of ctx.agentFacts.instruction.sections) {
    if (heading.includes(name.toLowerCase())) return content;
  }
  return null;
}
