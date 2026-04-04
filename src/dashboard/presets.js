const PRESETS = [
  // === Debug & Explore ===
  { id: 'explore', name: 'Explore Codebase', desc: 'Get oriented in an unfamiliar project', prompt: '/goat onboard me to this codebase — start with an overview and ask me what I want to understand', cat: 'debug & explore' },
  { id: 'error', name: 'Diagnose Error', desc: 'Paste an error and get root cause analysis', prompt: '/goat I have an error to diagnose — ask me to paste the error message and any relevant context', cat: 'debug & explore' },
  { id: 'fix-bug', name: 'Fix Bug', desc: 'Diagnose and fix a specific bug', prompt: '/goat I have a bug to fix — ask me for the symptom, which area, and what I\'ve tried', cat: 'debug & explore' },
  { id: 'user-flow', name: 'User Flow Diagram', desc: 'Create a Mermaid flow diagram for a GitHub issue', prompt: '/goat I need a user flow diagram for a GitHub issue. Ask me about the feature, then create a Mermaid flowchart that fits in one viewport (8-12 nodes). Show what the user does and what the system does.', cat: 'debug & explore' },

  // === Review ===
  { id: 'review', name: 'Code Review', desc: 'Review changes with severity-ordered findings', prompt: '/goat review my recent changes — ask me what to focus on', cat: 'review' },
  { id: 'simplify', name: 'Simplify Code', desc: 'Improve readability without changing behavior', prompt: '/goat simplify my code — find readability improvements in the most-changed files', cat: 'review' },
  { id: 'uncommitted', name: 'Review Uncommitted', desc: 'Quick review of uncommitted changes', prompt: '/goat review my uncommitted changes', cat: 'review' },
  { id: 'review-instructions', name: 'Review Instructions', desc: 'Check if instruction files are stale', prompt: '/goat check my instruction files for staleness — look for stale paths and rules that don\'t match the current code', cat: 'review' },
  { id: 'critique', name: 'Critique GOAT Flow', desc: 'Deep honest audit of goat-flow setup quality', prompt: '/goat deeply critique the GOAT Flow setup in this project. Be thorough, honest, and specific - do NOT be polite.\n\n1. Pre-check: count .claude/skills/goat-* directories (should be 6). Note stale ones.\n2. Read CLAUDE.md, all skills, hooks, settings.json, docs, evals. List what was created and what seems like noise.\n3. Try each skill on THIS codebase: /goat (3 requests), /goat-debug (investigate a real module), /goat-plan (plan a small feature), /goat-review (review a real file), /goat-security (threat model a component), /goat-test (test plan for a module). Note what worked, what was confusing, what was useless ceremony.\n4. Critique: Is the execution loop useful or ceremonial? Are 6 skills the right number? What overlaps? What gaps? Any contradictions between files? What should be removed?\n5. Rate the system 0-100 (usefulness 0-25, signal-to-noise 0-25, adaptability 0-25, learnability 0-25). Rate the setup 0-100 (accuracy 0-25, relevance 0-25, completeness 0-25, friction 0-25).\n6. Top 5 highest-impact improvements with evidence from your testing.', cat: 'review' },

  // === Plan ===
  { id: 'plan', name: 'Plan Feature', desc: 'Plan a new feature through guided questions', prompt: '/goat plan a new feature — ask me about the problem, constraints, and what done looks like', cat: 'plan' },
  { id: 'refactor', name: 'Plan Refactor', desc: 'Plan a restructure with blast radius analysis', prompt: '/goat plan a refactor — ask me what to restructure and which files are involved', cat: 'plan' },
  { id: 'sbao', name: 'SBAO Ranking', desc: 'Critique a plan with sub-agents, rank ideas', prompt: '/goat run SBAO on my plan — ask me to paste it, then launch sub-agents to critique and rank improvement ideas', cat: 'plan' },
  { id: 'triage', name: 'Triage Ideas', desc: 'Sort ideas into excellent / okay / bad', prompt: '/goat I\'ll paste a plan — categorise every idea as excellent / okay / bad with a one-sentence justification for each. Present as a sorted table.', cat: 'plan' },

  // === Test ===
  { id: 'test', name: 'Test Plan', desc: 'Generate a 3-phase test plan for recent changes', prompt: '/goat generate a test plan for my recent changes', cat: 'test' },
  { id: 'quick-test', name: 'Quick Test', desc: 'Focused test plan for the most recent commit', prompt: '/goat quick test plan for my most recent commit', cat: 'test' },
  { id: 'qa-gaps', name: 'QA Testing Gaps', desc: 'Find code change risk and coverage gaps', prompt: '/goat I need a QA-focused gap analysis — ask me about the changes, then map what\'s tested vs what\'s not, ranked by risk', cat: 'test' },

  // === Security ===
  { id: 'security', name: 'Security Audit', desc: 'Run a threat model on this project', prompt: '/goat run a security audit — ask me about the deployment context and specific concerns', cat: 'security' },
  { id: 'dep-scan', name: 'Dependency Scan', desc: 'Scan for known CVEs and outdated packages', prompt: '/goat scan my dependencies for known CVEs and outdated packages', cat: 'security' },
  { id: 'compliance', name: 'Compliance Check', desc: 'Check against HIPAA, GDPR, SOC2, PCI-DSS', prompt: '/goat check this project for compliance issues — ask me which regulations apply', cat: 'security' },

];
