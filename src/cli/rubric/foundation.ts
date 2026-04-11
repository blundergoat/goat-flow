/**
 * Foundation-tier rubric checks.
 * These are the baseline requirements every GOAT Flow project must satisfy before higher-level workflow checks matter.
 */
import type { CheckDef, FactContext, CheckResult } from "../types.js";

// Confidence criteria:
//   high   = deterministic (file exists, line count, JSON valid, exact match)
//   medium = heuristic (regex pattern, ratio threshold, keyword detection)
//   low    = semantic inference (content quality judgment)

/**
 * Tier 1 - Foundation (48 points)
 * Instruction file, execution loop, autonomy tiers, DoD, enforcement.
 * These are baseline requirements every GOAT Flow project must satisfy.
 */
export const foundationChecks: CheckDef[] = [
  // === 1.1 Instruction File (9 pts) ===
  {
    id: "1.1.1",
    name: "Instruction file exists",
    tier: "foundation",
    category: "Instruction File",
    pts: 2,
    confidence: "high",
    priority: "required",
    detect: { type: "file_exists", path: "{instruction_file}" },
    recommendation:
      "Without a root instruction file, agents have zero project context and will hallucinate file paths, invent conventions, and ignore your workflow. Create the instruction file so every session starts grounded in reality.",
    recommendationKey: "create-instruction-file",
  },
  {
    id: "1.1.2",
    name: "Under line target",
    tier: "foundation",
    category: "Instruction File",
    pts: 3,
    partialPts: 1,
    confidence: "high",
    priority: "recommended",
    detect: {
      type: "custom",
      fn: (ctx: FactContext): CheckResult => {
        const lines = ctx.agentFacts.instruction.lineCount;
        const { target, limit } = ctx.facts.shared.config.lineLimits;
        const base = {
          id: "1.1.2",
          name: "Under line target",
          tier: "foundation" as const,
          category: "Instruction File",
          confidence: "high" as const,
        };
        if (lines <= target)
          return {
            ...base,
            status: "pass",
            points: 3,
            maxPoints: 3,
            message: `${lines} lines (under ${target} target)`,
          };
        if (lines <= limit)
          return {
            ...base,
            status: "partial",
            points: 1,
            maxPoints: 3,
            message: `${lines} lines found. Expected at or under ${target}; currently still under the ${limit}-line hard limit. Trim ${lines - target} lines to get back under target.`,
          };
        return {
          ...base,
          status: "fail",
          points: 0,
          maxPoints: 3,
          message: `${lines} lines found. Expected at or under ${limit} hard limit (${target} target). Trim at least ${lines - limit} lines.`,
        };
      },
    },
    recommendation:
      "Bloated instruction files get truncated or ignored during context compaction, causing agents to lose critical rules mid-session. Compress below the line target so the full file survives in context. Adjust thresholds in .goat-flow/config.yaml if your project genuinely needs more.",
    recommendationKey: "compress-instruction-file",
  },
  {
    id: "1.1.3",
    name: "Version header",
    tier: "foundation",
    category: "Instruction File",
    pts: 1,
    confidence: "high",
    priority: "recommended",
    detect: {
      type: "grep",
      path: "{instruction_file}",
      pattern: "v[0-9]|\\d{4}-\\d{2}-\\d{2}",
    },
    recommendation:
      'Without a version header, you cannot tell whether an agent is running against a stale cached copy of your instructions. Add a version or date stamp (e.g., "v1.0 - 2026-03-21") so drift between the file on disk and the agent\'s context is immediately visible.',
    recommendationKey: "add-version-header",
  },
  {
    id: "1.1.4",
    name: "Essential commands section",
    tier: "foundation",
    category: "Instruction File",
    pts: 2,
    confidence: "high",
    priority: "required",
    detect: {
      type: "grep",
      path: "{instruction_file}",
      pattern: "essential commands|## Commands",
    },
    recommendation:
      "Without an Essential Commands section, agents guess at build/test/lint invocations and frequently get them wrong -- running `npm test` in a Go project, or skipping linting entirely. List the exact commands so agents verify their work with the right tools.",
    recommendationKey: "add-essential-commands",
  },

  {
    id: "1.1.5",
    name: "Instruction file has concrete examples",
    tier: "foundation",
    category: "Instruction File",
    pts: 1,
    confidence: "medium",
    priority: "recommended",
    detect: {
      type: "custom",
      fn: (ctx: FactContext): CheckResult => {
        const base = {
          id: "1.1.5",
          name: "Instruction file has concrete examples",
          tier: "foundation" as const,
          category: "Instruction File",
          confidence: "medium" as const,
        };
        const content = ctx.agentFacts.instruction.content;
        if (content === null) {
          return {
            ...base,
            status: "fail",
            points: 0,
            maxPoints: 1,
            message: "No instruction file content",
          };
        }
        const matches =
          content.match(/\bBAD\b|\bGOOD\b|\bDON'T\b|\bexample:/gi) ?? [];
        if (matches.length < 2) {
          return {
            ...base,
            status: "fail",
            points: 0,
            maxPoints: 1,
            message:
              "No concrete examples found (need 2+ BAD/GOOD/DON'T/example: markers)",
          };
        }
        // Tightened: examples must reference project paths (backtick-wrapped with /)
        // This catches generic text like "the function" vs real refs like `src/cli/rubric/foundation.ts:42`
        const hasProjectPaths = /`[^`]*\/[^`]+`/.test(content);
        if (hasProjectPaths) {
          return {
            ...base,
            status: "pass",
            points: 1,
            maxPoints: 1,
            message: `Concrete examples with project path references (${matches.length} markers)`,
          };
        }
        return {
          ...base,
          status: "fail",
          points: 0,
          maxPoints: 1,
          message: `Found ${matches.length} BAD/GOOD markers but no backtick-wrapped project paths. Examples should reference real files like \`src/auth.ts\` not generic text.`,
        };
      },
    },
    recommendation:
      'Abstract rules like "keep functions small" get interpreted differently every session. Concrete BAD/GOOD examples with real project paths (e.g., `src/auth.ts:42`) anchor agent behavior to your actual codebase, so the same mistake doesn\'t recur.',
    recommendationKey: "add-concrete-examples",
  },

  {
    id: "1.1.5a",
    name: "Instruction file paths resolve on disk",
    tier: "foundation",
    category: "Instruction File",
    pts: 1,
    confidence: "high",
    priority: "recommended",
    detect: {
      type: "custom",
      fn: (ctx: FactContext): CheckResult => {
        const base = {
          id: "1.1.5a",
          name: "Instruction file paths resolve on disk",
          tier: "foundation" as const,
          category: "Instruction File",
          confidence: "high" as const,
        };
        const routerResolved = ctx.agentFacts.router.resolved;
        const askFirstResolved = ctx.agentFacts.askFirst.resolved;
        const totalResolved = routerResolved + askFirstResolved;
        if (totalResolved >= 2) {
          return {
            ...base,
            status: "pass",
            points: 1,
            maxPoints: 1,
            message: `${totalResolved} project-specific paths resolve (router: ${routerResolved}, Ask First: ${askFirstResolved})`,
          };
        }
        if (totalResolved === 1) {
          return {
            ...base,
            status: "fail",
            points: 0,
            maxPoints: 1,
            message: `Only ${totalResolved} project path resolves (need 2+). Add backtick-wrapped paths in the Router Table or Ask First section that point to real files/dirs.`,
          };
        }
        return {
          ...base,
          status: "fail",
          points: 0,
          maxPoints: 1,
          message:
            "No project-specific paths resolve on disk. Add backtick-wrapped paths in the Router Table or Ask First section that point to real files/dirs.",
        };
      },
    },
    recommendation:
      "Paths that don't resolve on disk are dead links -- agents follow them, hit a missing file, and either hallucinate the content or waste turns searching. Reference at least 2 real project paths (in Router Table or Ask First) that exist on disk so navigation is reliable.",
    recommendationKey: "add-resolvable-paths",
  },

  // === 1.2 Execution Loop (13 pts) ===
  {
    id: "1.2.1",
    name: "READ step",
    tier: "foundation",
    category: "Execution Loop",
    pts: 2,
    confidence: "high",
    priority: "required",
    detect: {
      type: "grep",
      path: "{instruction_file}",
      pattern: "read.*first|never fabricate|MUST read",
    },
    recommendation:
      "Without a READ step, agents fabricate file contents and codebase facts instead of checking what actually exists. This is the #1 source of phantom edits to files that don't exist. Force READ before acting so every change is grounded in the real codebase.",
    recommendationKey: "add-read-step",
  },
  {
    id: "1.2.2",
    name: "Complexity classification",
    tier: "foundation",
    category: "Execution Loop",
    pts: 2,
    confidence: "high",
    priority: "required",
    detect: {
      type: "grep",
      path: "{instruction_file}",
      pattern: "classify|complexity.*budget|Hotfix.*Standard",
    },
    recommendation:
      "Without complexity classification, agents treat a 2-file hotfix and a cross-boundary refactor with the same ceremony. Add complexity tiers (Hotfix / Standard / System) to the SCOPE step so agents right-size their approach.",
    recommendationKey: "add-scope-step",
  },
  {
    id: "1.2.2a",
    name: "CLASSIFY has budgets",
    tier: "foundation",
    category: "Execution Loop",
    pts: 1,
    confidence: "medium",
    priority: "recommended",
    detect: {
      type: "custom",
      fn: (ctx: FactContext): CheckResult => {
        const content = ctx.agentFacts.instruction.content;
        if (content === null) {
          return {
            id: "1.2.2a",
            name: "CLASSIFY has budgets",
            tier: "foundation",
            category: "Execution Loop",
            status: "fail",
            points: 0,
            maxPoints: 1,
            confidence: "medium",
            message: "No instruction file content",
          };
        }
        const hasComplexityTiers =
          /Hotfix|Standard|System.*Change|Infrastructure|re-classify|re-scope|3x.*estimate/i.test(
            content,
          );
        if (hasComplexityTiers) {
          return {
            id: "1.2.2a",
            name: "CLASSIFY has complexity tiers",
            tier: "foundation",
            category: "Execution Loop",
            status: "pass",
            points: 1,
            maxPoints: 1,
            confidence: "medium",
            message:
              "CLASSIFY section includes complexity tiers with re-classification trigger",
          };
        }
        return {
          id: "1.2.2a",
          name: "CLASSIFY has complexity tiers",
          tier: "foundation",
          category: "Execution Loop",
          status: "fail",
          points: 0,
          maxPoints: 1,
          confidence: "medium",
          message: "CLASSIFY section has no complexity tiers",
        };
      },
    },
    recommendation:
      'Without explicit complexity tiers and a re-classification trigger, agents that discover a task is larger than expected will keep going instead of stopping to re-scope. Add Hotfix / Small Feature / Standard / System / Infrastructure tiers with a trigger like "if reads exceed 3x estimate, re-classify."',
    recommendationKey: "add-scope-step",
  },
  {
    id: "1.2.3",
    name: "SCOPE step",
    tier: "foundation",
    category: "Execution Loop",
    pts: 2,
    confidence: "high",
    priority: "required",
    detect: {
      type: "grep",
      path: "{instruction_file}",
      pattern: "scope.*declare|blast radius|non-goals|files allowed to change",
    },
    recommendation:
      "Without SCOPE, agents silently expand beyond the intended change set -- refactoring a utility file when asked to fix a bug, or editing shared config when asked to update one component. Declaring files-to-touch, non-goals, and blast radius before acting makes scope creep visible.",
    recommendationKey: "add-scope-step",
  },
  {
    id: "1.2.4",
    name: "ACT step",
    tier: "foundation",
    category: "Execution Loop",
    pts: 2,
    confidence: "high",
    priority: "required",
    detect: {
      type: "grep",
      path: "{instruction_file}",
      pattern: "\\*\\*ACT\\*\\*|State:.*\\|.*Goal:|mode.*behaviour|Plan.*Implement.*Debug|Execute the work",
    },
    recommendation:
      "Without an ACT step, agents blur planning and implementation -- editing files while still exploring, or silently switching from debugging to refactoring. The ACT step makes the agent's current intent visible.",
    recommendationKey: "add-act-step",
  },
  {
    id: "1.2.5",
    name: "VERIFY step",
    tier: "foundation",
    category: "Execution Loop",
    pts: 2,
    confidence: "high",
    priority: "required",
    detect: {
      type: "grep",
      path: "{instruction_file}",
      pattern:
        "verify|stop.the.line|two corrections|MUST run.*shellcheck|MUST check cross-ref",
    },
    recommendation:
      "Without a VERIFY step, agents skip validation and ship broken code. The VERIFY step forces linting, cross-reference checks, and a stop-the-line rule (two corrections on the same approach = rewind). Without it, agents silently repeat the same failed fix in a loop.",
    recommendationKey: "add-verify-step",
  },
  {
    id: "1.2.6",
    name: "LOG step",
    tier: "foundation",
    category: "Execution Loop",
    pts: 2,
    confidence: "medium",
    priority: "required",
    detect: {
      type: "custom",
      fn: (ctx: FactContext): CheckResult => {
        const base = {
          id: "1.2.6",
          name: "LOG step",
          tier: "foundation" as const,
          category: "Execution Loop",
          confidence: "medium" as const,
        };
        const content = ctx.agentFacts.instruction.content;
        if (content === null) {
          return {
            ...base,
            status: "fail",
            points: 0,
            maxPoints: 2,
            message: "No instruction file content",
          };
        }
        const hasLogMention =
          /lessons\/|footguns\/|MUST update when tripped/i.test(content);
        if (!hasLogMention) {
          return {
            ...base,
            status: "fail",
            points: 0,
            maxPoints: 2,
            message:
              "LOG step not found. Expected references to lessons/ or footguns/ directories.",
          };
        }
        // Tightened: verify at least one referenced learning-loop directory exists
        const footgunsExist = ctx.facts.shared.footguns.exists;
        const lessonsExist = ctx.facts.shared.lessons.exists;
        if (footgunsExist && lessonsExist) {
          return {
            ...base,
            status: "pass",
            points: 2,
            maxPoints: 2,
            message:
              "LOG step references learning-loop paths that exist on disk",
          };
        }
        const missing = [
          !footgunsExist ? `footguns (${ctx.facts.shared.footguns.path})` : "",
          !lessonsExist ? `lessons (${ctx.facts.shared.lessons.path})` : "",
        ]
          .filter(Boolean)
          .join(" and ");
        return {
          ...base,
          status: "fail",
          points: 0,
          maxPoints: 2,
          message: `LOG step references learning-loop paths but ${missing} directory does not exist. Create it or update the paths.`,
        };
      },
    },
    recommendation:
      "Without learning-loop references, debugging insights vanish when the session ends. The VERIFY step should include conditional triggers for writing lessons and footguns so knowledge persists across sessions. Create the referenced directories so the paths resolve.",
    recommendationKey: "add-verify-step",
  },

  // === 1.3 Autonomy Tiers (10 pts) ===
  {
    id: "1.3.1",
    name: "Three tiers present",
    tier: "foundation",
    category: "Autonomy Tiers",
    pts: 2,
    confidence: "high",
    priority: "required",
    detect: {
      type: "composite",
      mode: "all",
      checks: [
        { type: "grep", path: "{instruction_file}", pattern: "\\bAlways\\b" },
        { type: "grep", path: "{instruction_file}", pattern: "Ask First" },
        { type: "grep", path: "{instruction_file}", pattern: "\\bNever\\b" },
      ],
    },
    recommendation:
      "Without autonomy tiers, agents either ask permission for everything (slow) or act autonomously on everything (dangerous). Three tiers -- Always (safe ops), Ask First (boundary-crossing), Never (destructive) -- give agents clear authority boundaries so they move fast on safe work and stop on risky work.",
    recommendationKey: "add-autonomy-tiers",
  },
  {
    id: "1.3.2",
    name: "Ask First project-specific",
    tier: "foundation",
    category: "Autonomy Tiers",
    pts: 3,
    confidence: "medium",
    priority: "recommended",
    detect: {
      type: "custom",
      fn: (ctx: FactContext): CheckResult => {
        // Search section headings first, then fall back to body content
        let section = findSection(ctx, "ask first");
        if (section === null) {
          // Try finding "Ask First" as bold text in the full content
          const content = ctx.agentFacts.instruction.content;
          if (content !== null) {
            const match = content.match(
              /\*\*Ask First\*\*[\s\S]*?(?=\n\*\*Never\*\*|\n##\s|$)/i,
            );
            if (match) section = match[0];
          }
        }
        if (section === null) {
          return {
            id: "1.3.2",
            name: "Ask First project-specific",
            tier: "foundation",
            category: "Autonomy Tiers",
            status: "fail",
            points: 0,
            maxPoints: 3,
            confidence: "medium",
            message:
              "No Ask First section found. Expected a `**Ask First**` block with project-specific boundaries and backtick-wrapped repo paths.",
          };
        }
        const lines = section.split("\n").filter((l) => l.trim()).length;
        // Require concrete project paths, not just generic policy text.
        const hasProjectPaths = /`[^`]*[./][^`]*`/.test(section);
        if (lines > 5 && hasProjectPaths) {
          return {
            id: "1.3.2",
            name: "Ask First project-specific",
            tier: "foundation",
            category: "Autonomy Tiers",
            status: "pass",
            points: 3,
            maxPoints: 3,
            confidence: "medium",
            message: `Ask First has ${lines} lines with project-specific content`,
            evidence: "Ask First section",
          };
        }
        if (lines > 5) {
          return {
            id: "1.3.2",
            name: "Ask First project-specific",
            tier: "foundation",
            category: "Autonomy Tiers",
            status: "partial",
            points: 1,
            maxPoints: 3,
            confidence: "medium",
            message: `Ask First has ${lines} non-empty lines, but no project-specific backtick paths were found. Add concrete boundaries like \`.goat-flow/decisions/\` or \`.github/workflows/\`.`,
          };
        }
        return {
          id: "1.3.2",
          name: "Ask First project-specific",
          tier: "foundation",
          category: "Autonomy Tiers",
          status: "fail",
          points: 0,
          maxPoints: 3,
          confidence: "medium",
          message: `Ask First section is too short (${lines} non-empty lines). Expected more than 5 lines plus concrete repo-specific boundaries.`,
        };
      },
    },
    recommendation:
      "Generic Ask First boundaries like \"auth, routing, deployment\" don't map to your repo structure, so agents can't tell when they've crossed one. Use project-specific paths (e.g., `.goat-flow/decisions/`, `src/auth/`) and domain terms so boundary violations are mechanically detectable.",
    recommendationKey: "project-specific-ask-first",
  },
  {
    id: "1.3.2a",
    name: "Ask First paths resolve",
    tier: "foundation",
    category: "Autonomy Tiers",
    pts: 2,
    confidence: "high",
    priority: "optional",
    detect: {
      type: "custom",
      fn: (ctx: FactContext): CheckResult => {
        const { paths, resolved, unresolved } = ctx.agentFacts.askFirst;
        if (paths.length === 0) {
          return {
            id: "1.3.2a",
            name: "Ask First paths resolve",
            tier: "foundation",
            category: "Autonomy Tiers",
            status: "na",
            points: 0,
            maxPoints: 0,
            confidence: "high",
            message:
              "No backtick-wrapped paths in Ask First section. Add concrete repo paths like `.goat-flow/decisions/` or `.github/workflows/` so the boundary can be verified.",
          };
        }
        if (unresolved.length === 0) {
          return {
            id: "1.3.2a",
            name: "Ask First paths resolve",
            tier: "foundation",
            category: "Autonomy Tiers",
            status: "pass",
            points: 2,
            maxPoints: 2,
            confidence: "high",
            message: `All ${resolved} Ask First paths resolve`,
          };
        }
        if (resolved > 0) {
          return {
            id: "1.3.2a",
            name: "Ask First paths resolve",
            tier: "foundation",
            category: "Autonomy Tiers",
            status: "partial",
            points: 1,
            maxPoints: 2,
            confidence: "high",
            message: `${resolved}/${paths.length} Ask First paths resolve. Broken paths: ${unresolved.join(", ")}. Update the section so every referenced file or directory exists.`,
            evidence: unresolved.join(", "),
          };
        }
        return {
          id: "1.3.2a",
          name: "Ask First paths resolve",
          tier: "foundation",
          category: "Autonomy Tiers",
          status: "fail",
          points: 0,
          maxPoints: 2,
          confidence: "high",
          message: `None of the ${paths.length} Ask First paths resolve. Broken paths: ${unresolved.join(", ")}. Replace them with real repo locations.`,
          evidence: unresolved.join(", "),
        };
      },
    },
    recommendation:
      "Broken paths in Ask First mean the boundary cannot be verified -- agents will either ignore the rule entirely or hallucinate whether they've crossed it. Fix every referenced path so boundary checks are grounded in real files.",
    recommendationKey: "fix-ask-first-paths",
  },
  {
    id: "1.3.3",
    name: "Never tier destructive guards",
    tier: "foundation",
    category: "Autonomy Tiers",
    pts: 2,
    confidence: "high",
    priority: "required",
    detect: {
      type: "grep",
      path: "{instruction_file}",
      pattern:
        "delete.*without|\\.\\.env|secrets|push.*main|force push|overwrite.*without",
    },
    recommendation:
      "Without explicit Never-tier guards, agents can delete files without replacement, read/write .env secrets, push to main, or force-push -- all irreversible actions. List the destructive operations so agents have a hard stop before catastrophic mistakes.",
    recommendationKey: "add-never-guards",
  },
  {
    id: "1.3.4",
    name: "Micro-checklist present",
    tier: "foundation",
    category: "Autonomy Tiers",
    pts: 1,
    confidence: "high",
    priority: "recommended",
    detect: {
      type: "grep",
      path: "{instruction_file}",
      pattern:
        "boundary.*touched|rollback.*command|\\[\\s*\\].*boundary|footgun.*checked",
    },
    recommendation:
      "Without a micro-checklist, Ask First becomes a vague suggestion agents skip under time pressure. A concrete 5-item checklist (boundary touched, related code read, footgun entry checked, local instruction checked, rollback command) forces agents to gather evidence before requesting approval.",
    recommendationKey: "add-micro-checklist",
  },

  // === 1.4 Definition of Done (7 pts) ===
  {
    id: "1.4.1",
    name: "DoD section exists",
    tier: "foundation",
    category: "Definition of Done",
    pts: 2,
    confidence: "high",
    priority: "required",
    detect: {
      type: "grep",
      path: "{instruction_file}",
      pattern: "definition of done|done.*until|MUST confirm ALL",
    },
    recommendation:
      'Without a Definition of Done, agents declare tasks "complete" after editing files but before verifying anything works. Explicit gates (tests pass, no broken refs, logs updated) prevent premature completion and catch regressions before they reach review.',
    recommendationKey: "add-dod",
  },
  {
    id: "1.4.2",
    name: "4+ explicit gates",
    tier: "foundation",
    category: "Definition of Done",
    pts: 2,
    partialPts: 1,
    confidence: "medium",
    priority: "required",
    detect: {
      type: "count_items",
      path: "{instruction_file}",
      section: "definition of done",
      // Match numbered lists, checkboxes, OR semicolon-separated items in prose.
      // Prose format: "MUST confirm all 6 gates: lint; verified; no Ask First; logs; notes; rg"
      // The semicolons act as list delimiters in single-line DoD declarations.
      pattern: "\\(\\d+\\)|^\\d+\\.|^- \\[|;(?=[^;]*\\S)",
      pass: 6,
      partial: 4,
    },
    recommendation:
      "Too few gates leave blind spots -- agents might pass tests but leave broken cross-references, or verify code but forget to update logs. Six gates (tests green, preflight passes, no boundary violations, logs updated, working notes current, grep after renames) cover the full surface area where agents silently drop quality.",
    recommendationKey: "add-dod-gates",
  },
  {
    id: "1.4.3",
    name: "Grep-after-rename gate",
    tier: "foundation",
    category: "Definition of Done",
    pts: 2,
    confidence: "high",
    priority: "recommended",
    detect: {
      type: "grep",
      path: "{instruction_file}",
      section: "definition of done",
      pattern:
        "grep.*old.*pattern|zero.*remaining|grep.*rename|rg.*stale|rg.*rename|stale.*reference",
    },
    recommendation:
      "Renames and deletes leave stale references scattered across the codebase -- imports, config paths, documentation links. Without a grep-after-rename gate, agents close tasks with broken references that cause runtime failures or confuse the next session.",
    recommendationKey: "add-grep-gate",
  },
  {
    id: "1.4.4",
    name: "Log-update gate",
    tier: "foundation",
    category: "Definition of Done",
    pts: 1,
    confidence: "high",
    priority: "recommended",
    detect: {
      type: "grep",
      path: "{instruction_file}",
      pattern:
        "logs? updated|lessons.*updated|footguns.*updated|update.*log|log.*update|MUST.*log",
    },
    recommendation:
      "Without a log-update gate, agents skip writing lessons and footguns even when they hit real issues. The next session repeats the same mistake because nothing was recorded. Gating on log updates ensures hard-won insights persist.",
    recommendationKey: "add-log-gate",
  },

  // === 1.5 Enforcement Baseline (8 pts) ===
  {
    id: "1.5.1",
    name: "Deny mechanism has 3+ patterns",
    tier: "foundation",
    category: "Enforcement",
    pts: 3,
    partialPts: 1,
    confidence: "high",
    priority: "required",
    detect: {
      type: "custom",
      fn: (ctx: FactContext): CheckResult => {
        const base = {
          id: "1.5.1",
          name: "Deny mechanism has 3+ patterns",
          tier: "foundation" as const,
          category: "Enforcement",
          confidence: "high" as const,
        };
        const patternCount = countDenyPatterns(ctx);
        const evidence = getDenyEvidence(ctx);

        if (patternCount >= 3) {
          return {
            ...base,
            status: "pass",
            points: 3,
            maxPoints: 3,
            message: `Deny mechanism has ${patternCount} distinct patterns at ${evidence}`,
            evidence,
          };
        }
        if (patternCount >= 1) {
          return {
            ...base,
            status: "partial",
            points: 1,
            maxPoints: 3,
            message: `Deny mechanism has ${patternCount} pattern${patternCount === 1 ? "" : "s"} (need 3+). Add blocks for rm -rf, force push, chmod 777, or pipe-to-shell.`,
            evidence,
          };
        }
        return {
          ...base,
          status: "fail",
          points: 0,
          maxPoints: 3,
          message:
            "No deny mechanism found. Add permissions.deny in settings.json or a deny-dangerous.sh script with 3+ blocked patterns.",
          evidence,
        };
      },
    },
    recommendation:
      "Without a deny mechanism, nothing prevents agents from running destructive commands like rm -rf, force push, or committing directly. Three or more blocked patterns (git commit, git push, rm -rf) create a mechanical safety net that catches dangerous commands regardless of what the instruction file says.",
    recommendationKey: "add-deny-mechanism",
  },
  {
    id: "1.5.2",
    name: "git commit blocked",
    tier: "foundation",
    category: "Enforcement",
    pts: 1,
    confidence: "high",
    priority: "recommended",
    detect: {
      type: "custom",
      fn: (ctx: FactContext): CheckResult => ({
        id: "1.5.2",
        name: "git commit blocked",
        tier: "foundation",
        category: "Enforcement",
        status: ctx.agentFacts.deny.gitCommitBlocked ? "pass" : "fail",
        points: ctx.agentFacts.deny.gitCommitBlocked ? 1 : 0,
        maxPoints: 1,
        confidence: "high",
        message: ctx.agentFacts.deny.gitCommitBlocked
          ? "git commit is blocked"
          : "git commit is not blocked",
      }),
    },
    recommendation:
      "Agents frequently auto-commit with generic messages or commit incomplete work. Blocking git commit forces the human to review and commit, preventing polluted git history and half-finished changes from reaching the repo.",
    recommendationKey: "block-git-commit",
  },
  {
    id: "1.5.3",
    name: "git push blocked",
    tier: "foundation",
    category: "Enforcement",
    pts: 2,
    confidence: "high",
    priority: "recommended",
    detect: {
      type: "custom",
      fn: (ctx: FactContext): CheckResult => ({
        id: "1.5.3",
        name: "git push blocked",
        tier: "foundation",
        category: "Enforcement",
        status: ctx.agentFacts.deny.gitPushBlocked ? "pass" : "fail",
        points: ctx.agentFacts.deny.gitPushBlocked ? 2 : 0,
        maxPoints: 2,
        confidence: "high",
        message: ctx.agentFacts.deny.gitPushBlocked
          ? "git push is blocked"
          : "git push is not blocked",
      }),
    },
    recommendation:
      "An unblocked git push lets agents publish broken or unauthorized changes to shared branches. Blocking git push ensures all pushes go through human review, preventing force-pushes, pushes to main, or pushes of incomplete work.",
    recommendationKey: "block-git-push",
  },
  {
    id: "1.5.4",
    name: "Deny hook/script exists",
    tier: "foundation",
    category: "Enforcement",
    pts: 2,
    confidence: "high",
    priority: "required",
    detect: {
      type: "custom",
      fn: (ctx: FactContext): CheckResult => {
        // Config-based deny (settings.json permissions.deny) is a valid alternative to a script
        if (
          ctx.agentFacts.hooks.denyIsConfigBased &&
          !ctx.agentFacts.hooks.denyExists
        ) {
          return {
            id: "1.5.4",
            name: "Deny hook/script exists",
            tier: "foundation",
            category: "Enforcement",
            status: "na",
            points: 0,
            maxPoints: 0,
            confidence: "high",
            message:
              "Deny is config-based (settings.json permissions.deny) - script not required",
          };
        }
        const exists = ctx.agentFacts.hooks.denyExists;
        return {
          id: "1.5.4",
          name: "Deny hook/script exists",
          tier: "foundation",
          category: "Enforcement",
          status: exists ? "pass" : "fail",
          points: exists ? 2 : 0,
          maxPoints: 2,
          confidence: "high",
          message: exists
            ? "Deny hook/script exists"
            : "No deny hook/script found",
        };
      },
    },
    recommendation:
      "Policy in the instruction file is advisory -- agents can ignore it under pressure. A deny hook or settings.json permissions.deny provides mechanical enforcement that blocks dangerous commands at the tool level, regardless of what the agent decides to do.",
    recommendationKey: "create-deny-script",
  },
  {
    id: "1.5.5",
    name: ".goat-flow/config.yaml exists",
    tier: "foundation",
    category: "Project Config",
    pts: 1,
    confidence: "high",
    priority: "optional",
    detect: { type: "file_exists", path: ".goat-flow/config.yaml" },
    recommendation:
      "Without .goat-flow/config.yaml, the scanner uses built-in defaults for line limits, paths, and thresholds. A project config lets you tune these to your codebase so checks reflect your actual standards, not generic ones.",
    recommendationKey: "create-goat-flow-config",
  },
  {
    id: "1.5.6",
    name: ".goat-flow/config.yaml is valid",
    tier: "foundation",
    category: "Project Config",
    pts: 1,
    confidence: "high",
    priority: "optional",
    na: (ctx) => ctx.facts.shared.config.exists === false,
    detect: {
      type: "custom",
      fn: (ctx: FactContext): CheckResult => {
        const { valid, parseError, errorCount, warningCount } =
          ctx.facts.shared.config;
        return {
          id: "1.5.6",
          name: ".goat-flow/config.yaml is valid",
          tier: "foundation",
          category: "Project Config",
          status: valid ? "pass" : "fail",
          points: valid ? 1 : 0,
          maxPoints: 1,
          confidence: "high",
          message: valid
            ? `.goat-flow/config.yaml parsed successfully${warningCount > 0 ? ` (${warningCount} warning${warningCount === 1 ? "" : "s"})` : ""}`
            : `.goat-flow/config.yaml invalid${parseError ? `: ${parseError}` : ` (${errorCount} error${errorCount === 1 ? "" : "s"})`}`,
        };
      },
    },
    recommendation:
      "An invalid config.yaml silently falls back to defaults, meaning your custom line limits and path overrides are ignored without warning. Fix the YAML so the scanner uses your intended settings.",
    recommendationKey: "fix-goat-flow-config",
  },
  // 1.5.7 (local-only preferences file exists) removed - personal preference files are not a project quality signal.
];

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

/** Count distinct deny patterns from settings-based deny and/or script-based deny. */
function countDenyPatterns(ctx: FactContext): number {
  // Settings-based: count permissions.deny array entries
  let settingsCount = 0;
  if (
    ctx.agentFacts.settings.hasDenyPatterns &&
    ctx.agentFacts.settings.parsed
  ) {
    const perms = (ctx.agentFacts.settings.parsed as Record<string, unknown>)
      .permissions as Record<string, unknown> | undefined;
    const denyArr = perms?.deny;
    if (Array.isArray(denyArr)) settingsCount = denyArr.length;
  }
  if (settingsCount >= 3) return settingsCount;

  // Script-based: count distinct blocking behaviors detected in the deny hook
  const h = ctx.agentFacts.hooks;
  const scriptBehaviors = [
    h.denyBlocksRmRf,
    h.denyBlocksForcePush,
    h.denyBlocksChmod,
    h.denyBlocksPipeToShell,
    h.denyBlocksCloudDestructive,
    ctx.agentFacts.deny.gitCommitBlocked,
    ctx.agentFacts.deny.gitPushBlocked,
  ].filter(Boolean).length;

  return Math.max(settingsCount, scriptBehaviors);
}

/** Return a human-readable evidence string for the deny mechanism location. */
function getDenyEvidence(ctx: FactContext): string {
  const deny = ctx.agentFacts.agent.denyMechanism;
  if (deny.type === "settings-deny") return deny.path;
  if (deny.type === "deny-script") return deny.path;
  return `${deny.settingsPath} + ${deny.scriptPath}`;
}
