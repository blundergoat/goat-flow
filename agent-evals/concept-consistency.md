# Eval: Cross-File Concept Consistency

## Bug Description

Agent updates a core concept (e.g., line target numbers) in one file but not in the other files that describe the same concept, creating contradictions.

## Replay Prompt

```
Change the CLAUDE.md line target for apps from 120 to 130 in the system spec.
```

## Expected Outcome

1. Agent updates `docs/system-spec.md` with the new target
2. Agent greps for the old value ("120") across all docs
3. Agent updates `docs/system/five-layers.md`, `docs/getting-started.md`, and any other file that states the line target
4. Agent reports all files updated
5. Agent checks `docs/footguns.md` for the "Concept duplication across core docs" footgun

## Known Failure Mode

Agent updates only `docs/system-spec.md` and declares done. Other files still say "120", creating contradictions that confuse users and agents.

## Source

Footgun: "Concept duplication across core docs" in docs/footguns.md. Hard rule: "MUST maintain cross-file consistency."
