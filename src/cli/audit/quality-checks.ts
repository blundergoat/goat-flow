/**
 * Quality checks for `goat-flow audit --quality`.
 * Grouped by the 5 harness concerns: context, constraints, verification, recovery, feedback_loop.
 * Quality checks are advisory - they produce scores and findings but never affect exit code.
 */
import type { QualityCheck, QualityCheckResult } from "./types.js";

function pass(findings: string[]): QualityCheckResult {
  return { score: 100, findings, recommendations: [] };
}

function partial(
  score: number,
  findings: string[],
  recommendations: string[],
  howToFix?: string[],
): QualityCheckResult {
  return { score, findings, recommendations, howToFix };
}

function fail(
  findings: string[],
  recommendations: string[],
  howToFix?: string[],
): QualityCheckResult {
  return { score: 0, findings, recommendations, howToFix };
}

// === Context concern ===

const instructionLineCount: QualityCheck = {
  id: "instruction-line-count",
  concern: "context",
  weight: 2,
  run: (ctx) => {
    for (const af of ctx.agents) {
      if (!af.instruction.exists) {
        return fail(
          [`${af.agent.id}: no instruction file`],
          ["Create instruction file for each configured agent"],
          [`Create ${af.agent.instructionFile} by running \`goat-flow setup\`.`],
        );
      }
      const lines = af.instruction.lineCount;
      const target = ctx.config.config.lineLimits.target;
      const limit = ctx.config.config.lineLimits.limit;
      if (lines > limit) {
        return partial(
          30,
          [`${af.agent.id}: ${lines} lines (exceeds hard limit ${limit})`],
          [`Reduce instruction file to under ${target} lines`],
          [`Trim ${af.agent.instructionFile} to under ${target} lines. Move detailed reference material to .goat-flow/architecture.md.`],
        );
      }
      if (lines > target) {
        return partial(
          70,
          [`${af.agent.id}: ${lines} lines (over target ${target}, under limit ${limit})`],
          [`Consider trimming to target ${target} lines`],
          [`Trim ${af.agent.instructionFile} by moving verbose sections to .goat-flow/ reference files.`],
        );
      }
      return pass([`${af.agent.id}: ${lines} lines (under target ${target})`]);
    }
    return pass(["No agents to check"]);
  },
};

const routerTableResolves: QualityCheck = {
  id: "router-table-resolves",
  concern: "context",
  weight: 2,
  run: (ctx) => {
    const findings: string[] = [];
    const recs: string[] = [];
    let totalPaths = 0;
    let resolved = 0;
    for (const af of ctx.agents) {
      totalPaths += af.router.paths.length;
      resolved += af.router.resolved;
      if (af.router.unresolved.length > 0) {
        findings.push(
          `${af.agent.id}: ${af.router.unresolved.length} dead router paths`,
        );
      }
    }
    if (totalPaths === 0) {
      return partial(50, ["No router table found"], ["Add a Router Table section to instruction file"], ["Add a Router Table section to the instruction file mapping resource names to file paths."]);
    }
    if (findings.length > 0) {
      recs.push("Fix dead router table paths so agents can navigate the codebase");
      const score = totalPaths > 0 ? Math.round((resolved / totalPaths) * 100) : 0;
      return partial(score, findings, recs, ["Update or remove dead paths in the instruction file's Router Table section."]);
    }
    return pass([`All ${totalPaths} router table paths resolve`]);
  },
};

const footgunEvidenceResolves: QualityCheck = {
  id: "footgun-evidence",
  concern: "context",
  weight: 1,
  run: (ctx) => {
    const { footguns } = ctx.facts.shared;
    if (!footguns.exists || footguns.entryCount === 0) {
      return partial(50, ["No footgun entries"], ["Log footguns as they are discovered"], ["Add entries to .goat-flow/footguns/ bucket files as architectural traps are discovered."]);
    }
    if (footguns.staleRefs.length > 0) {
      return partial(
        60,
        [`${footguns.staleRefs.length} stale file:line references in footguns`],
        ["Update stale footgun references to current file:line locations"],
        ["Update stale file:line references in .goat-flow/footguns/ to match current source locations."],
      );
    }
    return pass([`${footguns.entryCount} footgun entries with valid evidence`]);
  },
};

const architectureExists: QualityCheck = {
  id: "architecture-exists",
  concern: "context",
  weight: 1,
  run: (ctx) => {
    if (!ctx.facts.shared.architecture.exists) {
      return fail(
        ["architecture.md does not exist"],
        ["Create .goat-flow/architecture.md describing the project structure"],
        ["Create .goat-flow/architecture.md with the project's key modules, dependencies, and data flow."],
      );
    }
    const lines = ctx.facts.shared.architecture.lineCount;
    if (lines < 10) {
      return partial(
        40,
        [`architecture.md is only ${lines} lines`],
        ["Expand architecture.md with real project structure details"],
        ["Expand .goat-flow/architecture.md with module descriptions, entry points, and key patterns."],
      );
    }
    return pass([`architecture.md exists (${lines} lines)`]);
  },
};

// === Constraints concern ===

const denyCoversSecrets: QualityCheck = {
  id: "deny-covers-secrets",
  concern: "constraints",
  weight: 2,
  run: (ctx) => {
    const covered: string[] = [];
    const uncovered: string[] = [];
    for (const af of ctx.agents) {
      if (af.hooks.readDenyCoversSecrets) {
        covered.push(af.agent.id);
      } else {
        uncovered.push(af.agent.id);
      }
    }
    if (covered.length === 0) {
      return partial(
        30,
        ["Deny patterns do not cover secret file reads"],
        ["Add deny patterns for .env, credentials, and key files"],
        ["Add deny patterns for .env, .credentials, *.key, and *.pem files in the agent's deny configuration."],
      );
    }
    if (uncovered.length > 0) {
      return partial(
        60,
        [
          `${covered.join(", ")}: deny patterns cover secrets`,
          `${uncovered.join(", ")}: deny patterns missing secret file coverage`,
        ],
        [`Add deny patterns for .env, credentials, and key files to ${uncovered.join(", ")}`],
        [`Add deny patterns for .env, .credentials, *.key, and *.pem files to ${uncovered.join(", ")} agent configuration.`],
      );
    }
    return pass([`${covered.join(", ")}: deny patterns cover secrets`]);
  },
};

const denyBlocksDangerous: QualityCheck = {
  id: "deny-blocks-dangerous",
  concern: "constraints",
  weight: 2,
  run: (ctx) => {
    if (ctx.agents.length === 0) {
      return fail(["No agents to check"], ["Configure at least one agent"]);
    }
    const findings: string[] = [];
    const recs: string[] = [];
    const fixes: string[] = [];
    let allPass = true;
    for (const af of ctx.agents) {
      const { denyBlocksRmRf, denyBlocksForcePush, denyBlocksChmod } = af.hooks;
      if (denyBlocksRmRf && denyBlocksForcePush && denyBlocksChmod) {
        findings.push(`${af.agent.id}: deny blocks rm -rf, force-push, chmod`);
      } else {
        allPass = false;
        const missing: string[] = [];
        if (!denyBlocksRmRf) missing.push("rm -rf");
        if (!denyBlocksForcePush) missing.push("force-push");
        if (!denyBlocksChmod) missing.push("chmod");
        findings.push(`${af.agent.id}: deny missing coverage for ${missing.join(", ")}`);
        recs.push(`Add deny patterns for ${missing.join(", ")} to ${af.agent.id}`);
        fixes.push(`Add deny patterns for ${missing.join(", ")} in ${af.agent.id} agent configuration.`);
      }
    }
    if (allPass) {
      return pass(findings);
    }
    return partial(50, findings, recs, fixes);
  },
};

const askFirstBoundaries: QualityCheck = {
  id: "ask-first-boundaries",
  concern: "constraints",
  weight: 1,
  run: (ctx) => {
    const boundaries = ctx.config.config.askFirst;
    if (boundaries.length === 0) {
      return partial(
        40,
        ["No ask_first boundaries configured"],
        ["Add ask_first entries in config.yaml for high-risk paths"],
        ["Add ask_first entries in .goat-flow/config.yaml for high-risk paths like deployment configs and security files."],
      );
    }
    return pass([`${boundaries.length} ask_first boundaries configured`]);
  },
};

// === Verification concern ===

const testCommandRunnable: QualityCheck = {
  id: "test-command-configured",
  concern: "verification",
  weight: 3,
  run: (ctx) => {
    if (ctx.config.config.toolchain.test.length > 0) {
      return pass([`Test command configured: ${ctx.config.config.toolchain.test[0]}`]);
    }
    return fail(
      ["No test command configured"],
      ["Add toolchain.test to config.yaml"],
      ["Add `test:` to the toolchain section of .goat-flow/config.yaml with your test runner command."],
    );
  },
};

const hooksRegisteredAndPresent: QualityCheck = {
  id: "hooks-registered",
  concern: "verification",
  weight: 2,
  run: (ctx) => {
    const findings: string[] = [];
    const recs: string[] = [];
    const fixes: string[] = [];
    for (const af of ctx.agents) {
      if (af.hooks.postTurnRegistered && !af.hooks.postTurnExists) {
        findings.push(`${af.agent.id}: post-turn hook registered but file missing`);
        recs.push("Create the registered post-turn hook file");
        fixes.push(`Create the post-turn hook file at the path specified in ${af.agent.settingsFile}.`);
      }
      if (af.hooks.postTurnExists && !af.hooks.postTurnRegistered) {
        findings.push(`${af.agent.id}: post-turn hook file exists but not registered`);
        recs.push("Register the post-turn hook in agent settings");
        fixes.push(`Register the post-turn hook in ${af.agent.settingsFile}.`);
      }
    }
    if (findings.length > 0) {
      return partial(50, findings, recs, fixes);
    }
    return pass(["Hook registrations and files are in sync"]);
  },
};

const commitGuidanceExists: QualityCheck = {
  id: "commit-guidance",
  concern: "verification",
  weight: 1,
  run: (ctx) => {
    if (ctx.facts.shared.gitCommitInstructions.exists) {
      return pass(["Commit guidance found"]);
    }
    return partial(
      40,
      ["No commit guidance detected"],
      ["Add commit conventions to instruction file or .github/instructions/"],
      ["Add commit conventions to the instruction file or create .github/instructions/git-commit.md."],
    );
  },
};

// === Recovery concern ===

const milestoneFilesExist: QualityCheck = {
  id: "milestone-files",
  concern: "recovery",
  weight: 2,
  run: (ctx) => {
    const tasksDir = ".goat-flow/tasks";
    let files: string[];
    try {
      files = ctx.fs.listDir(tasksDir);
    } catch {
      return partial(
        30,
        ["No milestone/task files found"],
        ["Create milestone files in .goat-flow/tasks/ for work tracking"],
        ["Create milestone files in .goat-flow/tasks/ to track work and enable session recovery."],
      );
    }
    if (files.length === 0) {
      return partial(
        30,
        ["Tasks directory empty"],
        ["Create milestone files for current work"],
        ["Create milestone files in .goat-flow/tasks/ to track current work."],
      );
    }
    return pass([`${files.length} items in tasks directory`]);
  },
};

const sessionLogsExist: QualityCheck = {
  id: "session-logs",
  concern: "recovery",
  weight: 1,
  run: (ctx) => {
    const logsDir = ".goat-flow/logs/sessions";
    let files: string[];
    try {
      files = ctx.fs.listDir(logsDir);
    } catch {
      return partial(
        30,
        ["No session logs directory"],
        ["Log sessions to .goat-flow/logs/sessions/"],
        ["Create .goat-flow/logs/sessions/ and start logging sessions for continuity between conversations."],
      );
    }
    if (files.length === 0) {
      return partial(40, ["No session logs"], ["Start logging sessions"], ["Start logging sessions to .goat-flow/logs/sessions/ for work continuity."]);
    }
    return pass([`${files.length} session logs found`]);
  },
};

// === Feedback Loop concern ===

const footgunActivity: QualityCheck = {
  id: "footgun-activity",
  concern: "feedback_loop",
  weight: 2,
  run: (ctx) => {
    const count = ctx.facts.shared.footguns.entryCount;
    if (count === 0) {
      return partial(
        20,
        ["No footgun entries logged"],
        ["Start logging footguns as they are discovered"],
        ["Add entries to .goat-flow/footguns/ bucket files as architectural traps are discovered."],
      );
    }
    if (count < 3) {
      return partial(
        60,
        [`Only ${count} footgun entries - low activity`],
        ["Continue logging footguns to build institutional memory"],
        ["Add more entries to .goat-flow/footguns/ to build institutional memory."],
      );
    }
    return pass([`${count} footgun entries`]);
  },
};

const lessonActivity: QualityCheck = {
  id: "lesson-activity",
  concern: "feedback_loop",
  weight: 2,
  run: (ctx) => {
    const count = ctx.facts.shared.lessons.entryCount;
    if (count === 0) {
      return partial(
        20,
        ["No lesson entries logged"],
        ["Start logging lessons from behavioral mistakes"],
        ["Add entries to .goat-flow/lessons/ bucket files when behavioral mistakes are identified."],
      );
    }
    if (count < 3) {
      return partial(
        60,
        [`Only ${count} lesson entries - low activity`],
        ["Continue capturing lessons to prevent repeat mistakes"],
        ["Add more entries to .goat-flow/lessons/ to prevent repeat mistakes."],
      );
    }
    return pass([`${count} lesson entries`]);
  },
};

const decisionsTracked: QualityCheck = {
  id: "decisions-tracked",
  concern: "feedback_loop",
  weight: 1,
  run: (ctx) => {
    const { decisions } = ctx.facts.shared;
    if (!decisions.dirExists) {
      return partial(
        30,
        ["No decisions directory"],
        ["Create .goat-flow/decisions/ and log significant technical decisions"],
        ["Create .goat-flow/decisions/ and log significant technical decisions with context and rationale."],
      );
    }
    if (decisions.fileCount === 0) {
      return partial(
        40,
        ["Decisions directory empty"],
        ["Log architectural decisions with context and rationale"],
        ["Add decision records to .goat-flow/decisions/ with rationale and alternatives considered."],
      );
    }
    return pass([`${decisions.fileCount} decision records`]);
  },
};

/** All quality checks grouped by concern */
export const QUALITY_CHECKS: QualityCheck[] = [
  // context
  instructionLineCount,
  routerTableResolves,
  footgunEvidenceResolves,
  architectureExists,
  // constraints
  denyCoversSecrets,
  denyBlocksDangerous,
  askFirstBoundaries,
  // verification
  testCommandRunnable,
  hooksRegisteredAndPresent,
  commitGuidanceExists,
  // recovery
  milestoneFilesExist,
  sessionLogsExist,
  // feedback_loop
  footgunActivity,
  lessonActivity,
  decisionsTracked,
];
