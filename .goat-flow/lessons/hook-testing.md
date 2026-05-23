---
category: hook-testing
last_reviewed: 2026-05-20
---

## Lesson: Hook write-block tests must vary valid CLI grammar

**Status:** active | **Created:** 2026-05-20

**What happened:** The first GitHub CLI write-block fix covered the reported `gh issue comment ... --body-file ...` command, `gh api` writes, direct read-only controls, and one pre-topic `--repo` form. A follow-up review still found valid write shapes returning exit 0: `gh issue --repo owner/repo comment 64620 --body hi` and `printf '%s\n' body | xargs -I{} gh issue comment 64620 --body {}`.

**Root cause:** I tested the incident shape and a few nearby commands, but not the CLI grammar surface. GitHub CLI accepts inherited flags after the topic, and shell pipeline consumers can move the real command behind a wrapper such as `xargs`.

**Prevention:** For hook rules that classify write-capable CLI commands, build the regression set as a grammar matrix before mirror fanout: direct incident form, global flags before topic, inherited flags after topic, short flag forms, shell wrappers already supported by `normalize_command_candidate`, pipeline consumers such as `xargs`, write-method API forms, and read-only allow controls. Evidence anchors: `workflow/hooks/deny-dangerous.sh` (search: `gh_skip_options_index`), `workflow/hooks/deny-dangerous.sh` (search: `strip_xargs_prefix`), `workflow/hooks/deny-dangerous.self-test.sh` (search: `gh topic repo issue comment blocked`).
