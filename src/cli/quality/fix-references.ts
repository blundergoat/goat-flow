/** Check saved fix references without running evidence commands or certifying an assessor's conclusion. */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { realpathSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { readProjectFileBytes, readProjectTextFile } from "../project-file.js";
import {
  exactKeys,
  parseReviewJson,
  record,
  requireAuthority,
  taggedHash,
  textField,
} from "../review-validate-common.js";
import { KNOWN_AGENT_IDS } from "../agents/registry.js";
import type { AgentId } from "../types.js";
import { attachFindingIds } from "./ids.js";
import { parseQualityReport } from "./schema.js";
import { isRecord } from "./schema-expectations.js";
import {
  QUALITY_CONCERNS,
  type QualityConcernCounts,
  type QualityEvidenceReference,
  type QualityFix,
  type QualityFixReferenceCheck,
  type QualityReport,
} from "./schema-types.js";

const MAX_REFERENCE_BYTES = 2 * 1024 * 1024;
const REPORT_ID = new RegExp(
  `^\\d{4}-\\d{2}-\\d{2}-\\d{4}-(${KNOWN_AGENT_IDS.join("|")})-[a-z0-9]{5}$`,
);

/** Historical conclusions retain their original attribution even when a reference disappears. */
export interface QualityFixView {
  fix: QualityFix;
  assessor: { agent: AgentId; report_id: string };
  status: "assessor-verified" | "unconfirmed";
  evidence_availability: "available" | "unavailable";
  warning: string | null;
}

/** Reject escaping and secret-bearing paths before opening an assessor-supplied reference. */
function checkReferencePath(path: string): void {
  const parts = path.replace(/\\/gu, "/").split("/");
  if (
    isAbsolute(path) ||
    /^[a-z]:/iu.test(path) ||
    parts.some((part) => part === ".." || part === "." || part === "")
  ) {
    throw new Error("reference must be a project-relative file");
  }
  if (
    parts.some((part) =>
      /^(?:\.git|\.ssh|\.env(?:\..*)?|secrets?|credentials?|id_rsa|id_ed25519)$/iu.test(
        part,
      ),
    ) ||
    /\.(?:pem|key|p12|pfx)$/iu.test(path)
  ) {
    throw new Error("secret-bearing paths cannot be fix evidence");
  }
}

/** Hash original bytes so malformed UTF-8 cannot alias a different evidence file. */
function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** Read exact evidence bytes; throws on unsafe paths, changed files or a mismatched digest. */
function readReference(
  projectRoot: string,
  reference: QualityEvidenceReference,
): string {
  checkReferencePath(reference.file);
  const bytes = readProjectFileBytes(
    projectRoot,
    reference.file,
    MAX_REFERENCE_BYTES,
  );
  if (sha256(bytes) !== reference.sha256)
    throw new Error("evidence bytes differ from the recorded digest");
  return bytes.toString("utf8");
}

/** Spawn read-only Git object queries; process failures propagate to the unconfirmed-reference boundary. */
function readGit(projectRoot: string, args: string[]): Buffer {
  return execFileSync(
    "git",
    ["--no-optional-locks", "--literal-pathspecs", "-C", projectRoot, ...args],
    {
      timeout: 5000,
      maxBuffer: MAX_REFERENCE_BYTES,
      stdio: ["ignore", "pipe", "ignore"],
    },
  );
}

/**
 * Query Git for source bytes at the recorded commit, independently of today's checkout.
 * Throws when the path is not a regular blob or its digest differs from the claim.
 */
function readCommittedReference(
  projectRoot: string,
  revision: string,
  reference: QualityEvidenceReference,
): string {
  checkReferencePath(reference.file);
  const row = readGit(projectRoot, [
    "ls-tree",
    "-z",
    revision,
    "--",
    reference.file,
  ]).toString("utf8");
  const match = /^(100644|100755) blob ([a-f0-9]+)\t([^\0]+)\0$/u.exec(row);
  if (!match || !match[2] || match[3] !== reference.file)
    throw new Error("committed evidence is not a regular file");
  const bytes = readGit(projectRoot, ["cat-file", "blob", match[2]]);
  if (sha256(bytes) !== reference.sha256)
    throw new Error("committed evidence digest does not match");
  return bytes.toString("utf8");
}

/** Require the exact prior report and finding; a summary match or absent later row is insufficient. */
function checkPriorFinding(projectRoot: string, fix: QualityFix): void {
  const reportId = fix.prior_report_id;
  if (!reportId || !REPORT_ID.test(reportId) || !fix.finding_id)
    throw new Error("exact prior report and finding IDs are required");
  const raw = JSON.parse(
    readProjectTextFile(
      projectRoot,
      join(".goat-flow/logs/quality", `${reportId}.json`),
      MAX_REFERENCE_BYTES,
    ),
  ) as unknown;
  const parsed = parseQualityReport(raw, { requireCurrentFields: false });
  if (!parsed.ok) throw new Error("prior report is unavailable or invalid");
  if (
    realpathSync(resolve(parsed.report.project_path)) !==
    realpathSync(resolve(projectRoot))
  )
    throw new Error("prior report belongs to another project");
  const findings = attachFindingIds(parsed.report);
  if (
    !findings.ok ||
    !findings.report.findings.some((finding) => finding.id === fix.finding_id)
  )
    throw new Error("prior finding ID does not resolve");
}

/** Verify a retained capture's frozen metadata without recapturing today's workspace. */
function readWorkspaceCapture(
  projectRoot: string,
  target: Extract<
    NonNullable<QualityFix["target"]>,
    { kind: "workspace-snapshot" }
  >,
): Record<string, unknown> {
  const saved = record(
    parseReviewJson(readReference(projectRoot, target.capture)),
    "workspace capture",
  );
  const capture = record(saved.authority ?? saved, "capture authority");
  exactKeys(capture, [
    "schema",
    "objectFormat",
    "source",
    "index",
    "inventory",
    "renames",
    "workspace",
    "fingerprint",
  ]);
  requireAuthority(
    capture.schema === "goat-review-authority/v1",
    "workspace capture schema is invalid",
  );
  requireAuthority(
    capture.objectFormat === null ||
      capture.objectFormat === "sha1" ||
      capture.objectFormat === "sha256",
    "workspace capture object format is invalid",
  );
  const source = record(capture.source, "capture source");
  textField(source.kind, "capture source kind");
  record(source.requested, "capture source request");
  requireAuthority(
    capture.index === null || typeof capture.index === "string",
    "workspace capture index is invalid",
  );
  requireAuthority(
    Array.isArray(capture.inventory) && Array.isArray(capture.renames),
    "workspace capture inventory or renames are invalid",
  );
  requireAuthority(
    capture.workspace === null ||
      /^workspace-v1:sha256:[a-f0-9]{64}$/u.test(
        textField(capture.workspace, "workspace"),
      ),
    "execution workspace identity is invalid",
  );
  const { fingerprint, ...unsigned } = capture;
  if (
    fingerprint !== target.fingerprint ||
    taggedHash("authority", unsigned) !== fingerprint
  )
    throw new Error("workspace capture fingerprint does not match");
  return capture;
}

/** Static proof must identify the exact captured source bytes; runtime proof names a retained result instead. */
function checkCapturedSource(
  capture: Record<string, unknown>,
  fix: QualityFix,
): void {
  const evidence = fix.evidence;
  if (!evidence || evidence.method !== "static-analysis") return;
  const inventory = capture.inventory as unknown[];
  const found = inventory.some(
    (row) =>
      isRecord(row) &&
      row.path === evidence.file &&
      isRecord(row.new) &&
      row.new.kind === "file" &&
      row.new.sha256 === evidence.sha256,
  );
  if (!found)
    throw new Error(
      "source evidence does not identify captured workspace bytes",
    );
}

/** Enforce proof shape only; command success and matching text do not establish semantic correctness. */
function checkProofShape(fix: QualityFix): void {
  if (!fix.explanation || !fix.evidence || !fix.target)
    throw new Error("explanation, target and evidence are required");
  const evidence = fix.evidence;
  if (evidence.method === "static-analysis") {
    if (!evidence.anchor)
      throw new Error("static proof requires a semantic anchor");
  } else if (!evidence.command || evidence.exit_code === undefined) {
    throw new Error(
      "runtime proof requires the recorded command and exit code",
    );
  }
}

/** Check one complete claim's target and retained proof, leaving its interpretation with the assessor. */
function checkTargetEvidence(projectRoot: string, fix: QualityFix): void {
  const target = fix.target;
  const evidence = fix.evidence;
  if (!target || !evidence) throw new Error("target and evidence are required");
  let text: string;
  if (target.kind === "commit") {
    if (
      readGit(projectRoot, ["cat-file", "-t", target.revision])
        .toString("utf8")
        .trim() !== "commit"
    )
      throw new Error("target revision is not a commit");
    text =
      evidence.method === "static-analysis"
        ? readCommittedReference(projectRoot, target.revision, evidence)
        : readReference(projectRoot, evidence);
  } else {
    const capture = readWorkspaceCapture(projectRoot, target);
    checkCapturedSource(capture, fix);
    text = readReference(projectRoot, evidence);
  }
  if (evidence.anchor && !text.includes(evidence.anchor))
    throw new Error("evidence anchor is unavailable");
}

/** Return unconfirmed on any missing, unsafe or changed reference; never expose filesystem or Git diagnostics. */
function checkFix(
  projectRoot: string,
  fix: QualityFix,
): QualityFixReferenceCheck {
  try {
    checkProofShape(fix);
    checkPriorFinding(projectRoot, fix);
    checkTargetEvidence(projectRoot, fix);
    return {
      status: "confirmed",
      reason: "references available; correction assessed by the report author",
    };
  } catch {
    return {
      status: "unconfirmed",
      reason:
        "required finding, target or method-specific evidence is missing, invalid or unavailable",
    };
  }
}

/**
 * Record reference admission before saving; incoming confirmation fields are never trusted.
 * @param projectRoot - selected project owning the report and all local evidence
 * @param report - parsed current report; an absent fixes section stays absent
 * @returns a copy with per-record admission results, leaving the source report untouched
 */
export function confirmQualityFixReferences(
  projectRoot: string,
  report: QualityReport,
): QualityReport {
  if (report.fixes === undefined) return report;
  const pairCounts = new Map<string, number>();
  for (const fix of report.fixes) {
    const pair = `${fix.prior_report_id}\0${fix.finding_id}`;
    pairCounts.set(pair, (pairCounts.get(pair) ?? 0) + 1);
  }
  return {
    ...report,
    fixes: report.fixes.map((fix) => ({
      ...fix,
      reference_check:
        (pairCounts.get(`${fix.prior_report_id}\0${fix.finding_id}`) ?? 0) > 1
          ? {
              status: "unconfirmed",
              reason: "duplicate claims for the same prior report and finding",
            }
          : checkFix(projectRoot, fix),
    })),
  };
}

/**
 * Keep historical admission separate from current reference availability.
 * @param projectRoot - selected project; changed or missing artifacts become unavailable
 * @param report - saved report with its original admission results
 * @param reportId - filename-derived identity of the verifying report
 * @returns attributed views; no report file is rewritten and no command is re-executed
 */
export function describeQualityFixes(
  projectRoot: string,
  report: QualityReport,
  reportId: string,
): QualityFixView[] {
  return (report.fixes ?? []).map((fix) => {
    const wasConfirmed = fix.reference_check?.status === "confirmed";
    const available = checkFix(projectRoot, fix).status === "confirmed";
    return {
      fix,
      assessor: { agent: report.agent, report_id: reportId },
      status: wasConfirmed ? "assessor-verified" : "unconfirmed",
      evidence_availability: available ? "available" : "unavailable",
      warning: wasConfirmed
        ? available
          ? null
          : "evidence unavailable; not reverified"
        : "unconfirmed; no successful saved reference check",
    };
  });
}

/**
 * Count each finding once in the concern schema; legacy omissions stay unclassified.
 * @param report - parsed current or historical report; never modified
 * @returns all concern counts plus unclassified, including zero-count categories
 */
export function countQualityConcerns(
  report: QualityReport,
): QualityConcernCounts {
  const counts = Object.fromEntries(
    [...QUALITY_CONCERNS, "unclassified"].map((concern) => [concern, 0]),
  ) as QualityConcernCounts;
  for (const finding of report.findings)
    counts[finding.concern ?? "unclassified"] += 1;
  return counts;
}
