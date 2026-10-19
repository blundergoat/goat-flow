/** Inspect commands that substitutions run before the outer command, using UTF-8 byte offsets like the frozen policy. */
import type { PolicyDenial } from "./policy-input.mjs";
import { findMatchingPolicyShellParen } from "./policy-words.mjs";

/**
 * Evaluate one nested command with the complete segment policy, e.g. the `rm -rf build` inside `echo $(rm -rf build)`.
 * The policy may read saved Git aliases under the hook deadline, so evaluation is asynchronous.
 *
 * @param command - the substitution interior exactly as the agent typed it
 * @param depth - the nesting depth of that interior; the outer command is depth zero
 * @returns the nested denial with its own scope, or null when the nested command is allowed
 */
export type PolicySegmentEvaluator = (
  command: string,
  depth: number,
) => Promise<PolicyDenial | null>;

interface SubstitutionScan {
  bytes: Uint8Array;
  index: number;
  depth: number;
  scope: string;
  evaluate: PolicySegmentEvaluator;
  commandCandidates: string;
  processCandidates: string;
  inSingle: boolean;
  inDouble: boolean;
  escaped: boolean;
}

const decoder = new TextDecoder();

/** Track escapes and quotes; an escaped character separates adjacent opener text unless it is a removed backslash-newline. */
function consumeSubstitutionQuote(
  scan: SubstitutionScan,
  char: string,
): boolean {
  if (scan.escaped) {
    if (char !== "\n") appendSubstitutionMarker(scan, "__goat_escaped__");
    scan.escaped = false;
    return true;
  }
  if (!scan.inSingle && char === "\\") scan.escaped = true;
  else if (!scan.inDouble && char === "'") scan.inSingle = !scan.inSingle;
  else if (!scan.inSingle && char === '"') scan.inDouble = !scan.inDouble;
  else return false;
  return true;
}

/** Record inspected text: command substitutions also run inside double quotes, process substitutions only outside them. */
function appendSubstitutionMarker(scan: SubstitutionScan, text: string): void {
  scan.commandCandidates += text;
  if (!scan.inDouble) scan.processCandidates += text;
}

/** Decode the interior between an opener and its matching close, both given as byte offsets. */
function substitutionInterior(
  scan: SubstitutionScan,
  start: number,
  close: number,
): string {
  return decoder.decode(scan.bytes.subarray(start, close));
}

/** Arithmetic can nest command substitutions, so its interior is scanned again at the same depth. */
async function inspectArithmetic(
  scan: SubstitutionScan,
): Promise<PolicyDenial | null | undefined> {
  const close = findMatchingPolicyShellParen(scan.bytes, scan.index + 1);
  if (close === null) return undefined;
  const denial = await checkPolicyCommandSubstitutions(
    substitutionInterior(scan, scan.index + 3, close),
    scan.depth,
    scan.scope,
    scan.evaluate,
  );
  if (denial !== null) return denial;
  appendSubstitutionMarker(scan, "__goat_arith__");
  scan.index = close;
  return null;
}

/** A command or process substitution runs its interior first, so a nonempty interior gets its own policy verdict. */
async function inspectNestedCommand(
  scan: SubstitutionScan,
  marker: "__goat_subst__" | "__goat_proc_subst__",
): Promise<PolicyDenial | null | undefined> {
  const close = findMatchingPolicyShellParen(scan.bytes, scan.index + 1);
  if (close === null) return undefined;
  const inner = substitutionInterior(scan, scan.index + 2, close);
  const denial =
    inner === "" ? null : await scan.evaluate(inner, scan.depth + 1);
  if (denial !== null) return denial;
  appendSubstitutionMarker(scan, marker);
  scan.index = close;
  return null;
}

/** Inspect a complete opener at the current byte; undefined means no complete substitution starts here. */
async function inspectSubstitutionOpener(
  scan: SubstitutionScan,
  char: string,
): Promise<PolicyDenial | null | undefined> {
  const pair = char + String.fromCharCode(scan.bytes[scan.index + 1] ?? 0);
  if (pair === "$(" && scan.bytes[scan.index + 2] === 0x28)
    return inspectArithmetic(scan);
  if (pair === "$(") return inspectNestedCommand(scan, "__goat_subst__");
  if (!scan.inDouble && (pair === "<(" || pair === ">("))
    return inspectNestedCommand(scan, "__goat_proc_subst__");
  return undefined;
}

/**
 * Give every command, arithmetic and process substitution interior its own verdict before the outer command,
 * e.g. `echo $(rm -rf build)` is judged on `rm -rf build`, while `echo '$(id)'` stays literal text.
 * Double quotes still run command substitutions but keep process substitutions literal; an escaped opener is never executable.
 * Any opener left without a complete close, and any executable backtick, is refused with an instruction to write the command directly.
 *
 * @param remaining - the command text to inspect
 * @param depth - the nesting depth of `remaining`; nested interiors are evaluated at depth + 1
 * @param scope - the protection named by this checker's own refusals; nested denials keep their own scope
 * @param evaluate - the complete segment policy used for each nonempty interior
 * @returns the first denial, or null when every interior is allowed and no unresolved substitution remains
 */
export async function checkPolicyCommandSubstitutions(
  remaining: string,
  depth: number,
  scope: string,
  evaluate: PolicySegmentEvaluator,
): Promise<PolicyDenial | null> {
  const scan: SubstitutionScan = {
    bytes: new TextEncoder().encode(remaining),
    index: 0,
    depth,
    scope,
    evaluate,
    commandCandidates: "",
    processCandidates: "",
    inSingle: false,
    inDouble: false,
    escaped: false,
  };
  for (; scan.index < scan.bytes.length; scan.index++) {
    const char = String.fromCharCode(scan.bytes[scan.index] ?? 0);
    if (consumeSubstitutionQuote(scan, char)) continue;
    if (!scan.inSingle) {
      const denial = await inspectSubstitutionOpener(scan, char);
      if (denial !== undefined) {
        if (denial !== null) return denial;
        continue;
      }
      appendSubstitutionMarker(scan, char);
    }
  }
  const reason = unresolvedSubstitutionReason(scan);
  return reason === null ? null : { scope, reason };
}

/** An opener that never closed cannot be inspected, and a backtick hides its command from review. */
function unresolvedSubstitutionReason(scan: SubstitutionScan): string | null {
  if (
    scan.commandCandidates.includes("$(") ||
    /[<>]\(/u.test(scan.processCandidates)
  )
    return "Complex command substitution. Write the expanded command directly.";
  if (scan.commandCandidates.includes("\x60"))
    return "Backtick command substitution hides nested execution. Use a direct command instead, or for an inline script run it from a file (e.g. node script.js).";
  return null;
}
