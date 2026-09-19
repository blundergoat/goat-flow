/**
 * Supply instruction text for tests of evidence-backed completion claims.
 *
 * Use complete and incomplete variants to check what the audit reports to a project maintainer.
 * The fixture strings deliberately control missing rules and pointers; comments do not change those inputs.
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

/**
 * Build an instruction fixture with every required red flag and its rationale pointer so tests can isolate missing-rule failures.
 *
 * @param title - heading label chosen by the test; empty text leaves the heading untitled
 * @returns instruction Markdown containing every required evidence rule and the rationale pointer
 */
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
