# Step 06 - Final Verification

The setup gate is: `goat-flow audit . --agent {agent}` passes and `goat-flow audit . --agent {agent} --harness` passes. The remaining checks below are agent-driven verification steps that improve quality but are not enforced by the auditor.

## Audit (required gate)

Run both required audit commands and fix all failures until they pass:

```bash
goat-flow audit . --agent {agent}
goat-flow audit . --agent {agent} --harness
```

The `--agent` flag scopes the audit to one agent's surfaces: it checks that agent's instruction file, skills directory, hooks, and settings. It does NOT check other agents' files. For multi-agent projects, run the audit once per agent.

The audit validates structural requirements: required files/dirs exist, config parses, skills installed with version tags, hooks present, deny patterns registered. It does NOT validate content quality (evidence citations, instruction-file specificity, duplicate surfaces). The checks below cover those content concerns.

`goat-flow quality` is optional - it generates an agent-driven review prompt but is not required for setup completion. `goat-flow audit --harness` adds structural installation checks for 5 concerns (context, constraints, verification, recovery, feedback loop) and is part of setup completion. Harness results contribute to the overall audit status - a harness failure is an audit failure. Recovery is milestone/session-log based; missing task content in a fresh install is normal, while stale recovery paths or missing required files should be fixed.

## Manual verification (recommended, not gated by audit)

**If a check cannot be fixed** (binary not installed locally, CI tool unavailable, platform constraint), document it as a known exception in the setup session log:
> `Known exception: check [ID] - [reason it can't be fixed]. Follow-up: [action to resolve later, or "accepted as permanent exception"].`

Do NOT silently skip unfixable checks. The exception must be visible in the session log so the next agent knows why the audit isn't passing.

## Stale-reference reconciliation

Before declaring setup complete, verify the generated surfaces do not reference dead files or old step names.

Check these surfaces:

- The instruction file
- All installed skill files
- Agent settings / hook config files
- `.goat-flow/skill-reference/README.md`
- `.goat-flow/skill-reference/skill-preamble.md`
- `.goat-flow/skill-reference/browser-use.md`
- `.goat-flow/config.yaml`

For each backtick-wrapped path or hook path:

- Verify the file or directory exists on disk
- If a file was renamed during setup, grep the old name across the repo and update every remaining reference
- For registered hook scripts, verify the file exists and has execute permissions
- Verify the instruction file version header matches the goat-flow release version
- Verify `.goat-flow/config.yaml` version matches the goat-flow release version
- For auto-seeded footgun entries, spot-check that each cited semantic anchor actually resolves to the described trap. If the anchor doesn't match (wrong function, outdated string), fix the reference

## Evidence verification

After generating footguns and the instruction file, re-verify the evidence:

1. **Semantic-anchor citations:** For every semantic anchor in generated footguns and in the instruction file's BAD/GOOD examples, grep for the cited anchor. If it doesn't resolve to the described content, fix the citation. This catches auto-seeding errors where git history evidence doesn't match current code.

2. **Router table paths:** For every path in the instruction file's Router Table, verify it exists on disk. Remove entries that point to nonexistent files or directories.

## Duplicate surface check

Fail if BOTH of these exist with independent content for the same artifact type:
- `docs/footguns.md` AND `.goat-flow/footguns/` (with real entries, not a bridge)
- `docs/lessons.md` AND `.goat-flow/lessons/` (with real entries)
- `docs/architecture.md` AND `.goat-flow/architecture.md` (both with real content)
- `docs/decisions/` AND `.goat-flow/decisions/` (both with real ADRs)

If duplicates exist, migrate the better content to the canonical `.goat-flow/` path and remove or bridge the other. The router table must NOT point to BOTH old and new surfaces for the same artifact type.

## Path integrity check

**CRITICAL:** Installed skill files must NEVER contain `workflow/` paths - those are framework-local and don't exist in target projects. Only `.goat-flow/` paths are valid.

Verify: no `workflow/` path references in any installed skill file. Every `.goat-flow/` path in installed skills must resolve on disk.

## File manifest

List every setup-owned file as one of:

- `created`
- `updated`
- `skipped`
- `failed`

Compare that manifest against `workflow/manifest.json`:

- Every `required_file` must exist
- Every `required_dir` must exist
- Any missing required surface must be fixed or called out explicitly before stopping

## Essential Commands smoke test

Read the instruction file's Essential Commands section and verify the commands are real:

- For binaries, run `command -v <binary>`
- For shell scripts, run `bash -n <script>`
- For repo commands, verify the referenced binary or script path exists before listing it as a working command

Report any command you could not verify.

## Gap report

Before finalising, add a gap report to the setup session log:

- **Areas not assessed:** [list any parts of the codebase that setup didn't read or analyse]
- **Known gaps:** [list detected gaps that setup couldn't fix, e.g., "Python source files found but no Python tests exist"]
- **Things skipped:** [list anything setup chose not to do, with reason]

For each detected language with source files but no test files, note it in the gap report. This is a setup gap, NOT a footgun - do not create a footgun entry for missing tests. The gap report goes in the session log only.

## Shared setup session log

Use one shared local continuity file: `.goat-flow/logs/sessions/YYYY-MM-DD-setup.md`

- Earlier step markers stay in this file
- Finalise it here with the audit result, any fixes made, the file manifest summary, the gap report, and remaining follow-ups
- If any note deserves to survive beyond this checkout, promote it into lessons / footguns / decisions rather than treating the session log as durable project memory
- Record time and tokens using this format:
  - `**Time:** [elapsed] | **Tokens:** [count or unavailable]`

---

**Verification gate:**
- [ ] `goat-flow audit . --agent {agent}` passes
- [ ] `goat-flow audit . --agent {agent} --harness` passes
- [ ] All required files and directories in `workflow/manifest.json` exist
- [ ] Stale-reference checks and Essential Commands smoke tests are complete
- [ ] Shared setup session log finalised with time/tokens
