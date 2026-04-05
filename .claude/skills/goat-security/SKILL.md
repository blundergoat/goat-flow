---
name: goat-security
description: "Threat-model-driven security assessment with framework-aware verification, exploitability ranking, and concrete dependency auditing."
goat-flow-skill-version: "0.10.0"
---
# /goat-security

## Shared Conventions

### Severity & Evidence
- **Severity order:** SECURITY > CORRECTNESS > INTEGRATION > PERFORMANCE > STYLE. Order findings by severity, not by file or discovery order.
- **Evidence:** Every finding needs `file:line`. Tag as OBSERVED (directly verified in code) or INFERRED (deduced - state what direct evidence is missing). Before presenting findings, re-read each cited `file:line` to confirm accuracy. MUST NOT fabricate file paths, function names, or behaviour.

### Human Gates
- **BLOCKING GATE** - agent MUST stop and wait for human decision. Used for: scope approval, phase transitions, final output review. Do NOT auto-advance.
- **CHECKPOINT** - agent presents status and continues unless interrupted. Used for: progress reports, intermediate findings. Format: "Phase N complete. [summary]. Continuing to Phase N+1."

### Adaptive Step 0
1. Read the user's invocation for context already provided
2. For each Step 0 question: if answer is clear from context → **confirm** ("I see [answer]. Correct?"). Otherwise → **ask**
3. If ALL questions answered by invocation → condensed confirmation, proceed
4. If user says "skip Step 0" → confirm understanding, proceed

**Gate rule:** Step 0 MUST end with the agent presenting its understanding and waiting for the user before Phase 1. Auto-detect pre-fills context - it does not replace confirmation. Bare invocation = zero context = ask all structural questions and wait.

### Stuck Protocol
If 3 consecutive reads produce no new signal: (1) present what you have so far, (2) state what you were looking for and didn't find, (3) ask to redirect, narrow scope, or close.

### Ceremony Level
| Complexity | Ceremony |
|------------|----------|
| Hotfix / Small Feature | Skip: closing ceremony, flush rule, footgun annotations, goat-plan Phases 2-3 |
| Standard | Full phases, gates at major decisions |
| System / Infrastructure | Full phases + cross-boundary verification + rollback planning |

**Sub-agent mode:** GATEs become CHECKPOINTs automatically. Step 0 proceeds with auto-detected scope.

### Footgun Fast-Path
If Step 0 footgun check matches a known trap: (1) surface match immediately, (2) offer mitigation path from the entry, (3) still require READ + VERIFY on actual files - footguns are incident records, not executable specs, (4) do NOT skip to implementation on a match alone.

### Flush Protocol
If 10+ tool calls pass without a gate/checkpoint (skip for Hotfix/Small Feature): (1) write 3-sentence status to `.goat-flow/tasks/handoff.md` (what, where, next), (2) if working from a plan/milestone file: tick all completed checkboxes NOW before continuing, (3) ask: continue, compact, or redirect? Counter resets at every BLOCKING GATE, CHECKPOINT, or human message. Handoff file is transient - do not commit.

### Learning Loop
After completing the skill, check if this run uncovered anything worth logging:
- Behavioural mistake → add `## Lesson:` or `## Pattern:` entry to relevant category bucket in `ai-docs/lessons/` or `.goat-flow/lessons/`
- Architectural trap with `file:line` evidence → add `## Footgun:` entry to relevant category bucket in `ai-docs/footguns/` or `.goat-flow/footguns/`
- Route team-wide entries to `ai-docs/`; session-only entries to `.goat-flow/`
- Match entry format to existing entries in the target bucket file. Do not append to a monolithic log or directory README.

### Recovery
When a skill fails mid-execution (context limit, sub-agent dies, tool error):
- Partial completion → identify last completed step (last `[x]` checkbox), resume from next
- Missing artifacts → return to the step that generates them, re-execute
- User wants restart → archive current output to handoff, re-run from Step 0
- User wants to skip → document skip reason in output, proceed to closing
- Sub-agent/autonomous mode → write `.goat-flow/tasks/handoff.md` with enough context to resume

### Working Memory
For tasks exceeding 5 turns: maintain state in `.goat-flow/tasks/todo.md`. If interrupted or compacted, write `.goat-flow/tasks/handoff.md`.

### Autonomy Awareness
Before proposing actions that change files, check the instruction file's Ask First boundaries. If the proposed change crosses a boundary, flag it: "This change touches [boundary]. Proceeding requires approval per Ask First rules."

### Closing Protocol
1. If incomplete → write `.goat-flow/tasks/handoff.md` (Date, Status, Current State, Key Decisions, Errors & Corrections, Learnings, Known Risks, Next Step, Context Files)
2. Check Learning Loop for anything worth logging
3. Write session log to `.goat-flow/logs/sessions/YYYY-MM-DD-slug.md` (what happened, files changed, decisions, learnings)
4. Suggest most relevant next skill (see Chains With)

## When to Use

Use when assessing security posture: before deployment, after adding auth/input
handling, when touching secrets/credentials, or for a security-focused audit.

**NOT this skill:**
- General code quality sweep → /goat-review (audit mode)
- Reviewing a specific diff for issues → /goat-review
- Diagnosing a specific vulnerability → /goat-debug
- Understanding code before securing it → /goat-debug (investigate mode)

## Step 0 - Gather Context

**Structural questions (always ask or confirm):**
1. Which component or area? (or I'll scan the full project)
2. What's the deployment context? (user-facing web app, internal tool, CLI, library, API)
3. Any specific threat concern? (injection, auth bypass, data exposure - or "general audit")

**Illustrative questions (adapt):**
4. What auth boundaries exist? (dashboard server has no auth, CLI runs locally, no user-facing auth)
5. Any known vulnerabilities to skip? (e.g., dashboard runs on localhost only, no external API calls)
6. What framework are you using? (I'll check its built-in security features in Phase 2)

**Escape hatch:** If the user says "just scan everything" or provides minimal info, auto-detect framework from package files and run a broad threat surface scan.

**Auto-detect:** Read package.json/composer.json/go.mod to identify framework.
Present: "This is a [framework] project. I'll check [framework]'s built-in
security features during verification."

**Footgun check:** If `ai-docs/footguns/` or `.goat-flow/footguns/` exists, read entries mentioning the target area from both locations. If a match is found, present it: "This area has a known issue: [footgun]. Relevant?"

**Contradiction check:** If the user's stated complexity doesn't match the actual scope, flag it:
- "hotfix" but 5+ files affected → likely Standard or System
- "small feature" but crosses 3+ boundaries → likely System
- "quick test" but 20+ functions in target → warn scope is larger than implied
Surface the mismatch, suggest re-classification. Don't silently proceed.

**Before proceeding:** present what you know (threat model, framework, auth boundaries) and what you still need. Wait for the user to confirm before entering Phase 1.

## Phase 1 - Threat Surface Scan

Scan against the checklist below. **Skip categories that don't apply** based
on Step 0 threat model (a CLI tool doesn't need CORS/CSP checks).

| Category | Check | Skip If | Example |
|----------|-------|---------|---------|
| Input validation | User input reaches backend without sanitization | No user input (library) | `req.body.name` passed directly to SQL |
| Auth/authz | Missing or bypassable authentication on sensitive routes | No HTTP endpoints | Session token in URL, missing CSRF on POST |
| Secret handling | Hardcoded secrets, .env committed, secrets in logs | No secrets in codebase | API key in source, token in error message |
| SQL injection | User input in raw queries without parameterization | No database (goat-flow has none) | `db.query("SELECT * FROM users WHERE id=" + id)` |
| XSS | User input rendered without escaping | No HTML output | `innerHTML = userInput`, unescaped template |
| Command injection | User input in shell commands | No shell execution | `exec("convert " + filename)`, unsanitized args |
| Path traversal | User input in file paths | No file system access | `fs.readFile(basePath + userInput)` |
| Dependency CVEs | Known vulnerabilities in dependencies | - | Run audit command below |
| CORS/CSP | Misconfigured cross-origin policies | No HTTP server | `Access-Control-Allow-Origin: *` |
| Permission escalation | Role/privilege checks missing or bypassable | Single-role system (goat-flow CLI is single-user) | Admin routes without role check |

**Dependency audit commands:**
```bash
npm audit              # Node.js (goat-flow uses npm)
```

Log every finding with `file:line` evidence.

## Phase 2 - Framework-Aware Verification

**THIS IS THE KEY DIFFERENTIATOR.** For EACH Phase 1 finding, check if the
framework already mitigates it. Attempt to DISPROVE each finding - the adversarial
framing catches more false positives than "check if it's handled."

**Framework verification examples (goat-flow stack):**

| Component | Feature | What it mitigates | How to verify |
|-----------|---------|-------------------|---------------|
| Node.js `http` | localhost-only binding | Remote access to dashboard | Check `server.listen()` binds to `127.0.0.1`, not `0.0.0.0` |
| TypeScript | Strict mode | Type confusion, null errors | Check `tsconfig.json` has `strict: true` |
| Bash scripts | `shellcheck` linting | Injection, quoting bugs, globbing | Run `shellcheck scripts/*.sh` - zero warnings |
| File I/O | Path validation | Path traversal in scanner/facts | Check user-supplied paths are validated before `fs.readFile` |
| Dashboard | Static HTML+JS | XSS via injected content | Check no `innerHTML` with unsanitized data in `src/dashboard/` |

**Verification protocol:**
For each finding: Is the mitigation (a) installed, (b) configured, (c) applied
to the specific route/endpoint? Flag partial mitigation: "helmet() is installed
but `contentSecurityPolicy` is disabled."

Remove confirmed false positives. Flag partial mitigations as findings.

**BLOCKING GATE:** Present verified findings. Offer:
(a) verify a specific finding against the framework
(b) check a different attack surface
(c) test an edge case
(d) proceed to ranking

## Phase 3 - Exploitability Ranking

Rank verified findings by exploitability, not just severity:

- **Critical:** Exploitable without authentication. Immediate action required.
- **High:** Exploitable with low-privilege access. Should fix before deployment.
- **Medium:** Exploitable with specific conditions or chained with another issue.
- **Low:** Theoretical risk, mitigated by other controls or very hard to exploit.

For each **Critical** and **High** finding, write a one-sentence attack scenario:
"An [attacker profile] can [action] via [vector], resulting in [impact]."

Example: "An unauthenticated user can extract the users table by submitting
`' OR 1=1--` in the search field at `src/api/search.ts:42`."

## Phase 4 - Self-Check

Re-read each cited `file:line` for Critical and High findings.
- Does the code actually do what the finding claims?
- Did the framework verification in Phase 2 actually check the right thing?
- Is the attack scenario realistic given the deployment context?

Remove findings that don't survive re-verification.

**BLOCKING GATE:** Present final report using the Output Format template below.

---

## Compliance Mode

<!-- EVOLVING: This mode will be expanded as compliance standards are added -->

Activated when Step 0 identifies a regulatory compliance concern (HIPAA, GDPR, SOC2, PCI-DSS).

### Phase C1 - Regulation Detection

Identify which regulations apply from project context:
- HIPAA: PHI/healthcare data, patient records, health APIs
- GDPR: EU user data, consent flows, data subject rights
- SOC2: Enterprise SaaS, audit logging, access controls
- PCI-DSS: Payment processing, card data, tokenization

If unclear, ask: "Which regulatory framework applies? (HIPAA, GDPR, SOC2, PCI-DSS, or tell me more)"

Load relevant coding standards if they exist in the project's coding standards directory.

### Phase C2 - Compliance Scan

For each applicable regulation, check against its core requirements using the Phase 1 threat surface categories as a base. Add regulation-specific checks:
- **HIPAA:** minimum necessary principle, tenant scoping, audit trail, PHI in logs (see `workflow/coding-standards/security/phi-compliance.md` for reference)
- **GDPR:** consent mechanisms, data subject access/deletion, data processing agreements, cross-border transfer
- **SOC2:** access control logging, change management, incident response procedures
- **PCI-DSS:** cardholder data isolation, encryption at rest/transit, key management

Log findings with `file:line` evidence and regulation citation.

### Phase C3 - Gap Report

Present compliance gaps ordered by risk:
- **Non-compliant:** Direct violation of a regulatory requirement. Cite the specific regulation clause.
- **Partially compliant:** Implementation exists but is incomplete or misconfigured.
- **Not assessed:** Requires access/context the agent doesn't have (e.g., infrastructure config, vendor agreements).

**BLOCKING GATE:** Present compliance report. Offer:
(a) drill into a specific finding
(b) check a different regulation
(c) proceed to exploitability ranking (Phase 3) for technical findings
(d) close

---

## Common Failure Modes

1. **Generic OWASP checklist** - agent runs through web categories on a CLI tool. The skip conditions in Phase 1 prevent this.
2. **False positives from framework ignorance** - agent flags "no input sanitization" in a Rails app where strong params handle it. Phase 2 catches this.
3. **Missing dependency audit** - agent scans code but skips `npm audit`. The concrete commands in Phase 1 prevent this.

## Constraints

<!-- FIXED: Do not adapt these -->
- MUST NOT flag framework-mitigated issues as vulnerabilities
- MUST include attack scenario for Critical and High findings
- MUST run dependency audit using project's package manager
- MUST skip irrelevant categories based on threat model
- MUST NOT fabricate file paths or function names
- MUST re-verify Critical and High findings before presenting

## Output Format

```markdown
## TL;DR
<!-- 3 sentences: threat model, key findings, posture assessment -->

## Threat Surface
| Category | Status | Skip Reason |
|----------|--------|-------------|
| Input validation | Scanned / Skipped | [if skipped: why] |
| Auth/authz | ... | ... |
| Secret handling | ... | ... |
| SQL injection | ... | ... |
| XSS | ... | ... |
| Command injection | ... | ... |
| Path traversal | ... | ... |
| Dependency CVEs | ... | ... |
| CORS/CSP | ... | ... |
| Permission escalation | ... | ... |

## Findings (by exploitability)

### Critical (exploitable without auth)
- **[title]** - `file:line`
  **Attack scenario:** An [attacker] can [action] via [vector], resulting in [impact]
  **Framework mitigation:** [not mitigated | mitigated by X - downgraded]

### High / Medium / Low

## Framework Mitigations Verified
| Feature | Installed | Configured | Applied to routes |
|---------|-----------|------------|-------------------|

## What I Didn't Check
<!-- Threat surfaces skipped and why -->

## Dependency Audit
<!-- Output of npm audit / pip-audit / cargo audit / etc. -->
```

## Chains With

- /goat-review - security findings feed into change review
- /goat-debug - specific vulnerability needs deeper diagnosis
- /goat-review - security scan reveals broader quality issues → audit mode

**Handoff shape:** `{threat_model, findings_by_exploitability, framework_mitigations, dependency_audit_results}`
