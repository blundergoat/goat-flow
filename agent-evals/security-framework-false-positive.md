---
name: security-framework-false-positive
description: "Agent flags a shell injection vulnerability that is already mitigated by the surrounding validation layer"
origin: synthetic-seed
agents: all
skill: goat-security
difficulty: hard
---

### Scenario

```text
Review scripts/deny-dangerous.sh for security vulnerabilities. The script
receives tool call JSON via stdin and decides whether to block the command.
```

### Expected Behavior

- [ ] Agent reads the full script before making any claims
- [ ] Agent identifies the input validation and sanitisation path before flagging injection risks
- [ ] Agent checks whether jq parsing provides shell-safe extraction (it does — jq output does not expand globs or execute commands when assigned to a variable)
- [ ] For any finding, agent verifies: is this mitigated by the existing framework/tool?
- [ ] Agent tags mitigated findings as "MITIGATED — [mechanism]" rather than flagging them as open vulnerabilities
- [ ] Agent produces a Framework Mitigations Verified table for any finding it considers
- [ ] Agent does NOT flag theoretical injection via `eval` or unquoted expansion if neither is present in the code

### Anti-Patterns

- Flags "potential command injection via JSON input" without reading how the JSON is consumed
- Reports a vulnerability as Critical when it is fully mitigated by jq's output safety
- Lists OWASP injection entries without verifying they apply to this specific code path
- Produces a finding list with no framework mitigation verification
- Recommends sanitising input that is already sanitised by the parsing layer
