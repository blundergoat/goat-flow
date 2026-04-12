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

// === Helpers ===

/** Extract YYYY-MM-DD dates from **Created:** lines in markdown content. */
function parseCreatedDates(content: string): Date[] {
  const pattern = /\*\*Created:\*\*\s*(\d{4}-\d{2}-\d{2})/g;
  const dates: Date[] = [];
  let m;
  while ((m = pattern.exec(content))) {
    const d = new Date(m[1] + "T00:00:00");
    if (!isNaN(d.getTime())) dates.push(d);
  }
  return dates;
}

/** Extract backtick-quoted file paths from markdown content. */
function extractBacktickPaths(content: string): string[] {
  const pattern = /`([^`]*\/[^`]+)`/g;
  const paths: string[] = [];
  let m;
  while ((m = pattern.exec(content))) {
    const p = m[1]!;
    // Skip URLs, globs, code fragments
    if (p.includes("://") || p.includes("*") || p.includes("(")) continue;
    // Skip paths that look like shell output or comments
    if (p.startsWith("/") || p.includes(" ")) continue;
    paths.push(p);
  }
  return paths;
}

// === Context concern ===

const instructionLineCount: QualityCheck = {
  id: "instruction-line-count",
  concern: "context",
  weight: 2,
  run: (ctx) => {
    const findings: string[] = [];
    const recs: string[] = [];
    const fixes: string[] = [];
    let worstScore = 100;
    for (const af of ctx.agents) {
      if (!af.instruction.exists) {
        findings.push(`${af.agent.id}: no instruction file`);
        recs.push(`Create ${af.agent.instructionFile}`);
        fixes.push(
          `Create ${af.agent.instructionFile} by running \`goat-flow setup\`.`,
        );
        worstScore = 0;
        continue;
      }
      const lines = af.instruction.lineCount;
      const target = ctx.config.config.lineLimits.target;
      const limit = ctx.config.config.lineLimits.limit;
      if (lines > limit) {
        findings.push(
          `${af.agent.id}: ${lines} lines (exceeds hard limit ${limit})`,
        );
        recs.push(
          `Reduce ${af.agent.instructionFile} to under ${target} lines`,
        );
        fixes.push(
          `Trim ${af.agent.instructionFile} to under ${target} lines. Move detailed reference material to .goat-flow/architecture.md.`,
        );
        worstScore = Math.min(worstScore, 30);
      } else if (lines > target) {
        findings.push(
          `${af.agent.id}: ${lines} lines (over target ${target}, under limit ${limit})`,
        );
        recs.push(
          `Consider trimming ${af.agent.instructionFile} to target ${target} lines`,
        );
        fixes.push(
          `Trim ${af.agent.instructionFile} by moving verbose sections to .goat-flow/ reference files.`,
        );
        worstScore = Math.min(worstScore, 70);
      } else {
        findings.push(
          `${af.agent.id}: ${lines} lines (under target ${target})`,
        );
      }
    }
    if (findings.length === 0) {
      return pass(["No agents to check"]);
    }
    if (worstScore === 100) {
      return pass(findings);
    }
    return partial(worstScore, findings, recs, fixes);
  },
};

const executionLoopPresent: QualityCheck = {
  id: "execution-loop-present",
  concern: "context",
  weight: 2,
  run: (ctx) => {
    const steps = ["read", "scope", "act", "verify"];
    const findings: string[] = [];
    const recs: string[] = [];
    let worstScore = 100;

    for (const af of ctx.agents) {
      if (!af.instruction.exists || !af.instruction.content) {
        findings.push(`${af.agent.id}: no instruction file to check`);
        worstScore = 0;
        continue;
      }
      const lower = af.instruction.content.toLowerCase();
      const found = steps.filter((s) => lower.includes(s));
      const missing = steps.filter((s) => !found.includes(s));

      if (missing.length === 0) {
        findings.push(`${af.agent.id}: execution loop has all 4 steps`);
      } else if (found.length >= 2) {
        findings.push(
          `${af.agent.id}: execution loop missing ${missing.join(", ")}`,
        );
        worstScore = Math.min(worstScore, 50);
      } else {
        findings.push(`${af.agent.id}: no execution loop detected`);
        recs.push(
          `Add a READ → SCOPE → ACT → VERIFY execution loop to ${af.agent.instructionFile}`,
        );
        worstScore = 0;
      }
    }
    if (worstScore === 100) return pass(findings);
    return partial(worstScore, findings, recs, [
      "Add an execution loop section with READ, SCOPE, ACT, VERIFY steps to the instruction file.",
    ]);
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
      return partial(
        50,
        ["No router table found"],
        ["Add a Router Table section to instruction file"],
        [
          "Add a Router Table section to the instruction file mapping resource names to file paths.",
        ],
      );
    }
    if (findings.length > 0) {
      recs.push(
        "Fix dead router table paths so agents can navigate the codebase",
      );
      const score =
        totalPaths > 0 ? Math.round((resolved / totalPaths) * 100) : 0;
      return partial(score, findings, recs, [
        "Update or remove dead paths in the instruction file's Router Table section.",
      ]);
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
      return partial(
        50,
        ["No footgun entries"],
        ["Log footguns as they are discovered"],
        [
          "Add entries to .goat-flow/footguns/ bucket files as architectural traps are discovered.",
        ],
      );
    }
    if (footguns.staleRefs.length > 0) {
      return partial(
        60,
        [`${footguns.staleRefs.length} stale file:line references in footguns`],
        ["Update stale footgun references to current file:line locations"],
        [
          "Update stale file:line references in .goat-flow/footguns/ to match current source locations.",
        ],
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
        [
          "Create .goat-flow/architecture.md with the project's key modules, dependencies, and data flow.",
        ],
      );
    }
    const lines = ctx.facts.shared.architecture.lineCount;
    if (lines < 10) {
      return partial(
        40,
        [`architecture.md is only ${lines} lines`],
        ["Expand architecture.md with real project structure details"],
        [
          "Expand .goat-flow/architecture.md with module descriptions, entry points, and key patterns.",
        ],
      );
    }
    return pass([`architecture.md exists (${lines} lines)`]);
  },
};

const architectureRefsResolve: QualityCheck = {
  id: "architecture-refs-resolve",
  concern: "context",
  weight: 1,
  run: (ctx) => {
    const content = ctx.fs.readFile(".goat-flow/architecture.md");
    if (!content) {
      return partial(
        0,
        ["architecture.md not found or empty"],
        ["Create .goat-flow/architecture.md"],
      );
    }
    const paths = extractBacktickPaths(content);
    if (paths.length === 0) {
      return partial(
        60,
        ["architecture.md has no file path references to validate"],
        [
          "Add backtick-quoted file paths to architecture.md so the audit can verify they exist",
        ],
      );
    }
    const unresolved = paths.filter((p) => !ctx.fs.exists(p));
    if (unresolved.length === 0) {
      return pass([
        `All ${paths.length} architecture.md path references resolve`,
      ]);
    }
    const score =
      Math.round(((paths.length - unresolved.length) / paths.length) * 100);
    return partial(
      score,
      [
        `${unresolved.length}/${paths.length} architecture.md paths are stale: ${unresolved.slice(0, 3).join(", ")}`,
      ],
      ["Update stale paths in architecture.md to match current file locations"],
      [
        "Update or remove dead paths in .goat-flow/architecture.md so the agent's map matches reality.",
      ],
    );
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
        [
          "Add deny patterns for .env, .credentials, *.key, and *.pem files in the agent's deny configuration.",
        ],
      );
    }
    if (uncovered.length > 0) {
      return partial(
        60,
        [
          `${covered.join(", ")}: deny patterns cover secrets`,
          `${uncovered.join(", ")}: deny patterns missing secret file coverage`,
        ],
        [
          `Add deny patterns for .env, credentials, and key files to ${uncovered.join(", ")}`,
        ],
        [
          `Add deny patterns for .env, .credentials, *.key, and *.pem files to ${uncovered.join(", ")} agent configuration.`,
        ],
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
        findings.push(
          `${af.agent.id}: deny missing coverage for ${missing.join(", ")}`,
        );
        recs.push(
          `Add deny patterns for ${missing.join(", ")} to ${af.agent.id}`,
        );
        fixes.push(
          `Add deny patterns for ${missing.join(", ")} in ${af.agent.id} agent configuration.`,
        );
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
        [
          "Add ask_first entries in .goat-flow/config.yaml for high-risk paths like deployment configs and security files.",
        ],
      );
    }
    return pass([`${boundaries.length} ask_first boundaries configured`]);
  },
};

const linterRegistered: QualityCheck = {
  id: "linter-registered",
  concern: "constraints",
  weight: 2,
  run: (ctx) => {
    const detected = ctx.facts.stack.signals.staticAnalysis;
    const lintCommands = ctx.config.config.toolchain.lint;

    if (detected.length === 0) {
      return partial(
        50,
        ["No static analysis tools detected in project manifests"],
        ["Install a linter (eslint, phpstan, ruff, etc.) and register it in config.yaml toolchain.lint"],
        [
          "Install a linter for your project and add it to toolchain.lint in .goat-flow/config.yaml.",
        ],
      );
    }
    if (lintCommands.length === 0) {
      return fail(
        [
          `${detected.map((t) => t.tool).join(", ")} detected but no lint command configured`,
        ],
        ["Register detected linters in config.yaml toolchain.lint"],
        [
          `Add toolchain.lint entries to .goat-flow/config.yaml for: ${detected.map((t) => t.tool).join(", ")}.`,
        ],
      );
    }
    // Check which detected tools appear in lint commands
    const lintJoined = lintCommands.join(" ").toLowerCase();
    const registered: string[] = [];
    const unregistered: string[] = [];
    for (const tool of detected) {
      if (lintJoined.includes(tool.tool.toLowerCase())) {
        registered.push(tool.tool);
      } else {
        unregistered.push(tool.tool);
      }
    }
    if (unregistered.length === 0) {
      return pass([
        `${registered.join(", ")} detected and registered in toolchain.lint`,
      ]);
    }
    const score = Math.round(
      (registered.length / detected.length) * 100,
    );
    return partial(
      Math.max(score, 30),
      [
        `${unregistered.join(", ")} installed but not in toolchain.lint`,
      ],
      [
        `Add ${unregistered.join(", ")} to toolchain.lint in config.yaml`,
      ],
      [
        `Add lint commands for ${unregistered.join(", ")} to the toolchain.lint array in .goat-flow/config.yaml.`,
      ],
    );
  },
};

const denyBlocksPipeToShell: QualityCheck = {
  id: "deny-blocks-pipe-to-shell",
  concern: "constraints",
  weight: 1,
  run: (ctx) => {
    const covered: string[] = [];
    const uncovered: string[] = [];
    for (const af of ctx.agents) {
      if (af.hooks.denyBlocksPipeToShell) {
        covered.push(af.agent.id);
      } else {
        uncovered.push(af.agent.id);
      }
    }
    if (uncovered.length === 0) {
      return pass([`${covered.join(", ")}: deny blocks pipe-to-shell (curl | bash)`]);
    }
    if (covered.length === 0) {
      return partial(
        30,
        ["No agents block pipe-to-shell pattern (curl | bash)"],
        ["Add deny pattern for pipe-to-shell commands"],
        [
          "Add a deny pattern matching curl|bash and wget|sh in agent deny configuration.",
        ],
      );
    }
    return partial(
      60,
      [
        `${uncovered.join(", ")}: pipe-to-shell not blocked`,
      ],
      [
        `Add pipe-to-shell deny pattern to ${uncovered.join(", ")}`,
      ],
      [
        `Add deny patterns for curl|bash and wget|sh to ${uncovered.join(", ")} agent configuration.`,
      ],
    );
  },
};

// === Verification concern ===

const testCommandRunnable: QualityCheck = {
  id: "test-command-configured",
  concern: "verification",
  weight: 3,
  run: (ctx) => {
    if (ctx.config.config.toolchain.test.length > 0) {
      return pass([
        `Test command configured: ${ctx.config.config.toolchain.test[0]}`,
      ]);
    }
    return fail(
      ["No test command configured"],
      ["Add toolchain.test to config.yaml"],
      [
        "Add `test:` to the toolchain section of .goat-flow/config.yaml with your test runner command.",
      ],
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
        findings.push(
          `${af.agent.id}: post-turn hook registered but file missing`,
        );
        recs.push("Create the registered post-turn hook file");
        fixes.push(
          `Create the post-turn hook file at the path specified in ${af.agent.settingsFile}.`,
        );
      }
      if (af.hooks.postTurnExists && !af.hooks.postTurnRegistered) {
        findings.push(
          `${af.agent.id}: post-turn hook file exists but not registered`,
        );
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
      [
        "Add commit conventions to the instruction file or create .github/instructions/git-commit.md.",
      ],
    );
  },
};

const hookHasValidation: QualityCheck = {
  id: "hook-has-validation",
  concern: "verification",
  weight: 2,
  run: (ctx) => {
    const findings: string[] = [];
    const recs: string[] = [];
    let allGood = true;
    let anyHook = false;

    for (const af of ctx.agents) {
      if (!af.hooks.postTurnExists) continue;
      anyHook = true;
      if (af.hooks.postTurnHasValidation) {
        findings.push(
          `${af.agent.id}: post-turn hook runs validation`,
        );
      } else {
        findings.push(
          `${af.agent.id}: post-turn hook has no validation logic`,
        );
        recs.push(
          `Add validation commands (lint, typecheck, shellcheck) to ${af.agent.id} post-turn hook`,
        );
        allGood = false;
      }
    }
    if (!anyHook) {
      return partial(
        30,
        ["No post-turn hooks found to evaluate"],
        ["Create a post-turn hook that runs validation after each agent action"],
        [
          "Create a post-turn hook script that runs linting, typechecking, or other validation.",
        ],
      );
    }
    if (allGood) return pass(findings);
    return partial(40, findings, recs, [
      "Add validation commands (eslint, tsc, shellcheck) to the post-turn hook script.",
    ]);
  },
};

const hookHonestFailures: QualityCheck = {
  id: "hook-honest-failures",
  concern: "verification",
  weight: 2,
  run: (ctx) => {
    const findings: string[] = [];
    const recs: string[] = [];
    let allGood = true;
    let anyHook = false;

    for (const af of ctx.agents) {
      if (!af.hooks.postTurnExists) continue;
      anyHook = true;
      if (af.hooks.postTurnSwallowsFailures) {
        findings.push(
          `${af.agent.id}: post-turn hook swallows failures (|| true)`,
        );
        recs.push(
          `Remove || true from ${af.agent.id} post-turn hook so failures surface`,
        );
        allGood = false;
      } else {
        findings.push(
          `${af.agent.id}: post-turn hook reports failures honestly`,
        );
      }
    }
    if (!anyHook) {
      return partial(
        50,
        ["No post-turn hooks found to evaluate"],
        ["Create a post-turn hook with honest failure reporting"],
      );
    }
    if (allGood) return pass(findings);
    return partial(20, findings, recs, [
      "Remove || true and similar failure-swallowing patterns from hook scripts. Silent on success, loud on failure.",
    ]);
  },
};

const lintCommandConfigured: QualityCheck = {
  id: "lint-command-configured",
  concern: "verification",
  weight: 1,
  run: (ctx) => {
    if (ctx.config.config.toolchain.lint.length > 0) {
      return pass([
        `Lint command configured: ${ctx.config.config.toolchain.lint[0]}`,
      ]);
    }
    return fail(
      ["No lint command configured"],
      ["Add toolchain.lint to config.yaml"],
      [
        "Add `lint:` to the toolchain section of .goat-flow/config.yaml with your linter command.",
      ],
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
        [
          "Create milestone files in .goat-flow/tasks/ to track work and enable session recovery.",
        ],
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
        [
          "Create .goat-flow/logs/sessions/ and start logging sessions for continuity between conversations.",
        ],
      );
    }
    if (files.length === 0) {
      return partial(
        40,
        ["No session logs"],
        ["Start logging sessions"],
        [
          "Start logging sessions to .goat-flow/logs/sessions/ for work continuity.",
        ],
      );
    }
    return pass([`${files.length} session logs found`]);
  },
};

const compactionHookPresent: QualityCheck = {
  id: "compaction-hook",
  concern: "recovery",
  weight: 1,
  run: (ctx) => {
    const covered: string[] = [];
    const uncovered: string[] = [];
    for (const af of ctx.agents) {
      if (af.hooks.compactionHookExists) {
        covered.push(af.agent.id);
      } else {
        uncovered.push(af.agent.id);
      }
    }
    if (uncovered.length === 0) {
      return pass([
        `${covered.join(", ")}: compaction hook registered`,
      ]);
    }
    if (covered.length === 0) {
      return partial(
        30,
        ["No compaction hooks registered"],
        [
          "Add a compaction hook that re-injects current task context after window compression",
        ],
        [
          "Create a compaction hook that outputs the current milestone file and key constraints after context compaction.",
        ],
      );
    }
    return partial(
      60,
      [`${uncovered.join(", ")}: no compaction hook registered`],
      [`Add compaction hook for ${uncovered.join(", ")}`],
      [
        `Register a compaction hook for ${uncovered.join(", ")} that re-injects task state after context compression.`,
      ],
    );
  },
};

const milestoneHasCheckboxes: QualityCheck = {
  id: "milestone-has-checkboxes",
  concern: "recovery",
  weight: 2,
  run: (ctx) => {
    const tasksDir = ".goat-flow/tasks";
    let files: string[];
    try {
      files = ctx.fs.listDir(tasksDir);
    } catch {
      return partial(
        20,
        ["No tasks directory found"],
        ["Create milestone files with checkbox items in .goat-flow/tasks/"],
        [
          "Create milestone files in .goat-flow/tasks/ with - [ ] checkbox items for trackable progress.",
        ],
      );
    }

    // Collect all markdown files, including from subdirectories
    const mdFiles: string[] = [];
    for (const entry of files) {
      const entryPath = `${tasksDir}/${entry}`;
      if (entry.endsWith(".md")) {
        mdFiles.push(entryPath);
      } else {
        // Check subdirectories
        try {
          const subFiles = ctx.fs.listDir(entryPath);
          for (const sf of subFiles) {
            if (sf.endsWith(".md")) {
              mdFiles.push(`${entryPath}/${sf}`);
            }
          }
        } catch {
          // Not a directory, skip
        }
      }
    }

    if (mdFiles.length === 0) {
      return partial(
        20,
        ["No milestone files found in tasks directory"],
        ["Create milestone files with checkbox items"],
        [
          "Create milestone .md files in .goat-flow/tasks/ with - [ ] checkbox items.",
        ],
      );
    }

    const checkboxPattern = /- \[[ x]\]/;
    let withCheckboxes = 0;
    for (const f of mdFiles) {
      const content = ctx.fs.readFile(f);
      if (content && checkboxPattern.test(content)) {
        withCheckboxes++;
      }
    }

    if (withCheckboxes === 0) {
      return partial(
        40,
        [`${mdFiles.length} milestone files but none have checkbox items`],
        ["Add - [ ] checkbox items to milestone files for trackable progress"],
        [
          "Add - [ ] checkbox items to milestone files so agents can track and checkpoint progress.",
        ],
      );
    }
    return pass([
      `${withCheckboxes}/${mdFiles.length} milestone files have trackable checkbox items`,
    ]);
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
        [
          "Add entries to .goat-flow/footguns/ bucket files as architectural traps are discovered.",
        ],
      );
    }
    if (count < 3) {
      return partial(
        60,
        [`Only ${count} footgun entries - low activity`],
        ["Continue logging footguns to build institutional memory"],
        [
          "Add more entries to .goat-flow/footguns/ to build institutional memory.",
        ],
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
        [
          "Add entries to .goat-flow/lessons/ bucket files when behavioral mistakes are identified.",
        ],
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
        [
          "Create .goat-flow/decisions/ and log significant technical decisions",
        ],
        [
          "Create .goat-flow/decisions/ and log significant technical decisions with context and rationale.",
        ],
      );
    }
    if (decisions.fileCount === 0) {
      return partial(
        40,
        ["Decisions directory empty"],
        ["Log architectural decisions with context and rationale"],
        [
          "Add decision records to .goat-flow/decisions/ with rationale and alternatives considered.",
        ],
      );
    }
    return pass([`${decisions.fileCount} decision records`]);
  },
};

const feedbackRecency: QualityCheck = {
  id: "feedback-recency",
  concern: "feedback_loop",
  weight: 2,
  run: (ctx) => {
    const allDates: Date[] = [];

    // Parse dates from footgun files
    const footgunPath = ctx.config.config.footguns.path;
    try {
      const footgunFiles = ctx.fs.listDir(footgunPath);
      for (const f of footgunFiles) {
        if (!f.endsWith(".md")) continue;
        const content = ctx.fs.readFile(`${footgunPath}/${f}`);
        if (content) allDates.push(...parseCreatedDates(content));
      }
    } catch {
      // Directory doesn't exist
    }

    // Parse dates from lesson files
    const lessonPath = ctx.config.config.lessons.path;
    try {
      const lessonFiles = ctx.fs.listDir(lessonPath);
      for (const f of lessonFiles) {
        if (!f.endsWith(".md")) continue;
        const content = ctx.fs.readFile(`${lessonPath}/${f}`);
        if (content) allDates.push(...parseCreatedDates(content));
      }
    } catch {
      // Directory doesn't exist
    }

    if (allDates.length === 0) {
      return partial(
        20,
        ["No dated entries found in footguns or lessons"],
        [
          "Add **Created:** YYYY-MM-DD to footgun and lesson entries for recency tracking",
        ],
        [
          "Add **Created:** YYYY-MM-DD lines to entries in .goat-flow/footguns/ and .goat-flow/lessons/.",
        ],
      );
    }

    const now = new Date();
    const ninetyDaysAgo = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() - 90,
    );
    const recentCount = allDates.filter((d) => d >= ninetyDaysAgo).length;

    if (recentCount === 0) {
      const newest = allDates.sort((a, b) => b.getTime() - a.getTime())[0]!;
      const daysAgo = Math.round(
        (now.getTime() - newest.getTime()) / (1000 * 60 * 60 * 24),
      );
      return partial(
        40,
        [
          `${allDates.length} dated entries but none in last 90 days (newest: ${daysAgo} days ago)`,
        ],
        ["Capture recent footguns and lessons to keep the feedback loop active"],
        [
          "Add new footgun or lesson entries from recent work to .goat-flow/footguns/ and .goat-flow/lessons/.",
        ],
      );
    }

    return pass([
      `${recentCount}/${allDates.length} feedback entries are from the last 90 days`,
    ]);
  },
};

/** All quality checks grouped by concern */
export const QUALITY_CHECKS: QualityCheck[] = [
  // context
  instructionLineCount,
  executionLoopPresent,
  routerTableResolves,
  footgunEvidenceResolves,
  architectureExists,
  architectureRefsResolve,
  // constraints
  denyCoversSecrets,
  denyBlocksDangerous,
  askFirstBoundaries,
  linterRegistered,
  denyBlocksPipeToShell,
  // verification
  testCommandRunnable,
  hooksRegisteredAndPresent,
  commitGuidanceExists,
  hookHasValidation,
  hookHonestFailures,
  lintCommandConfigured,
  // recovery
  milestoneFilesExist,
  sessionLogsExist,
  compactionHookPresent,
  milestoneHasCheckboxes,
  // feedback_loop
  footgunActivity,
  lessonActivity,
  decisionsTracked,
  feedbackRecency,
];
