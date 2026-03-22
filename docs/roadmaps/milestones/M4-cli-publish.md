# Milestone 4: CLI Polish + npm Publish

**Archetype:** Make It Shine — polish, multiple output formats, CI gate, npm publish.

## Objective

`npx @blundergoat/goat-flow .` works on a fresh machine in under 3 seconds. CI gate mode for automated quality enforcement. Published on npm.

## Rough Tasks

1. [ ] `render/markdown.ts` — PR-comment friendly output
2. [ ] `--min-score` / `--min-grade` CI gate (exit 1 if below)
3. [ ] `--output` file writing
4. [ ] Error handling polish
5. [ ] `cli/README.md` with usage examples
6. [ ] `npm pack` smoke test
7. [ ] Verify `npx` on fresh machine (macOS, Linux, WSL)
8. [ ] npm publish `@blundergoat/goat-flow`

## Exit Criteria

- [ ] Works on fresh machine via `npx`
- [ ] Under 3 seconds
- [ ] CI gate exits correctly
- [ ] Published on npm

## Human Testing Gate

- [ ] On a fresh machine (or fresh container): `npx @blundergoat/goat-flow .` works without prior installation
- [ ] Run with `--min-score 75` on a project that scores 70 — confirm exit code 1
- [ ] Run with `--format markdown` — paste output into a GitHub PR comment, confirm it renders
- [ ] Verify the npm package page shows correct README, version, and bin entry

M4 is NOT complete until the user has tested on a fresh machine and verified the npm listing.

*Re-plan after M3. Publishing depends on all prior milestones being stable.*
