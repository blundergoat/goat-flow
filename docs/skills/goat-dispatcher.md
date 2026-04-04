# /goat -- Dispatcher

Route to the right skill in one step. Type `/goat` followed by what you need.

## Flow

```mermaid
flowchart TD
    Input["User input"] --> Parse["Parse intent"]
    Parse --> Match{"Matches\n1 skill?"}
    Match -->|Yes| Announce["Announce: Running /goat-X"]
    Match -->|No| Ambiguous{"Matches\n2+ skills?"}
    Ambiguous -->|Yes| Ask["Present top 2 options\nAsk user to pick"]
    Ambiguous -->|No| Simple{"Simple\nquestion?"}
    Simple -->|Yes| Answer["Answer directly"]
    Simple -->|No| Bare["Show examples\nAsk what they need"]
    Ask --> Announce
    Announce --> Override{"User says\nstop?"}
    Override -->|Yes| Ask
    Override -->|No| Execute["Load target skill's Step 0"]
```

## Intent Routing

| Keywords | Skill | Mode |
|----------|-------|------|
| bug, error, broken, crash | /goat-debug | Diagnose |
| understand, explore, onboard | /goat-debug | Investigate |
| review, PR, diff, code review | /goat-review | Standard |
| audit, quality sweep | /goat-review | Audit |
| simplify, clean up, naming | /goat-review | Simplify |
| security, vulnerability, CVE, CVEs, OWASP | /goat-security | Threat model |
| HIPAA, GDPR, compliance | /goat-security | Compliance |
| dependencies, outdated packages, supply chain | /goat-security | Dependency audit |
| plan, design, architect | /goat-plan | Plan |
| rename, refactor, restructure | /goat-plan | Refactor |
| test, coverage, test plan | /goat-test | -- |

## After Completion

The dispatcher suggests the most likely next skill based on what just finished (e.g., debug -> test to verify the fix).

**Source:** `workflow/skills/goat.md`
