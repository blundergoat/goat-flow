/**
 * Composer for the focused quality modes - process, harness, and skills, i.e.
 * every quality mode except agent-setup.
 *
 * Builds the mode-specific reporting-only prompt: the grounding commands to run
 * (or mark skipped), the target scope for the mode, prior-report and bounded
 * learning-loop context, and the focused JSON-report contract. Pure string
 * assembly over the passed QualityInput and the resolved agent profile.
 */
import type { AgentId } from "../types.js";
import { getAgentProfile } from "../agents/registry.js";
import type { QualityMode } from "../quality/schema.js";
import {
  appendFocusedReportContract,
  formatLocalDate,
  qualityModeLabel,
  qualityModeTargetScope,
  renderBoundedLearningLoopContext,
  renderPriorReportContext,
  type QualityInput,
  type QualityPayload,
} from "./compose-quality-common.js";

function focusedQualityModePrompt(
  mode: Exclude<QualityMode, "agent-setup">,
  agent?: AgentId,
) {
  if (mode === "process") {
    const agentAuditCmd = agent
      ? `node --import tsx src/cli/cli.ts audit . --agent ${agent} --harness --check-drift --format json`
      : "node --import tsx src/cli/cli.ts audit . --check-drift --format json";
    return [
      "REPORTING-ONLY ASSESSMENT MODE. Do not edit tracked files. Do not use /goat-review or any goat skill as the wrapper for this assessment; this prompt is the full assessment contract. You may read files, run read-only validation commands, and write normal gitignored reporting/local-state artifacts if the runner requires them. In this contract, gitignored logs, scratchpad notes, critique snapshots, quality reports, and task-local state do not count as writes; do not report them as read-only violations.",
      "",
      "Assess the goat-flow framework process in the controlling workspace: instruction files, .goat-flow/config.yaml, .goat-flow/architecture.md, .goat-flow/code-map.md, .goat-flow/skill-docs/, .goat-flow/skill-docs/playbooks/, workflow/setup/, workflow/manifest.json, installed skill mirrors, hooks, quality prompt modes, and validation scripts.",
      "",
      `Grounding commands to run or explicitly mark skipped: git status --short --untracked-files=all; node --import tsx src/cli/cli.ts stats . --check; ${agentAuditCmd}; node --import tsx src/cli/cli.ts audit . --check-content --format json; bash scripts/preflight-checks.sh. Command output wins over prose.`,
      "",
      "Use grep-first retrieval for .goat-flow/learning-loop/footguns/, .goat-flow/learning-loop/lessons/, and .goat-flow/learning-loop/decisions/. Do not broad-load those directories.",
      "",
      "Assessment checklist: Pre-check Results; Findings ordered by severity; What works; What is weak or ceremonial; Contradictions and false paths; Top 5 improvements; What was not verified. Use this checklist to decide the saved JSON scores and findings. Each saved finding's detail/evidence fields must include action type, exact file or semantic-anchor evidence, why it matters, and a verification command that would prove the fix.",
    ].join("\n");
  }

  if (mode === "skills") {
    return [
      "REPORTING-ONLY ASSESSMENT MODE. Do not edit tracked files. Do not use /goat-critique, /goat-review, or any other goat skill as the wrapper for this assessment; this prompt is the full assessment contract. You may read files, run read-only commands, and write normal gitignored reporting/local-state artifacts if the runner requires them. In this contract, gitignored logs, scratchpad notes, critique snapshots, quality reports, and task-local state do not count as writes; do not report them as read-only violations.",
      "",
      "Assess all seven goat-flow skills: /goat, /goat-debug, /goat-plan, /goat-review, /goat-critique, /goat-security, and /goat-qa. Use .goat-flow/skill-docs/skill-quality-testing/README.md plus the relevant files under .goat-flow/skill-docs/skill-quality-testing/. Read the workflow template SKILL.md files and installed mirrors under .claude/skills/, .agents/skills/, and .github/skills/ where relevant.",
      "",
      "Method rule: prefer live skill invocation only when the runner supports it safely. If live invocation or delegated/sub-agent calls are unavailable, perform a file-grounded protocol run against SKILL.md and label the evidence limit. Never imply a dry run is bulletproof TDD evidence.",
      "",
      "For each skill, output exactly these fields: Method used; Evidence limit; Worked; Failed/confusing; Useless ceremony; RED scenario; GREEN result; minimal REFACTOR; Verification command or grep that would prove the fix. Do not stop after one skill and do not ask which skill.",
      "",
      "After the seven sections, output: Cross-skill patterns; Top 5 skill/system improvements with file or semantic-anchor evidence and expected impact; What was not tested. Prioritize actionable improvements over praise.",
    ].join("\n");
  }

  return [
    "REPORTING-ONLY ASSESSMENT MODE. Do not edit tracked files. Do not use /goat-review or any goat skill as the wrapper for this assessment; this prompt is the full assessment contract. You may read files, run read-only validation commands, and write normal gitignored reporting/local-state artifacts if the runner requires them. In this contract, gitignored logs, scratchpad notes, critique snapshots, quality reports, and task-local state do not count as writes; do not report them as read-only violations.",
    "",
    "Assess whether the selected target project's agent harness is actually usable, not only structurally present. Focus on context loading, constraint safety, verification evidence, recovery paths, feedback-loop durability, and whether instructions distinguish the controlling goat-flow workspace from the selected target.",
    "",
    "Grounding commands to run or explicitly mark skipped: git status --short --untracked-files=all; node --import tsx src/cli/cli.ts audit . --harness --format json from the controlling workspace when applicable; node --import tsx src/cli/cli.ts stats . --check when the selected target is a goat-flow installation. Command output wins over prose.",
    "",
    "Read next: target instruction files, local agent settings/hooks, .goat-flow/config.yaml when present, .goat-flow/skill-docs/ and .goat-flow/skill-docs/playbooks/ when present, controlling-workspace harness code under src/cli/audit/harness/, and any dashboard terminal/runner context text that affects selected-target execution.",
    "",
    "Output sections: Harness Scorecard; Findings ordered by severity; Concern-by-concern analysis; False positive and false negative risks; Top 5 improvements; What was not verified. For each deterministic harness concern (Context, Constraints, Verification, Recovery, Feedback Loop), state what works, what fails or is weak, exact file or semantic-anchor evidence, and a verification command that would prove the fix.",
    "",
    "Do not treat a structural PASS as quality PASS. If a score or check claims completeness, verify what behavior it actually proves.",
  ].join("\n");
}

export function composeFocusedQuality(
  input: QualityInput,
  qualityMode: Exclude<QualityMode, "agent-setup">,
): QualityPayload {
  const {
    agent,
    projectPath,
    auditReport,
    priorReport = null,
    selectedProjectPath,
    runDate = formatLocalDate(),
  } = input;
  const profile = getAgentProfile(agent);
  const auditStatus: QualityPayload["auditStatus"] = auditReport
    ? auditReport.status
    : "unavailable";
  const label = qualityModeLabel(qualityMode);
  const lines: string[] = [];

  lines.push(`# GOAT Flow ${label} Assessment - ${profile.name}`);
  lines.push("");
  lines.push(focusedQualityModePrompt(qualityMode, agent));
  lines.push("");
  lines.push("Quality mode scope:");
  lines.push(`- Mode: ${label}`);
  lines.push(`- Project path: \`${projectPath}\``);
  if (selectedProjectPath && selectedProjectPath !== projectPath) {
    lines.push(`- Selected target project: \`${selectedProjectPath}\``);
  }
  lines.push(`- Scope rule: ${qualityModeTargetScope(qualityMode)}`);
  lines.push(`- Selected quality target agent: ${agent}`);
  lines.push(
    "- Keep this assessment read-only unless the user explicitly asks for edits.",
  );
  lines.push("");
  lines.push(renderPriorReportContext(priorReport, qualityMode));
  lines.push("");
  const learningLoopContext = renderBoundedLearningLoopContext(
    input.sharedFacts,
    qualityMode,
  );
  if (learningLoopContext) {
    lines.push(learningLoopContext);
    lines.push("");
  }
  appendFocusedReportContract(lines, {
    agent,
    projectPath,
    auditStatus,
    qualityMode,
    priorReport,
    runDate,
  });

  return {
    command: "quality",
    agent,
    auditStatus,
    auditSummary: `${label}: ${qualityModeTargetScope(qualityMode)}`,
    prompt: lines.join("\n"),
  };
}
