import type { CheckDef, FactContext, CheckResult } from "../../types.js";

/** Standard-tier content-quality checks that do not score project-owned coding-standard documents. */
export const localContextChecks: CheckDef[] = [
  {
    id: "2.6.5",
    name: "Skill path integrity",
    tier: "standard",
    category: "Content Quality",
    pts: 3,
    confidence: "high",
    priority: "required",
    detect: {
      type: "custom",
      fn: (ctx: FactContext): CheckResult => {
        const base = {
          id: "2.6.5",
          name: "Skill path integrity",
          tier: "standard" as const,
          category: "Content Quality",
          confidence: "high" as const,
        };
        const agent = ctx.agentFacts;
        const problems: string[] = [];
        for (const skill of agent.skills.found) {
          const path = `${agent.agent.skillsDir}/${skill}/SKILL.md`;
          const content = ctx.fs.readFile(path);
          if (!content) continue;
          // workflow/ paths in installed skills are INVALID (R9 regression class)
          const wfMatches = content.match(/workflow\/[a-zA-Z0-9_./-]+/g);
          if (wfMatches) {
            problems.push(`${skill}: framework-local workflow/ path`);
          }
          // .goat-flow/ paths must resolve
          const gfMatches = content.match(/\.goat-flow\/[a-zA-Z0-9_./-]+/g);
          if (gfMatches) {
            for (const ref of new Set(gfMatches)) {
              if (!ctx.fs.exists(ref)) {
                problems.push(`${skill}: dead ref ${ref}`);
              }
            }
          }
        }
        if (problems.length === 0) {
          return {
            ...base,
            status: "pass",
            points: 3,
            maxPoints: 3,
            message: "All skill path references are valid",
          };
        }
        return {
          ...base,
          status: "fail",
          points: 0,
          maxPoints: 3,
          message: `Skill path problems: ${problems.join("; ")}`,
        };
      },
    },
    recommendation:
      "Installed skills must only reference .goat-flow/ paths, never workflow/ paths. Fix any workflow/ references and verify all .goat-flow/ paths resolve.",
    recommendationKey: "create-goat-flow-config",
  },
  {
    id: "2.6.6",
    name: "Footgun evidence verification",
    tier: "standard",
    category: "Content Quality",
    pts: 2,
    confidence: "medium",
    priority: "recommended",
    detect: {
      type: "custom",
      fn: (ctx: FactContext): CheckResult => {
        const base = {
          id: "2.6.6",
          name: "Footgun evidence verification",
          tier: "standard" as const,
          category: "Content Quality",
          confidence: "medium" as const,
        };
        const footguns = ctx.facts.shared.footguns;
        if (!footguns.exists) {
          return {
            ...base,
            status: "na",
            points: 0,
            maxPoints: 2,
            message: "No footguns surface",
          };
        }
        const total = footguns.totalRefs;
        const valid = footguns.validRefs;
        if (total === 0) {
          return {
            ...base,
            status: "fail",
            points: 0,
            maxPoints: 2,
            message: "Footguns have no file:line evidence",
          };
        }
        const ratio = valid / total;
        if (ratio >= 0.8) {
          return {
            ...base,
            status: "pass",
            points: 2,
            maxPoints: 2,
            message: `${valid}/${total} footgun citations resolve (${Math.round(ratio * 100)}%)`,
          };
        }
        if (ratio >= 0.5) {
          return {
            ...base,
            status: "partial",
            points: 1,
            maxPoints: 2,
            message: `${valid}/${total} footgun citations resolve (${Math.round(ratio * 100)}%) - some stale`,
          };
        }
        return {
          ...base,
          status: "fail",
          points: 0,
          maxPoints: 2,
          message: `${valid}/${total} footgun citations resolve (${Math.round(ratio * 100)}%) - mostly stale`,
        };
      },
    },
    recommendation:
      "Footgun entries with stale file:line citations erode trust. Re-verify each citation points to real code.",
    recommendationKey: "create-goat-flow-config",
  },
  {
    id: "2.6.7",
    name: "Instruction file specificity",
    tier: "standard",
    category: "Content Quality",
    pts: 2,
    confidence: "medium",
    priority: "recommended",
    detect: {
      type: "custom",
      fn: (ctx: FactContext): CheckResult => {
        const base = {
          id: "2.6.7",
          name: "Instruction file specificity",
          tier: "standard" as const,
          category: "Content Quality",
          confidence: "medium" as const,
        };
        const content = ctx.agentFacts.instruction.content;
        if (!content) {
          return {
            ...base,
            status: "fail",
            points: 0,
            maxPoints: 2,
            message: "No instruction file",
          };
        }
        // Count project-specific paths (not .goat-flow/ or .claude/)
        const allPaths = content.match(/`[a-zA-Z][a-zA-Z0-9_./-]+`/g) ?? [];
        const projectPaths = allPaths.filter(
          (p) =>
            !p.includes(".goat-flow/") &&
            !p.includes(".claude/") &&
            !p.includes(".agents/") &&
            !p.includes(".github/") &&
            !p.includes(".gemini/"),
        );
        const count = new Set(projectPaths).size;
        if (count >= 3) {
          return {
            ...base,
            status: "pass",
            points: 2,
            maxPoints: 2,
            message: `${count} project-specific paths referenced`,
          };
        }
        if (count >= 1) {
          return {
            ...base,
            status: "partial",
            points: 1,
            maxPoints: 2,
            message: `Only ${count} project-specific path(s) - may be too generic`,
          };
        }
        return {
          ...base,
          status: "fail",
          points: 0,
          maxPoints: 2,
          message:
            "No project-specific paths - instruction file appears generic",
        };
      },
    },
    recommendation:
      "The instruction file should reference real project paths (src/, tests/, scripts/) to prove it was adapted to this codebase.",
    recommendationKey: "create-goat-flow-config",
  },
  {
    id: "2.6.8",
    name: "No duplicate canonical surfaces",
    tier: "standard",
    category: "Content Quality",
    pts: 2,
    confidence: "high",
    priority: "required",
    detect: {
      type: "custom",
      fn: (ctx: FactContext): CheckResult => {
        const base = {
          id: "2.6.8",
          name: "No duplicate canonical surfaces",
          tier: "standard" as const,
          category: "Content Quality",
          confidence: "high" as const,
        };
        const duplicates: string[] = [];
        const pairs: [string, string][] = [
          ["docs/footguns.md", ".goat-flow/footguns/"],
          ["docs/footguns/", ".goat-flow/footguns/"],
          ["docs/lessons.md", ".goat-flow/lessons/"],
          ["docs/lessons/", ".goat-flow/lessons/"],
          ["docs/architecture.md", ".goat-flow/architecture.md"],
        ];
        for (const [a, b] of pairs) {
          if (ctx.fs.exists(a) && ctx.fs.exists(b)) {
            duplicates.push(`${a} + ${b}`);
          }
        }
        if (duplicates.length === 0) {
          return {
            ...base,
            status: "pass",
            points: 2,
            maxPoints: 2,
            message: "No duplicate canonical surfaces",
          };
        }
        return {
          ...base,
          status: "fail",
          points: 0,
          maxPoints: 2,
          message: `Duplicate surfaces: ${duplicates.join(", ")}`,
        };
      },
    },
    recommendation:
      "Each artifact type (footguns, lessons, architecture) should have ONE canonical surface. Remove the duplicate or bridge via config.yaml.",
    recommendationKey: "create-goat-flow-config",
  },
  {
    id: "2.6.9",
    name: "Router path verification",
    tier: "standard",
    category: "Content Quality",
    pts: 2,
    confidence: "high",
    priority: "required",
    detect: {
      type: "custom",
      fn: (ctx: FactContext): CheckResult => {
        const base = {
          id: "2.6.9",
          name: "Router path verification",
          tier: "standard" as const,
          category: "Content Quality",
          confidence: "high" as const,
        };
        const content = ctx.agentFacts.instruction.content;
        if (!content) {
          return {
            ...base,
            status: "na",
            points: 0,
            maxPoints: 2,
            message: "No instruction file",
          };
        }
        // Find router table section and extract paths
        const routerMatch = content.match(
          /## Router.*?\n([\s\S]*?)(?=\n##|\n$)/i,
        );
        if (!routerMatch?.[1]) {
          return {
            ...base,
            status: "na",
            points: 0,
            maxPoints: 2,
            message: "No Router Table section found",
          };
        }
        const rows = routerMatch[1];
        const paths = rows.match(/`\.?[a-zA-Z][a-zA-Z0-9_./-]+`/g) ?? [];
        const dead: string[] = [];
        for (const raw of paths) {
          const p = raw.replace(/`/g, "").replace(/\/+$/, "");
          if (!p.includes("/")) continue; // skip non-paths
          if (!ctx.fs.exists(p) && !ctx.fs.exists(p + "/")) {
            dead.push(p);
          }
        }
        if (dead.length === 0) {
          return {
            ...base,
            status: "pass",
            points: 2,
            maxPoints: 2,
            message: `All ${paths.length} router paths resolve`,
          };
        }
        return {
          ...base,
          status: "fail",
          points: 0,
          maxPoints: 2,
          message: `Dead router paths: ${dead.join(", ")}`,
        };
      },
    },
    recommendation:
      "Every path in the Router Table must exist on disk. Remove dead entries or fix the paths.",
    recommendationKey: "create-goat-flow-config",
  },
];
