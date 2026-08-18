/**
 * Proves that a review's evidence anchors point at code that really exists.
 *
 * A finding is only trustworthy if a reader can open the file and see the cited text, so every `(search: "...")` anchor is resolved against the
 * reviewed project - either the working tree or a pinned git object, depending on what the report claims as its authority.
 *
 * Paths are confined to the reviewed project on purpose.
 * A report that cites something outside it is rejected rather than resolved, because a reviewer following that anchor would be reading a file the
 * review was never authorised to look at.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import type { FINDING_SECTIONS } from "./review-validate-common.js";
import {
  FINDING_CANDIDATE,
  FINDING_PREFIX,
  EVIDENCE_TAG,
  PROOF_TAG,
  HARM_TAG,
  ANCHOR,
  addViolation,
  type ReviewValidationViolation,
  type LocatedLine,
  type FindingDefinition,
  type FindingAction,
  type FindingSeverity,
  type ReviewAnchorAuthority,
} from "./review-validate-common.js";

/**
 * Return whether a resolved path remains under the reviewed project's real path.
 *
 * @param projectRoot - reviewed project root; anchors are confined to it so a report cannot cite files it was never authorised to read
 * @param candidatePath - path an anchor points at; anything resolving outside the reviewed project is refused rather than followed
 * @returns true when the path stays inside the reviewed project; false means the anchor is refused rather than resolved
 */
export function isWithinProject(
  projectRoot: string,
  candidatePath: string,
): boolean {
  const pathFromRoot = relative(projectRoot, candidatePath);
  return (
    pathFromRoot !== ".." &&
    !pathFromRoot.startsWith(`..${sep}`) &&
    !isAbsolute(pathFromRoot)
  );
}

/**
 * Resolve an anchor from one immutable Git commit or tree.
 * It spawns git to read the pinned bytes, and reports an unreadable object as a violation.
 */
function validateGitObjectAnchor(
  projectRoot: string,
  candidatePath: string,
  authority: Extract<ReviewAnchorAuthority, { kind: "git-object" }>,
  filePath: string,
  searchText: string,
  line: number,
  violations: ReviewValidationViolation[],
): void {
  const repositoryPath = relative(projectRoot, candidatePath)
    .split(sep)
    .join("/");
  try {
    const content = execFileSync(
      "git",
      ["-C", projectRoot, "show", `${authority.oid}:${repositoryPath}`],
      {
        encoding: "utf-8",
        maxBuffer: 16 * 1024 * 1024,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    if (!content.includes(searchText)) {
      addViolation(
        violations,
        "anchor-unresolved",
        line,
        `search text not found in ${filePath} at declared head ${authority.oid}: ${searchText}`,
      );
    }
  } catch {
    addViolation(
      violations,
      "anchor-unresolved",
      line,
      `cannot read anchor ${filePath} from declared head ${authority.oid}`,
    );
  }
}

/** Resolve an anchor from the declared live worktree without following escapes; it reports a missing file or absent text as a violation. */
function validateWorktreeAnchor(
  projectRoot: string,
  candidatePath: string,
  filePath: string,
  searchText: string,
  line: number,
  violations: ReviewValidationViolation[],
): void {
  if (!existsSync(candidatePath)) {
    addViolation(
      violations,
      "anchor-unresolved",
      line,
      `anchor file does not exist: ${filePath}`,
    );
    return;
  }

  try {
    const realProjectRoot = realpathSync(projectRoot);
    const realCandidatePath = realpathSync(candidatePath);
    if (
      !isWithinProject(realProjectRoot, realCandidatePath) ||
      !statSync(realCandidatePath).isFile()
    ) {
      addViolation(
        violations,
        "anchor-outside-project",
        line,
        `anchor is not a project file: ${filePath}`,
      );
      return;
    }
    if (!readFileSync(realCandidatePath, "utf-8").includes(searchText)) {
      addViolation(
        violations,
        "anchor-unresolved",
        line,
        `search text not found in ${filePath}: ${searchText}`,
      );
    }
  } catch (error) {
    addViolation(
      violations,
      "anchor-unresolved",
      line,
      `cannot read anchor ${filePath}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * Resolve one literal semantic anchor without reading outside the reviewed project.
 *
 * @param projectRoot - reviewed project root; anchors are confined to it so a report cannot cite files it was never authorised to read
 * @param authority - what the report claims as its source of truth, the live worktree or a pinned git object;
 *   this decides where anchors are resolved from
 * @param filePath - repo-relative file an anchor cites; empty means the anchor named no file and cannot be resolved
 * @param searchText - literal an anchor claims to find; empty means the anchor named no text to verify
 * @param line - report line the issue belongs to; null means the issue is about the report as a whole
 * @param violations - shared violation list, appended in report order so a reader sees issues top-down; a violation makes the report fail
 */
export function validateAnchor(
  projectRoot: string,
  authority: ReviewAnchorAuthority,
  filePath: string,
  searchText: string,
  line: number,
  violations: ReviewValidationViolation[],
): void {
  const lexicalProjectRoot = resolve(projectRoot);
  const candidatePath = resolve(lexicalProjectRoot, filePath);
  if (!isWithinProject(lexicalProjectRoot, candidatePath)) {
    addViolation(
      violations,
      "anchor-outside-project",
      line,
      `anchor path escapes the reviewed project: ${filePath}`,
    );
    return;
  }

  // The scope violation already explains why no byte authority is available.
  if (authority.kind === "invalid") return;

  if (authority.kind === "git-object") {
    validateGitObjectAnchor(
      lexicalProjectRoot,
      candidatePath,
      authority,
      filePath,
      searchText,
      line,
      violations,
    );
    return;
  }
  validateWorktreeAnchor(
    lexicalProjectRoot,
    candidatePath,
    filePath,
    searchText,
    line,
    violations,
  );
}

/**
 * Validate Evidence, Proof, and severity-dependent Harm fields.
 *
 * @param text - raw line text exactly as the author wrote it
 * @param severity - declared finding severity, which decides whether it can block the ship verdict
 * @param line - report line the issue belongs to; null means the issue is about the report as a whole
 * @param violations - shared violation list, appended in report order so a reader sees issues top-down; a violation makes the report fail
 */
function validateFindingFields(
  text: string,
  severity: string,
  line: number,
  violations: ReviewValidationViolation[],
): void {
  if (!EVIDENCE_TAG.test(text)) {
    addViolation(
      violations,
      "finding-evidence",
      line,
      "finding is missing Evidence: OBSERVED or Evidence: INFERRED",
    );
  }
  if (!PROOF_TAG.test(text)) {
    addViolation(
      violations,
      "finding-proof",
      line,
      "finding is missing a supported Proof: class",
    );
  }
  const needsHarm = severity === "MUST" || severity === "SHOULD";
  if (needsHarm && !HARM_TAG.test(text)) {
    addViolation(
      violations,
      "finding-harm",
      line,
      "MUST and SHOULD findings require a non-empty Harm: segment",
    );
  }
}

/**
 * Validate every literal semantic anchor carried by one finding.
 *
 * @param locatedLine - one report line with its number, so a violation can point at it
 * @param projectRoot - reviewed project root; anchors are confined to it so a report cannot cite files it was never authorised to read
 * @param authority - what the report claims as its source of truth, the live worktree or a pinned git object;
 *   this decides where anchors are resolved from
 * @param violations - shared violation list, appended in report order so a reader sees issues top-down; a violation makes the report fail
 */
function validateFindingAnchors(
  locatedLine: LocatedLine,
  projectRoot: string,
  authority: ReviewAnchorAuthority,
  violations: ReviewValidationViolation[],
): void {
  const anchors = [...locatedLine.text.matchAll(ANCHOR)];
  if (anchors.length === 0) {
    addViolation(
      violations,
      "anchor-format",
      locatedLine.line,
      "finding requires at least one `path` (search: `literal`) anchor",
    );
    return;
  }
  for (const anchor of anchors) {
    const filePath = anchor[1];
    const searchText = anchor[2] ?? anchor[3];
    if (filePath === undefined || searchText === undefined) continue;
    validateAnchor(
      projectRoot,
      authority,
      filePath,
      searchText,
      locatedLine.line,
      violations,
    );
  }
}

/** Read the bounded evidence tag already checked by finding-field validation. */
function readFindingEvidence(text: string): FindingDefinition["evidence"] {
  const evidence = text.match(EVIDENCE_TAG)?.[1];
  if (evidence === "OBSERVED") return evidence;
  if (evidence === "INFERRED") return evidence;
  return null;
}

/**
 * Validate one finding definition after its containing section identifies it as review output.
 *
 * @param locatedLine - one report line with its number, so a violation can point at it
 * @param section - one located report section; null means the heading was absent entirely
 * @param isAreaAudit - whether the report declared itself an area audit, which relaxes some coverage expectations
 * @param projectRoot - reviewed project root; anchors are confined to it so a report cannot cite files it was never authorised to read
 * @param authority - what the report claims as its source of truth, the live worktree or a pinned git object;
 *   this decides where anchors are resolved from
 * @param violations - shared violation list, appended in report order so a reader sees issues top-down; a violation makes the report fail
 * @returns nothing; every problem is added to that shared list rather than returned
 */
export function validateFindingLine(
  locatedLine: LocatedLine,
  section: (typeof FINDING_SECTIONS)[number],
  isAreaAudit: boolean,
  projectRoot: string,
  authority: ReviewAnchorAuthority,
  violations: ReviewValidationViolation[],
): FindingDefinition | null {
  if (!FINDING_CANDIDATE.test(locatedLine.text)) return null;
  const prefixMatch = locatedLine.text.match(FINDING_PREFIX);
  if (!prefixMatch) {
    addViolation(
      violations,
      "finding-grammar",
      locatedLine.line,
      "finding must use R-NNN, a supported severity/action, optional current provenance/refuter tags, and a bold title",
    );
    return null;
  }

  if (prefixMatch[3] === "pre-existing" && !isAreaAudit) {
    addViolation(
      violations,
      "finding-action-scope",
      locatedLine.line,
      "the pre-existing action is permitted only when Scope snapshot declares source=area",
    );
  }

  validateFindingFields(
    locatedLine.text,
    prefixMatch[2] ?? "",
    locatedLine.line,
    violations,
  );
  validateFindingAnchors(locatedLine, projectRoot, authority, violations);
  return {
    action: (prefixMatch[3] ?? "patch") as FindingAction,
    evidence: readFindingEvidence(locatedLine.text),
    id: prefixMatch[1] ?? "",
    line: locatedLine.line,
    section,
    severity: (prefixMatch[2] ?? "MAY") as FindingSeverity,
  };
}

/** One authoritative Review Integrity value and its report location. */
