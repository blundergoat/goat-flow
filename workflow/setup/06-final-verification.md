# Step 06 — Final Verification

This is the only setup gate. The goal is simple: `goat-flow scan . --agent {agent}` reaches 100% and the created file set matches `workflow/setup/reference/project-structure.json`.

## Scanner

Run `goat-flow scan . --agent {agent}` and fix all failures until 100%.

The `--agent` flag scopes the scan to one agent's surfaces: it checks that agent's instruction file, skills directory, hooks, and settings. It does NOT check other agents' files. For multi-agent projects, run the scan once per agent.

No build/test/lint requirement. No separate human checklist. Fix scanner findings until the current combined scanner reaches 100%.

**If a check cannot be fixed** (binary not installed locally, CI tool unavailable, platform constraint), document it as a known exception in the setup session log:
> `Known exception: check [ID] — [reason it can't be fixed]. Follow-up: [action to resolve later, or "accepted as permanent exception"].`

Do NOT silently skip unfixable checks. The exception must be visible in the session log so the next agent knows why the scanner isn't at 100%.

## Stale-reference reconciliation

Before declaring setup complete, verify the generated surfaces do not reference dead files or old step names.

Check these surfaces:

- The instruction file
- All installed skill files
- Agent settings / hook config files
- `.goat-flow/skill-preamble.md`
- `.goat-flow/config.yaml`

For each backtick-wrapped path or hook path:

- Verify the file or directory exists on disk
- If a file was renamed during setup, grep the old name across the repo and update every remaining reference
- For registered hook scripts, verify the file exists and has execute permissions
- Verify the instruction file version header matches the goat-flow release version
- Verify `.goat-flow/config.yaml` version matches the goat-flow release version
- For auto-seeded footgun entries, spot-check that each cited `file:line` actually shows the described trap. If the line is unrelated (a closing brace, an import, a comment), fix the reference or remove the line number

## Dual-homing check

Check for duplicate content surfaces — warn if both exist without one being a bridge to the other:
- `docs/footguns.md` AND `.goat-flow/footguns/`
- `docs/lessons.md` AND `.goat-flow/lessons/`
- `docs/architecture.md` AND `.goat-flow/architecture.md`
- `docs/code-map.md` AND `.goat-flow/code-map.md`
- `docs/decisions/` AND `.goat-flow/decisions/`

If dual-homing is found, the router table should point to one canonical location. Report which surface is canonical and which should be removed or converted to a bridge.

## File manifest

List every setup-owned file as one of:

- `created`
- `updated`
- `skipped`
- `failed`

Compare that manifest against `workflow/setup/reference/project-structure.json`:

- Every `required_file` must exist
- Every `required_dir` must exist
- Any missing required surface must be fixed or called out explicitly before stopping

## Essential Commands smoke test

Read the instruction file's Essential Commands section and verify the commands are real:

- For binaries, run `command -v <binary>`
- For shell scripts, run `bash -n <script>`
- For repo commands, verify the referenced binary or script path exists before listing it as a working command

Report any command you could not verify.

## Shared setup session log

Use one shared file: `.goat-flow/logs/sessions/YYYY-MM-DD-setup.md`

- Earlier step markers stay in this file
- Finalise it here with the scanner score, any fixes made, the file manifest summary, and remaining follow-ups
- Record time and tokens using this format:
  - `**Time:** [elapsed] | **Tokens:** [count or unavailable]`

---

**Verification gate:**
- [ ] `goat-flow scan . --agent {agent}` passes at 100%
- [ ] All required files and directories in `workflow/setup/reference/project-structure.json` exist
- [ ] Stale-reference checks and Essential Commands smoke tests are complete
- [ ] Shared setup session log finalised with time/tokens
