# Prompt: Create Copilot Bridge Files

Bridge files make `ai/instructions/` content available to GitHub Copilot via `.github/instructions/`. Copilot does not follow file references, so bridges must include the content inline.

---

## The Prompt

For each file in `ai/instructions/` that needs Copilot support, create a corresponding bridge file in `.github/instructions/`.

### Bridge File Format

```markdown
---
applyTo: "**"
---

# Base Instructions

[Paste the full content of ai/instructions/conventions.md here]
```

### applyTo Patterns by File

| Source file | Bridge file | applyTo |
|-------------|-------------|---------|
| `ai/instructions/conventions.md` | `.github/instructions/conventions.instructions.md` | `"**"` |
| `ai/instructions/frontend.md` | `.github/instructions/frontend.instructions.md` | `"src/app/**,src/components/**,*.tsx,*.ts"` |
| `ai/instructions/backend.md` | `.github/instructions/backend.instructions.md` | `"cmd/**,internal/**,pkg/**,*.go"` |
| `ai/instructions/code-review.md` | `.github/instructions/code-review.instructions.md` | `"**"` |
| `ai/instructions/git-commit.md` | `.github/git-commit-instructions.md` | `"**"` |
| `ai/instructions/security.md` | `.github/instructions/security.instructions.md` | `"**/auth/**,**/middleware/**,**/security/**"` |
| `ai/instructions/testing.md` | `.github/instructions/testing.instructions.md` | `"**/*.test.*,**/*.spec.*,**/test/**,**/*_test.go"` |

### Example: Frontend Bridge

File: `.github/instructions/frontend.instructions.md`

```markdown
---
applyTo: "src/app/**,src/components/**,*.tsx,*.ts"
---

# Frontend Instructions (React + TypeScript)

[Full content of ai/instructions/frontend.md pasted here]
```

### Rules

- `ai/instructions/` is the source of truth. Edit there first, then copy to the bridge.
- Bridge files must contain the full content inline. Copilot ignores file references.
- The `applyTo` glob controls when Copilot loads the file. Match it to the domain's file paths.
- Only create bridges for files that Copilot users need. If your team only uses Claude Code, skip bridges entirely.
- Keep bridge files in sync manually or with a script. Stale bridges are worse than no bridges.

### Sync Check

After creating bridges, verify the body content matches the source. Compare the content section (after frontmatter) against the source. Bridges will always differ in the YAML header -- check the body content matches.

```bash
# Quick check: strip frontmatter (everything between --- lines) then diff
tail -n +4 .github/instructions/conventions.instructions.md | diff - ai/instructions/conventions.md
tail -n +4 .github/instructions/frontend.instructions.md | diff - ai/instructions/frontend.md
```
