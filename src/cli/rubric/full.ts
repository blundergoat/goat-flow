/**
 * Full-tier rubric checks for mature adoption.
 * These checks were originally in a separate "Full" tier but merged into Standard - they use N/A gating to self-select.
 */
import type { CheckDef, FactContext, CheckResult } from "../types.js";
// Confidence criteria:
//   high   = deterministic (file exists, line count, JSON valid, exact match)
//   medium = heuristic (regex pattern, ratio threshold, keyword detection)
//   low    = semantic inference (content quality judgment)

/**
 * Formerly Tier 3 (Full) - now part of Standard.
 * Dual-agent consistency, skill conventions hygiene.
 */
export const fullChecks: CheckDef[] = [
  // 3.1.x Agent Evals removed - evals system removed in v1.1.0 (M09).

  // 3.2 CI Validation removed - CI workflow is a project-level concern, not an AI workflow check.

  // === 3.3 Hygiene ===
  // 3.3.1 (handoff template) removed - handoff is workspace-level, not a rubric concern.
  // 3.3.2 (RFC 2119 keyword count) removed - incentivized keyword sprinkling, not meaningful usage.
  // 3.3.3 (changelog) removed - CHANGELOG.md is a project-level concern, not an AI workflow check.
  {
    id: "3.3.4",
    name: "Execution loop consistent across agents",
    tier: "standard",
    category: "Dual-Agent Consistency",
    pts: 3,
    confidence: "medium",
    priority: "optional",
    na: (ctx) => ctx.facts.agents.length <= 1,
    detect: {
      type: "custom",
      fn: (ctx: FactContext): CheckResult => {
        /** Extract the execution-loop block between READ and the next major section boundary. */
        const extractLoop = (content: string | null): string => {
          if (!content) return "";
          /** Match READ as a heading (## READ, ### READ) or bold (**READ**) */
          const readMatch = content.match(/(?:###?\s+|\*\*)READ\b/i);
          if (!readMatch) return "";
          const start = readMatch.index ?? 0;
          /** Find the end marker AFTER the READ match - Autonomy Tiers, Router Table, Hard Rules, or Definition of Done */
          const afterRead = content.slice(start);
          const endMatch = afterRead.match(
            /^##\s+(Autonomy|Router|Hard Rules|Definition of Done)\b/im,
          );
          const end = endMatch ? start + (endMatch.index ?? 0) : content.length;
          return content.slice(start, end).replace(/\s+/g, " ").trim();
        };
        const loops = ctx.facts.agents
          .filter((a) => a.instruction.exists && a.instruction.content)
          .map((a) => ({
            agent: a.agent.instructionFile,
            loop: extractLoop(a.instruction.content),
          }));
        if (loops.length <= 1)
          return {
            id: "3.3.4",
            name: "Execution loop consistent across agents",
            tier: "standard",
            category: "Dual-Agent Consistency",
            status: "na",
            points: 0,
            maxPoints: 0,
            confidence: "medium",
            message: "Only one agent instruction file",
          };
        // Normalize loop text before similarity comparison.
        /** Convert loop text into comparable lowercase tokens with markdown stripped. */
        const normalize = (s: string): string[] =>
          s
            .toLowerCase()
            .replace(/[*`|_\-#]/g, " ")
            .replace(/\s+/g, " ")
            .trim()
            .split(" ")
            .filter((w) => w.length > 0);

        // Compare each pair - word-intersection similarity (Jaccard index)
        const diverged: string[] = [];
        for (let i = 1; i < loops.length; i++) {
          const a = loops[0],
            b = loops[i];
          if (!a || !b) continue;
          const wordsA = new Set(normalize(a.loop));
          const wordsB = new Set(normalize(b.loop));
          const intersection = [...wordsA].filter((w) => wordsB.has(w)).length;
          const union = new Set([...wordsA, ...wordsB]).size;
          const similarity = union > 0 ? intersection / union : 1;
          // 0.75 threshold tolerates minor wording variation while catching structural divergence
          if (similarity < 0.75 || a.loop.length === 0 || b.loop.length === 0) {
            diverged.push(`${a.agent} vs ${b.agent}`);
          }
        }
        if (diverged.length === 0)
          return {
            id: "3.3.4",
            name: "Execution loop consistent across agents",
            tier: "standard",
            category: "Dual-Agent Consistency",
            status: "pass",
            points: 3,
            maxPoints: 3,
            confidence: "medium",
            message: `Execution loops consistent across ${loops.length} agent files`,
          };
        return {
          id: "3.3.4",
          name: "Execution loop consistent across agents",
          tier: "standard",
          category: "Dual-Agent Consistency",
          status: "fail",
          points: 0,
          maxPoints: 3,
          confidence: "medium",
          message: `Execution loops diverged: ${diverged.join(", ")}. Write the loop in one file, copy verbatim to others`,
        };
      },
    },
    recommendation:
      "When multiple agents have divergent execution loops, they follow different verification rules, different escalation triggers, and different completion criteria for the same codebase. One agent runs shellcheck while another doesn't; one stops after two corrections while another keeps going. Reconcile the loops so all agents enforce the same quality standards.",
    recommendationKey: "fix-execution-loop-sync",
  },

  // 3.4.1 removed - duplicate of 3.1.6 after both were updated to require all 6 canonical skills.

  // === 3.5 Skill Conventions ===
  {
    id: "3.5.1",
    name: "Skill preamble file exists",
    tier: "standard",
    category: "Skill Conventions",
    pts: 1,
    confidence: "high",
    priority: "optional",
    detect: {
      type: "file_exists",
      path: ".goat-flow/skill-preamble.md",
    },
    recommendation:
      "Without skill-preamble.md, each skill defines its own conventions inline, leading to drift -- different output formats, different gate styles, different constraint language across skills. A shared conventions file ensures all skills follow the same structural patterns, making them predictable and composable.",
    recommendationKey: "create-skill-conventions",
  },
  {
    id: "3.5.2",
    name: "Skill conventions file exists",
    tier: "standard",
    category: "Skill Conventions",
    pts: 1,
    confidence: "high",
    priority: "optional",
    detect: {
      type: "file_exists",
      path: ".goat-flow/skill-conventions.md",
    },
    recommendation:
      "Without skill-conventions.md, full-depth conventions for skill authoring live only in individual skill files or developer memory. A dedicated conventions file provides the complete reference for skill structure, gate patterns, output formats, and composability rules -- ensuring new skills are consistent with existing ones.",
    recommendationKey: "create-skill-conventions",
  },
];
