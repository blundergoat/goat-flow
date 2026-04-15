/**
 * Recovery concern: Can the agent resume after crash or compaction?
 * 3 checks: milestone-tracking, session-logs, compaction-hook.
 */
import type { HarnessCheck } from "../types.js";
import { pass, fail } from "./helpers.js";
import { collectMarkdownFiles } from "./helpers.js";

const milestoneTracking: HarnessCheck = {
  id: "milestone-tracking",
  name: "Milestone tracking configured",
  concern: "recovery",
  run: (ctx) => {
    const tasksDir = ".goat-flow/tasks";
    if (!ctx.fs.exists(tasksDir)) {
      return fail(
        ["No tasks directory found"],
        ["Create .goat-flow/tasks/ for milestone tracking"],
        [
          "Create .goat-flow/tasks/ with milestone .md files containing - [ ] checkbox items for trackable progress.",
        ],
      );
    }
    const mdFiles = collectMarkdownFiles(ctx.fs, tasksDir);
    if (mdFiles.length === 0) {
      return pass(["Tasks directory exists (empty — valid for new projects)"]);
    }
    const checkboxPattern = /- \[[ x]\]/;
    let withCheckboxes = 0;
    for (const f of mdFiles) {
      const content = ctx.fs.readFile(f);
      if (content && checkboxPattern.test(content)) {
        withCheckboxes++;
      }
    }
    return pass([
      `${withCheckboxes}/${mdFiles.length} milestone files have trackable checkbox items`,
    ]);
  },
};

const sessionLogs: HarnessCheck = {
  id: "session-logs",
  name: "Session logs directory",
  concern: "recovery",
  run: (ctx) => {
    const logsDir = ".goat-flow/logs/sessions";
    try {
      ctx.fs.listDir(logsDir);
    } catch {
      return fail(
        ["No session logs directory"],
        ["Create .goat-flow/logs/sessions/ directory"],
        [
          "Create .goat-flow/logs/sessions/ and start logging sessions for continuity between conversations.",
        ],
      );
    }
    return pass(["Session logs directory exists"]);
  },
};

const compactionHook: HarnessCheck = {
  id: "compaction-hook",
  name: "Compaction hook registered",
  concern: "recovery",
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
      return pass([`${covered.join(", ")}: compaction hook registered`]);
    }
    const nonCodexUncovered = uncovered.filter((id) => id !== "codex");
    const codexUncovered = uncovered.filter((id) => id === "codex");

    const findings: string[] = [];
    if (covered.length > 0) {
      findings.push(`${covered.join(", ")}: compaction hook registered`);
    }
    if (codexUncovered.length > 0) {
      findings.push("codex: context compaction not supported — not checked");
    }

    if (nonCodexUncovered.length > 0) {
      findings.push(
        `${nonCodexUncovered.join(", ")}: no compaction hook registered`,
      );
      return fail(
        findings,
        [`Add compaction hook for ${nonCodexUncovered.join(", ")}`],
        [
          `Register a compaction hook for ${nonCodexUncovered.join(", ")} that re-injects task state after context compression.`,
        ],
      );
    }
    return pass(findings);
  },
};

export const RECOVERY_CHECKS: HarnessCheck[] = [
  milestoneTracking,
  sessionLogs,
  compactionHook,
];
