export const RATIONALISATIONS_PREAMBLE = [
  "# Skill Preamble",
  "",
  "### Rationalisations to reject (Excuse / Reality)",
  "",
  "| Excuse | Reality |",
  "|---|---|",
  '| "Looks correct to me" | Structural inspection is not verification. |',
].join("\n");

export const INSTRUCTION_FILES = {
  claude: "CLAUDE.md",
  codex: "AGENTS.md",
  gemini: "GEMINI.md",
  copilot: ".github/copilot-instructions.md",
} as const;

export function completeInstruction(title: string): string {
  return [
    `# ${title}`,
    "",
    "**Hallucination red-flags:**",
    "1. **Checks passed.** Do not claim tests pass without literal evidence.",
    "2. **Completion.** Do not claim completion without listing files changed.",
    "3. **Fix verification.** Do not claim a fix works without reproduction.",
    '4. **Hedged claims.** Do not use "should work" as verification.',
    "",
    "The red-flags above name WHAT not to claim. The Excuse/Reality table in `.goat-flow/skill-reference/skill-preamble.md` (search: `Rationalisations to reject`) names the rationalisations that defeat the red-flags.",
  ].join("\n");
}

export const MISSING_RED_FLAGS_INSTRUCTION = [
  "# CLAUDE.md",
  "",
  "This file has no evidence-before-claims guard.",
].join("\n");

export const MISSING_RATIONALISATIONS_POINTER = [
  "# AGENTS.md",
  "",
  "**Hallucination red-flags:**",
  "1. **Checks passed.** Do not claim tests pass without literal evidence.",
  "2. **Completion.** Do not claim completion without listing files changed.",
  "3. **Fix verification.** Do not claim a fix works without reproduction.",
  '4. **Hedged claims.** Do not use "should work" as verification.',
].join("\n");
