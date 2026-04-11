/**
 * Guide mode renderer - turns the scanner into a setup assistant.
 * Instead of scores, shows prioritized "what to create next" instructions.
 * Skips checks that don't apply to the detected stack.
 */
import type { ScanReport, AgentReport, CheckResult } from "../types.js";

/** A single prioritized item in the setup guide output */
interface GuideItem {
  priority: number;
  tier: string;
  id: string;
  name: string;
  action: string;
  effort: "trivial" | "moderate" | "complex";
}

/** Per-check effort overrides where tier-based effort is inaccurate. */
const EFFORT_OVERRIDES: Record<string, "trivial" | "moderate" | "complex"> = {
  // Foundation checks that are actually moderate (need content, not just file creation)
  "1.1.5": "moderate", // Concrete examples require BAD/GOOD pairs with real paths
  "1.1.5a": "moderate", // Path resolution requires real project paths in instruction file
  "1.2.6": "moderate", // LOG step needs footguns/lessons dirs AND content
  "1.3.2": "moderate", // Ask First boundaries need project-specific paths

  // Standard checks that are actually trivial (one-line fixes)
  "2.2.1": "trivial", // Fix settings.json JSON syntax
  "2.4.4": "trivial", // Add handoff ref to router table
  "2.4.5": "trivial", // Add config ref to router table
  "2.4.6": "trivial", // Add session log ref to router table

  // Standard checks that are actually complex
  "2.1.12": "complex", // Skills need Step 0 AND constraints - structural rewrite
  "2.2.8": "trivial", // Create .copilotignore file

  // Full checks that are moderate (not complex)
  "3.1.3": "moderate", // Eval files need real scenario content
  "3.3.1a": "moderate", // Handoff template sections - fill in a template
};

/** Map a rubric tier to a default effort estimate for the setup guide. */
function effortFromTier(tier: string): "trivial" | "moderate" | "complex" {
  if (tier === "foundation") return "trivial";
  if (tier === "standard") return "moderate";
  return "complex";
}

/** Get the effort estimate for a check, using per-check overrides where available. */
function getEffort(
  checkId: string,
  tier: string,
): "trivial" | "moderate" | "complex" {
  return EFFORT_OVERRIDES[checkId] ?? effortFromTier(tier);
}

/** Calculate sort priority from a check result (lower = higher priority) */
function priorityFromCheck(check: CheckResult): number {
  // Foundation checks first, then standard, then full
  const tierWeight =
    check.tier === "foundation" ? 0 : check.tier === "standard" ? 100 : 200;
  // Higher maxPoints = higher priority within tier
  const pointWeight = 10 - check.maxPoints;
  return tierWeight + pointWeight;
}

/** Build prioritized setup items from an agent's failing and partial checks */
function buildGuideItems(agent: AgentReport): GuideItem[] {
  const items: GuideItem[] = [];

  for (const check of agent.checks) {
    if (check.hidden) continue;
    if (check.status === "pass" || check.status === "na") continue;

    const rec = agent.recommendations.find((r) => r.checkId === check.id);
    items.push({
      priority: priorityFromCheck(check),
      tier: check.tier,
      id: check.id,
      name: check.name,
      action: rec?.action ?? check.message,
      effort: getEffort(check.id, check.tier),
    });
  }

  // Include triggered anti-patterns as guide items
  for (const ap of agent.antiPatterns) {
    if (!ap.triggered) continue;
    items.push({
      priority: 300 + Math.abs(ap.deduction),
      tier: "anti-pattern",
      id: ap.id,
      name: ap.name,
      action: ap.message,
      effort: "moderate",
    });
  }

  // Sort by priority (lowest number = highest priority)
  items.sort((a, b) => a.priority - b.priority);
  return items;
}

/** Render the setup guide for a single agent */
function renderAgentGuide(agent: AgentReport): string {
  const lines: string[] = [];
  const items = buildGuideItems(agent);
  const visible = agent.checks.filter((c) => !c.hidden);
  const passCount = visible.filter((c) => c.status === "pass").length;
  const totalCount = visible.filter((c) => c.status !== "na").length;

  lines.push(`# Setup Guide: ${agent.agentName}`);
  lines.push(
    `Score: ${agent.score.percentage}% (${agent.score.grade}) - ${passCount}/${totalCount} checks pass`,
  );
  lines.push("");

  if (items.length === 0) {
    lines.push(
      "All checks pass and no anti-patterns triggered. Nothing to do.",
    );
    return lines.join("\n");
  }

  lines.push(`${items.length} items to fix, in priority order:`);
  lines.push("");

  let currentTier = "";
  for (const [i, item] of items.entries()) {
    if (item.tier !== currentTier) {
      currentTier = item.tier;
      lines.push(
        `## ${currentTier.charAt(0).toUpperCase() + currentTier.slice(1)} Tier`,
      );
      lines.push("");
    }

    const effortTag =
      item.effort === "trivial"
        ? "[easy]"
        : item.effort === "moderate"
          ? "[moderate]"
          : "[complex]";
    lines.push(`${i + 1}. **${item.id}: ${item.name}** ${effortTag}`);
    lines.push(`   ${item.action}`);
    lines.push("");
  }

  // Estimate total effort
  const trivialCount = items.filter((i) => i.effort === "trivial").length;
  const moderateCount = items.filter((i) => i.effort === "moderate").length;
  const complexCount = items.filter((i) => i.effort === "complex").length;
  lines.push("---");
  lines.push(
    `Estimated effort: ${trivialCount} easy + ${moderateCount} moderate + ${complexCount} complex items`,
  );

  return lines.join("\n");
}

/** Render a prioritized setup guide for each agent in the report. */
export function renderGuide(report: ScanReport): string {
  if (report.agents.length === 0) {
    return "No agents detected. Run `goat-flow setup --agent claude` to get started.";
  }

  return report.agents.map(renderAgentGuide).join("\n\n---\n\n");
}
