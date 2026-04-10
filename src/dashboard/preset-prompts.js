const PRESETS = [
  // === Debug ===
  {
    id: "explore",
    name: "Explore Codebase",
    desc: "Investigate an unfamiliar area",
    prompt: "/goat-debug investigate this codebase — start with an overview",
    cat: "debug",
  },
  {
    id: "error",
    name: "Diagnose Error",
    desc: "Root cause analysis from an error message",
    prompt: "/goat-debug I have an error to diagnose",
    cat: "debug",
  },
  {
    id: "fix-bug",
    name: "Fix Bug",
    desc: "Diagnose and fix a specific bug",
    prompt: "/goat-debug I have a bug to fix",
    cat: "debug",
  },

  // === Review ===
  {
    id: "review",
    name: "Code Review",
    desc: "Review changes with severity-ordered findings",
    prompt: "/goat-review my recent changes",
    cat: "review",
  },
  {
    id: "simplify",
    name: "Simplify Code",
    desc: "Improve readability without changing behavior",
    prompt: "/goat-review simplify the most-changed files",
    cat: "review",
  },
  {
    id: "uncommitted",
    name: "Review Uncommitted",
    desc: "Quick review of uncommitted changes",
    prompt: "/goat-review my uncommitted changes",
    cat: "review",
  },
  {
    id: "review-instructions",
    name: "Review Instructions",
    desc: "Check instruction files for staleness",
    prompt: "/goat-review instruction review mode on CLAUDE.md",
    cat: "review",
  },
  {
    id: "critique",
    name: "Critique GOAT Flow",
    desc: "Deep honest audit of goat-flow setup quality",
    prompt:
      "/goat deeply critique the GOAT Flow setup in this project. Be thorough, honest, and specific.\n\n1. Pre-check: count .claude/skills/goat-* directories (should be 7). Note stale ones.\n2. Read CLAUDE.md, all skills, hooks, settings.json. List what was created and what seems like noise.\n3. Try each skill on THIS codebase: /goat (3 requests), /goat-debug (investigate a real module), /goat-plan (break a feature into milestones), /goat-review (review a real file), /goat-sbao (critique a plan), /goat-security (threat model a component), /goat-test (find testing gaps).\n4. Critique: Is the execution loop useful or ceremonial? Are 7 skills the right number? What overlaps? What gaps? Any contradictions?\n5. Rate the system 0-100 (usefulness 0-25, signal-to-noise 0-25, adaptability 0-25, learnability 0-25). Rate the setup 0-100 (accuracy 0-25, relevance 0-25, completeness 0-25, friction 0-25).\n6. Top 5 highest-impact improvements with evidence.",
    cat: "review",
  },

  // === Plan ===
  {
    id: "plan",
    name: "Plan Feature",
    desc: "Walk through a feature brief",
    prompt: "/goat plan a new feature",
    cat: "plan",
  },
  {
    id: "milestones",
    name: "Break Into Milestones",
    desc: "Create milestone task files with testing gates",
    prompt: "/goat-plan break this into milestones",
    cat: "plan",
  },
  {
    id: "refactor",
    name: "Plan Refactor",
    desc: "Blast radius analysis for a restructure",
    prompt: "/goat I need to refactor — ask me what to restructure",
    cat: "plan",
  },

  // === Critique ===
  {
    id: "sbao",
    name: "SBAO Critique",
    desc: "Multi-perspective critique with 3 sub-agents",
    prompt: "/goat-sbao critique this plan",
    cat: "critique",
  },
  {
    id: "sbao-artifact",
    name: "Critique Any Artifact",
    desc: "SBAO critique of any artifact — assessment, strategy, findings",
    prompt: "/goat-sbao critique this artifact",
    cat: "critique",
  },

  // === Test ===
  {
    id: "test",
    name: "Testing Gap Analysis",
    desc: "Find undertested risks in recent changes",
    prompt: "/goat-test analyse my recent changes",
    cat: "test",
  },
  {
    id: "test-audit",
    name: "Coverage Audit",
    desc: "Audit test coverage for an existing area",
    prompt: "/goat-test audit mode",
    cat: "test",
  },
  {
    id: "test-regression",
    name: "Regression Guard",
    desc: "Lock down a bug fix with an invariant",
    prompt: "/goat-test regression guard for my recent bug fix",
    cat: "test",
  },
  {
    id: "user-flow",
    name: "User Flow Diagram",
    desc: "Mermaid flow diagram for QA handoff",
    prompt: "/goat-test I need a flow diagram for a user-visible feature",
    cat: "test",
  },

  // === Security ===
  {
    id: "security",
    name: "Security Assessment",
    desc: "Threat model for this project",
    prompt: "/goat-security run a threat model on this project",
    cat: "security",
  },
  {
    id: "dep-scan",
    name: "Dependency Scan",
    desc: "Scan for known CVEs and outdated packages",
    prompt: "/goat-security scan dependencies for known vulnerabilities",
    cat: "security",
  },
  {
    id: "security-critique",
    name: "Critique Security Findings",
    desc: "SBAO critique of a security assessment",
    prompt: "/goat-sbao critique this security assessment",
    cat: "security",
  },
];
