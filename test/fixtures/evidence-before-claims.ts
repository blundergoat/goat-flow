/**
 * Fixture text used by verification tests that reject evidence-free completion claims.
 */
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
  antigravity: "AGENTS.md",
  copilot: ".github/copilot-instructions.md",
} as const;

// Test helper: a minimal instruction-file body that satisfies the
// hallucination-red-flags parity checks (all four red-flags + the Excuse/Reality
// pointer), titled as given, for asserting the audit passes on compliant docs.
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
    "The red-flags above name WHAT not to claim. The Excuse/Reality table in `.goat-flow/skill-docs/skill-preamble.md` (search: `Rationalisations to reject`) names the rationalisations that defeat the red-flags.",
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
