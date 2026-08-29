/**
 * Focused quality-prompt composer for process, harness, and skills assessments.
 *
 * Use when a CLI or dashboard user launches a reporting-only process, harness, or skills review.
 * It combines live audit evidence, the selected target, prior context, score calibration, and the saved-report contract.
 * Prompt assembly is deterministic and never changes the project the user asked to assess.
 */
import type { AgentId } from "../types.js";
import { getAgentProfile } from "../agents/registry.js";
import type { QualityMode } from "../quality/schema.js";
import {
  formatLocalDate,
  qualityModeLabel,
  qualityModeTargetScope,
  renderAuditSummary,
  renderAuditUnavailableHeading,
  renderAuditUnavailableSummary,
  renderBoundedLearningLoopContext,
  renderDegradedNote,
  renderPriorReportContext,
  type QualityInput,
  type QualityPayload,
} from "./compose-quality-common.js";
import { appendFocusedReportContract } from "./compose-quality-contract.js";
import { appendFocusedRatingSections } from "./compose-quality-static-sections.js";

const FOCUSED_DENIED_GROUNDING_GUIDANCE =
  'If a grounding command is denied by the session\'s permission profile or unavailable, record the literal denial or unavailability, do not retry it or work around the profile, and never infer a result. Continue with available read-only evidence, label the evidence limit, and list the command in "What was not verified". Keep `audit_status` at `unavailable` unless a live audit completed this run; when only source reading supports a finding, use `evidence_method: "static-analysis"`.';

/**
 * Return the reporting contract a user receives for one focused quality mode.
 * Use first so later audit, score, and save sections all inherit the user's selected process, harness, or skills scope.
 *
 * @param qualityMode - selected focused mode; agent-setup is handled by the separate installation composer
 * @param agent - selected agent; absent means process and harness commands use aggregate audit scope
 * @returns reporting-only prompt body; never empty for a supported focused mode
 */
function focusedQualityModePrompt(
  qualityMode: Exclude<QualityMode, "agent-setup">,
  agent?: AgentId,
): string {
  // Process reviewers need controlling-workspace commands and framework-wide evidence.
  if (qualityMode === "process") {
    // Selecting a specific agent adds its harness checks; an aggregate process launch keeps the broader audit command.
    const agentAuditCommand = agent
      ? `node --import tsx src/cli/cli.ts audit . --agent ${agent} --harness --check-drift --format json`
      : "node --import tsx src/cli/cli.ts audit . --check-drift --format json";
    return [
      "REPORTING-ONLY ASSESSMENT MODE. Do not edit tracked files. Do not use /goat-review or any goat skill as the wrapper for this assessment; this prompt is the full assessment contract. You may read files, run read-only validation commands, and write normal gitignored reporting/local-state artifacts if the runner requires them. In this contract, gitignored logs, scratchpad notes, critique snapshots, quality reports, and task-local state do not count as writes; do not report them as read-only violations.",
      "",
      "Assess the goat-flow framework process in the controlling workspace: instruction files, .goat-flow/config.yaml, .goat-flow/architecture.md, .goat-flow/code-map.md, .goat-flow/skill-docs/, .goat-flow/skill-docs/playbooks/, workflow/setup/, workflow/manifest.json, installed skill mirrors, hooks, quality prompt modes, and validation scripts.",
      "",
      `Grounding commands to run or explicitly mark skipped: git status --short --untracked-files=all; node --import tsx src/cli/cli.ts stats . --check; ${agentAuditCommand}; node --import tsx src/cli/cli.ts audit . --check-content --format json; bash scripts/preflight-checks.sh. Command output wins over prose. ${FOCUSED_DENIED_GROUNDING_GUIDANCE}`,
      "",
      "Use INDEX-first retrieval for .goat-flow/learning-loop/{footguns,lessons,patterns,decisions}/INDEX.md. Do not broad-load those directories.",
      "",
      "Assessment checklist: Pre-check Results; Findings ordered by severity; What works; What is weak or ceremonial; Contradictions and false paths; Top 5 improvements; What was not verified. Use this checklist to decide the saved JSON scores and findings. Each saved finding's detail/evidence fields must include action type, exact file or semantic-anchor evidence, why it matters, and a verification command that would prove the fix.",
    ].join("\n");
  }

  // Skill reviewers need the eight-skill RED/GREEN/REFACTOR pressure contract.
  if (qualityMode === "skills") {
    return [
      "REPORTING-ONLY ASSESSMENT MODE. Do not edit tracked files. Do not use /goat-critique, /goat-review, or any other goat skill as the wrapper for this assessment; this prompt is the full assessment contract. You may read files, run read-only commands, and write normal gitignored reporting/local-state artifacts if the runner requires them. In this contract, gitignored logs, scratchpad notes, critique snapshots, quality reports, and task-local state do not count as writes; do not report them as read-only violations.",
      "",
      "Assess all eight goat-flow skills: /goat, /goat-debug, /goat-plan, /goat-review, /goat-critique, /goat-security, /goat-qa, and /goat-clarity. Use .goat-flow/skill-docs/skill-quality-testing/README.md plus the relevant files under .goat-flow/skill-docs/skill-quality-testing/. Read the workflow template SKILL.md files and installed mirrors under .claude/skills/, .agents/skills/, and .github/skills/ where relevant.",
      "",
      "Method rule: prefer live skill invocation only when the runner supports it safely. Run a mutation-capable workflow only against a disposable copy of current project evidence with a frozen write boundary; never let a quality probe edit the assessed checkout. If live invocation or delegated/sub-agent calls are unavailable, perform a file-grounded protocol run against SKILL.md and label the evidence limit. Never present a dry run as three-pass pressure evidence.",
      "",
      "For each skill, output exactly these fields: Method used; Evidence limit; Worked; Failed/confusing; Useless ceremony; RED scenario; GREEN result; minimal REFACTOR; Verification command or grep that would prove the fix. Do not stop after one skill and do not ask which skill.",
      "",
      "After the eight sections, output: Cross-skill patterns; Top 5 skill/system improvements with file or semantic-anchor evidence and expected impact; What was not tested. Prioritize actionable improvements over praise.",
    ].join("\n");
  }

  // Harness reviewers need selected-target probes plus the same honest fallback as process reviews.
  const agentAuditCommand = agent
    ? `node --import tsx src/cli/cli.ts audit . --agent ${agent} --harness --format json`
    : "node --import tsx src/cli/cli.ts audit . --harness --format json";
  return [
    "REPORTING-ONLY ASSESSMENT MODE. Do not edit tracked files. Do not use /goat-review or any goat skill as the wrapper for this assessment; this prompt is the full assessment contract. You may read files, run read-only validation commands, and write normal gitignored reporting/local-state artifacts if the runner requires them. In this contract, gitignored logs, scratchpad notes, critique snapshots, quality reports, and task-local state do not count as writes; do not report them as read-only violations.",
    "",
    "Assess whether the selected target project's agent harness is actually usable, not only structurally present. Focus on context loading, constraint safety, verification evidence, recovery paths, feedback-loop durability, and whether instructions distinguish the controlling goat-flow workspace from the selected target.",
    "",
    `Grounding commands to run or explicitly mark skipped: git status --short --untracked-files=all; ${agentAuditCommand} from the controlling workspace when applicable; node --import tsx src/cli/cli.ts stats . --check when the selected target is a goat-flow installation. Command output wins over prose. ${FOCUSED_DENIED_GROUNDING_GUIDANCE}`,
    "",
    "Read next: target instruction files, local agent settings/hooks, .goat-flow/config.yaml when present, .goat-flow/skill-docs/ and .goat-flow/skill-docs/playbooks/ when present, controlling-workspace harness code under src/cli/audit/harness/, and any dashboard terminal/runner context text that affects selected-target execution.",
    "",
    "Output sections: Harness Scorecard; Findings ordered by severity; Concern-by-concern analysis; False positive and false negative risks; Top 5 improvements; What was not verified. For each deterministic harness concern (Context, Constraints, Verification, Recovery, Feedback Loop), state what works, what fails or is weak, exact file or semantic-anchor evidence, and a verification command that would prove the fix.",
    "",
    "Do not treat a structural PASS as quality PASS. If a score or check claims completeness, verify what behavior it actually proves.",
  ].join("\n");
}

/**
 * Add live audit evidence so focused reviewers see structural limits before judging quality.
 * Use between the mode contract and target details so users can distinguish a structural result from a behavioral assessment.
 *
 * @param lines - prompt lines built so far; empty starts the Audit Summary at the document beginning
 * @param input - quality request; a missing audit selects the explicit unavailable-state copy
 * @param auditSummaryText - compact audit summary; empty text leaves no machine evidence to quote
 * @returns nothing; the supplied prompt lines receive one audit section
 */
function appendFocusedAuditSummary(
  lines: string[],
  input: QualityInput,
  auditSummaryText: string,
): void {
  lines.push("---");
  lines.push("");
  lines.push("## Audit Summary");
  lines.push("");

  // A completed audit gives the user status, scores, and evidence limits in one prompt section.
  if (input.auditReport) {
    const overallAuditStatusLabel =
      input.auditReport.status === "pass" ? "PASS" : "FAIL";
    lines.push(`**Overall: ${overallAuditStatusLabel}**`);
    lines.push("");
    lines.push(auditSummaryText);
    lines.push("");
    lines.push(
      "> **Note:** The audit checks structural completeness only. Its evidence limits state what the run did not prove; the quality assessment must judge those gaps rather than treating PASS as behavioral certification.",
    );
    // Failed setup remains relevant evidence without pre-filling the reviewer's qualitative verdict.
    if (input.auditReport.status === "fail") {
      lines.push(
        "> The setup has failures. Decide whether they are real problems or false positives during the assessment.",
      );
    }
    return;
  }

  // For example, a fast dashboard launch with no cached audit uses cache-miss copy; an unspecified cause uses the failed-audit fallback.
  const unavailableAuditReason = input.auditUnavailableReason ?? "audit-failed";
  lines.push(renderAuditUnavailableHeading(unavailableAuditReason));
  lines.push("");
  lines.push(auditSummaryText);
  lines.push(renderDegradedNote(unavailableAuditReason));
}

/**
 * Compose one focused assessment payload for the CLI or Quality dashboard launch flow.
 * Use after the user chooses process, harness, or skills so the runner receives one scoped prompt and one honest audit status.
 *
 * @param input - selected agent, target, and optional audit; absent audit becomes an unavailable summary
 * @param qualityMode - focused mode chosen by the user; agent-setup is not accepted here
 * @returns quality payload with prompt and audit summary; neither field is empty for a valid request
 */
export function composeFocusedQuality(
  input: QualityInput,
  qualityMode: Exclude<QualityMode, "agent-setup">,
): QualityPayload {
  const {
    agent,
    projectPath,
    auditReport,
    auditUnavailableReason = "audit-failed",
    priorReport = null,
    selectedProjectPath,
    runDate = formatLocalDate(),
  } = input;
  const agentProfile = getAgentProfile(agent);
  // A launch without audit evidence stays explicitly unavailable instead of presenting an unverified pass or fail.
  const auditStatus: QualityPayload["auditStatus"] = auditReport
    ? auditReport.status
    : "unavailable";
  const qualityModeHeading = qualityModeLabel(qualityMode);
  const lines: string[] = [];
  // Missing audit evidence gets reason-specific copy so the user can distinguish a failed run from an empty fast cache.
  const auditSummaryText = auditReport
    ? renderAuditSummary(auditReport)
    : renderAuditUnavailableSummary(auditUnavailableReason);

  lines.push(
    `# GOAT Flow ${qualityModeHeading} Assessment - ${agentProfile.name}`,
  );
  lines.push("");
  lines.push(focusedQualityModePrompt(qualityMode, agent));
  lines.push("");
  appendFocusedAuditSummary(lines, input, auditSummaryText);
  lines.push("");
  lines.push("Quality mode scope:");
  lines.push(`- Mode: ${qualityModeHeading}`);
  lines.push(`- Project path: \`${projectPath}\``);
  // Cross-project quality runs show both roots so the reviewer does not inspect the wrong checkout.
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
  const learningLoopPromptBlock = renderBoundedLearningLoopContext(
    input.sharedFacts,
    qualityMode,
    input.auditReport,
  );
  // Relevant prior incidents stay bounded and appear only when retrieval found a mode-specific match.
  if (learningLoopPromptBlock) {
    lines.push(learningLoopPromptBlock);
    lines.push("");
  }
  appendFocusedRatingSections(lines, qualityMode);
  appendFocusedReportContract(lines, {
    agent,
    projectPath,
    auditStatus,
    qualityMode,
    priorReport,
    runDate,
    persistence: input.persistence,
  });

  return {
    command: "quality",
    agent,
    auditStatus,
    auditSummary: auditSummaryText,
    prompt: lines.join("\n"),
  };
}
