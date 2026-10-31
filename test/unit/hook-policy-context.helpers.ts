/** Build prepared segment contexts for rule tests the way preparation fills them for a plain segment. */
import { asciiLowerCase } from "../../workflow/hooks/policy-input.mjs";
import type { PolicySegmentContext } from "../../workflow/hooks/policy-segments.mjs";
import { normalizePolicyCommandCandidate } from "../../workflow/hooks/policy-syntax.mjs";

/**
 * Prepare one comment-free, parenthesis-free segment, e.g. `cat .env > out`, without the real preparation pass.
 *
 * @param command - the segment text
 * @param inlineCommandHost - the shell whose inline body the segment came from, or empty
 * @returns the context a rule receives; throws when the command cannot be normalized
 */
export function segmentContext(
  command: string,
  inlineCommandHost = "",
): PolicySegmentContext {
  const trimmed = command.replace(/^[ \t\n\v\f\r]+/u, "");
  const normalized = normalizePolicyCommandCandidate(trimmed);
  if (normalized === null)
    throw new Error(`unresolved test segment: ${command}`);
  const word = normalized.split(/[ \t\n\v\f\r]/u, 1)[0] ?? "";
  const unquoted = command
    .replace(/'[^'\n]*'/gu, "")
    .replace(/"[^"\n]*"/gu, "");
  return {
    trimmed,
    normalized,
    verb: word.slice(word.lastIndexOf("/") + 1),
    unquoted,
    lower: asciiLowerCase(command),
    hasRedirect:
      /(?:^|[^=])[0-9]*(?:>>|>\||>[ \t\n\v\f\r]|>[^ \t\n\v\f\r|=])/u.test(
        unquoted,
      ),
    hasPipe: unquoted.replaceAll("||", "").includes("|"),
    depth: 0,
    inlineCommandHost,
  };
}
