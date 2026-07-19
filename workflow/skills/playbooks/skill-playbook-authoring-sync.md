---
goat-flow-reference-version: "1.14.0"
---
# Skill Playbook Authoring Sync

Use this reference when adding or materially editing a built-in goat-flow playbook.
It keeps the canonical workflow source, installed copy, discovery index, audit
registries, and manifest ownership aligned so users receive one usable artifact.

## Availability Check

This is a documentary authoring reference, not a runnable tool. Apply the
Applicability Gate below before following any repository path; no CLI probe
applies.

## Applicability Gate

Read the current project's `package.json` and confirm both conditions:

1. `name` is `@blundergoat/goat-flow`.
2. `workflow/skills/playbooks/`, `src/cli/`, and `test/` exist.

If either condition fails, this is a consumer install: stop; do not probe the framework-source paths below. Consumer-owned playbooks use the ownership route described under Boundary and do not follow the built-in registration workflow.

## Intent

A playbook is useful only when an agent can discover it, determine whether its
capability is available, apply it without inherited context, and verify the
result. Built-in playbooks therefore ship as registered source/install pairs,
not as isolated Markdown files.

## Boundary

| Change | Route |
|---|---|
| Built-in tool or capability reference | Follow this full source/install and registration workflow |
| Consumer-project-only playbook | Add the local file with `goat-flow-ownership: "user-owned"` and a README row; do not edit goat-flow's package manifest |
| Shared rule every skill inherits | `.goat-flow/skill-docs/skill-preamble.md` or `skill-conventions.md` |
| First-class workflow with modes or gates | A goat-* skill, not a playbook |
| Real failure or durable caution | Learning-loop lesson or footgun |

## Required Shape

Every standalone playbook starts with current reference-version frontmatter:

```yaml
---
goat-flow-reference-version: CURRENT_VERSION
---
```

Replace `CURRENT_VERSION` with the current quoted release value when creating
the file. The sentinel keeps this reference from looking like a second
installed-version declaration to deterministic version checks.

Consumer-project-only playbooks add an explicit ownership marker:

```yaml
goat-flow-ownership: "user-owned"
```

`goat-flow skill new` writes this marker automatically. Do not add it to
built-in source/install pairs: the manifest and mirror registry own those files.

After the title and short orientation, the first H2 must be exactly
`## Availability Check`.

- Runnable capabilities provide the exact command that proves availability.
- Documentary references state the load condition and why no CLI probe applies.
- Fallbacks distinguish an unavailable tool from an unavailable harness adapter.
- The body names intent, boundaries, workflow, verification, troubleshooting,
  and related references needed by a cold-start agent.
- Top-level progressive references stay below 3,000 body words.

## One Playbook or a Bundled Pack

The top-level rule is strict: one Markdown file represents one capability with
one primary load condition. Do not hide independent tools or unrelated
workflows inside a broad playbook merely to avoid registration work.

A bundled sub-pack is allowed only when all files share one authoring purpose,
version lifecycle, owner, and README index. Each topical file must remain
independently addressable, and every canonical/install mapping must be explicit.

Current repository evidence defines the boundary:

- `code-comments.md` is one standalone playbook because source-comment work has
  one load condition and one verification discipline.
- `browser-use.md` and `page-capture.md` remain separate because one handles
  interactive observation while the other handles repeatable batch capture;
  their availability and evidence paths differ.
- `skill-quality-testing/` is a valid bundle because its README, TDD,
  adversarial, and deployment files share one skill-authoring lifecycle and
  explicit mirror mappings.

This rule documents the existing source/install architecture, so it does not
need a separate ADR. A future exception that changes consumer installation or
ownership semantics does need an ADR before implementation.

## Built-in Authoring Workflow

1. Confirm the candidate belongs in `playbooks/` using the README admission
   checklist; reject one-off or speculative advice.
2. Add or edit the canonical file under `workflow/skills/playbooks/` first.
3. Apply the required frontmatter and first-H2 contract before writing the body.
4. Copy the same content to `.goat-flow/skill-docs/playbooks/` and keep the two
   files semantically identical.
5. Add the same discovery row to both playbook README copies.
6. Add the installed path to `STANDALONE_PLAYBOOK_FILES` in
   `src/cli/audit/skill-docs-contract.ts`; `check-goat-flow.ts` imports that
   inventory into both `NAMED_PATHS` and `REQUIRED_SKILL_DOC_FILES`.
7. Register the source/install pair in `SHARED_ARTIFACT_MIRRORS` in
   `src/cli/audit/check-artifact-integrity.ts`.
8. Register ownership/source in `workflow/manifest.json` `required_files`, and
   name the playbook in the playbooks `directory_purposes` description.
9. Add the `copy_file` enrollment to `workflow/install-goat-flow.sh` and the
   corresponding existence check to `workflow/setup/03-install-skills.md`.
10. Add the playbook to preflight mirror/budget checks and the integration
    parity/budget tests so release verification covers the installed copy.
11. Update explicit inventories in architecture, code map, and quality prompts.
12. Add a failing contract fixture before audit logic, then run the focused
    contract, consumer lifecycle, manifest, drift, and preflight checks.

## README Sync

The README row is the user-facing discovery contract. It must answer:

- Which file should the agent open?
- What user request or implementation activity triggers it?
- Which tool or capability does it govern, including `n/a` for documentary
  discipline?

Edit `workflow/skills/playbooks/README.md` first, mirror it to
`.goat-flow/skill-docs/playbooks/README.md`, and verify the files remain
byte-identical. Do not copy the full playbook contract back into the README;
link here so one source owns the details.

## Audit Registration

Built-in playbooks use four coordinated registration surfaces. The first two
share one source declaration so their inventories cannot drift:

1. `NAMED_PATHS` excludes the installed file from the manifest catch-all.
2. `REQUIRED_SKILL_DOC_FILES` makes a missing installed reference fail setup.
   Add both through `STANDALONE_PLAYBOOK_FILES` in
   `src/cli/audit/skill-docs-contract.ts`, which `check-goat-flow.ts` imports.
3. `SHARED_ARTIFACT_MIRRORS` compares canonical and installed content.
4. `workflow/manifest.json` tells the installer which source owns the file.

`check-drift.ts` consumes `SHARED_ARTIFACT_MIRRORS`; it does not own a second
pair list. Frozen manifest snapshots describe historical releases and must not
be changed from current live counts unless the current release snapshot is
intentionally regenerated.

## Installer and Release Enrollment

Manifest ownership does not currently copy standalone playbooks by itself.
Every built-in playbook also needs an explicit `copy_file` line in
`workflow/install-goat-flow.sh`; without it, local audit passes while a fresh
consumer install is incomplete.

Keep the manual setup checklist, preflight mirror and word-budget gates,
`preamble-sync.test.ts`, the skill-hardening budget inventory, architecture,
code map, and generated quality-prompt inventory aligned. The consumer
setup-to-audit lifecycle is the decisive proof that packaging reached users.

## Worked Registration Examples

`release-notes.md` demonstrates a complete standalone registration: it appears
in both README indexes, both setup arrays, the shared mirror registry, and the
manifest source map.

`skill-quality-testing.md` demonstrates a deliberate renamed bundle root: the
canonical file maps to the installed pack's `README.md`, while its topical
files map from the canonical subdirectory. It is not a hidden standalone
playbook in the installed top-level directory.

## Common Drift Modes

- Adding only the installed copy makes consumer setup unable to reproduce it.
- Adding only the canonical copy creates an orphan with no installed mapping.
- Editing one README copy creates source/install drift even when the playbook
  body matches.
- Registering the pair in `check-drift.ts` misses the actual shared registry.
- Omitting the manifest entry prevents deterministic installation.
- Omitting the installer copy line leaves fresh consumer installs incomplete.
- Omitting parity or budget enrollment lets the new artifact bypass release gates.
- Placing Intent before Availability Check breaks predictable cold-start use.
- Inferring snapshot counts from live state rewrites historical evidence.

## Verification Gate

Run these checks from the goat-flow controlling workspace:

```bash
cmp -s workflow/skills/playbooks/README.md .goat-flow/skill-docs/playbooks/README.md
node --import tsx --test --test-reporter=spec test/unit/playbook-contract.test.ts
node --import tsx --test --test-reporter=spec test/integration/setup-quality-lifecycle.test.ts test/integration/preamble-sync.test.ts
node --import tsx src/cli/cli.ts manifest --check
node --import tsx src/cli/cli.ts audit . --check-drift --format json
npm run typecheck
bash scripts/preflight-checks.sh
```

Before claiming success, also grep the installed directory for both contract
anchors and confirm every standalone file appears in the README and audit
registries.

## Troubleshooting

- **Audit says the playbook is missing:** check `required_files`, the canonical
  source path, and installer ownership before editing the audit message.
- **Drift reports content mismatch:** compare the canonical and installed files;
  do not weaken semantic comparison to accept a real contract difference.
- **The first-H2 test fails:** move Availability Check before Intent or Boundary.
- **A candidate needs several unrelated availability probes:** split it into
  independently discoverable standalone playbooks.

## Related References

- `../skill-preamble.md` - shared Proof Gate and evidence classifications.
- `../skill-conventions.md` - task tracking, recovery, and authoring boundaries.
- `../skill-quality-testing/README.md` - skill-specific TDD methodology; skills
  and playbooks have different testing methods.
- `README.md` - playbook discovery table and artifact admission checklist.
