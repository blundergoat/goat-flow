import {
  EVIDENCE_QUALITIES,
  PROOF_CLASSES,
  REVIEW_CONTRACT_VERSION,
  expectEnumValue,
  expectNonEmptyString,
  expectNonNegativeInteger,
  expectStringArray,
  isRecord,
  parseBaseIntegrity,
  parseFindingLines,
  parseFindingSource,
  type BaseFinding,
  type BaseIntegrity,
  type ParseResult,
  type ProofClass,
} from "./goat-flow-contract-shared.js";

const SECURITY_RESULT_KIND = "goat-flow-security-result" as const;

const SECURITY_SEVERITIES = ["Critical", "High", "Medium", "Low"] as const;

const SECURITY_CONFIDENCES = ["CONFIRMED", "PROBABLE", "THEORETICAL"] as const;

type SecuritySeverity = (typeof SECURITY_SEVERITIES)[number];
type SecurityConfidence = (typeof SECURITY_CONFIDENCES)[number];

interface SecurityFinding extends BaseFinding {
  kind: "security";
  severity: SecuritySeverity;
  asset: string;
  entry: string;
  sink: string;
  trustBoundary: string;
  attackerPreconditions: string;
  confidence: SecurityConfidence;
  exploitability: string;
  blastRadius: string;
  proofOfFix: string;
  diffMetadata?: {
    changedFileCount: number;
    riskyBuckets: string[];
    introduction: "added" | "modified" | "pre-existing context";
  };
}

interface SecurityPosture {
  rollupBySeverity: Record<SecuritySeverity, number>;
  conclusion: "confident" | "coverage-degraded" | "tool-limited";
}

interface SecurityIntegrity extends BaseIntegrity {
  reviewMode: string;
  provenance: "trusted" | "untrusted" | "unknown";
  surfacesScanned: string[];
  surfacesSkipped: string[];
  scannerTools: string[];
  unavailableTools: string[];
  proofClasses: Record<ProofClass, number>;
  confidence: Record<SecurityConfidence, number>;
}

export interface SecurityResult {
  resultKind: typeof SECURITY_RESULT_KIND;
  contractVersion: typeof REVIEW_CONTRACT_VERSION;
  generatedAt: string;
  target: {
    projectPath: string;
    mode: "whole-repo" | "diff";
    agent: string;
  };
  threatModelSnapshot: {
    assets: string[];
    trustBoundaries: string[];
    attackerTypes: string[];
    criticalSurfaces: string[];
  };
  posture: SecurityPosture;
  findings: SecurityFinding[];
  attackPathSummary: string[];
  falsePositivesRemoved: string[];
  positiveObservations: string[];
  integrity: SecurityIntegrity;
  activeTestingGate: {
    required: boolean;
    reason: string;
    status: "not-required" | "pending" | "complete" | "blocked";
  };
  persistGate: {
    artifactPath: string;
    wroteArtifact: boolean;
    confirmation: string;
  };
}

export function parseSecurityResult(raw: unknown): ParseResult<SecurityResult> {
  if (!isRecord(raw)) {
    return { ok: false, error: "security result must be an object" };
  }
  if (raw.resultKind !== SECURITY_RESULT_KIND) {
    return {
      ok: false,
      error: `resultKind must equal "${SECURITY_RESULT_KIND}"`,
    };
  }
  if (raw.contractVersion !== REVIEW_CONTRACT_VERSION) {
    return {
      ok: false,
      error: `contractVersion must equal "${REVIEW_CONTRACT_VERSION}"`,
    };
  }
  const generatedAt = expectNonEmptyString(raw.generatedAt, "generatedAt");
  if (!generatedAt.ok) return generatedAt;
  const target = parseTarget(raw.target);
  if (!target.ok) return target;
  const threatModelSnapshot = parseThreatModelSnapshot(raw.threatModelSnapshot);
  if (!threatModelSnapshot.ok) return threatModelSnapshot;
  const posture = parsePosture(raw.posture);
  if (!posture.ok) return posture;
  const findings = parseFindings(raw.findings);
  if (!findings.ok) return findings;
  const attackPathSummary = expectStringArray(
    raw.attackPathSummary,
    "attackPathSummary",
  );
  if (!attackPathSummary.ok) return attackPathSummary;
  const falsePositivesRemoved = expectStringArray(
    raw.falsePositivesRemoved,
    "falsePositivesRemoved",
  );
  if (!falsePositivesRemoved.ok) return falsePositivesRemoved;
  const positiveObservations = expectStringArray(
    raw.positiveObservations,
    "positiveObservations",
  );
  if (!positiveObservations.ok) return positiveObservations;
  const integrity = parseSecurityIntegrity(raw.integrity);
  if (!integrity.ok) return integrity;
  const activeTestingGate = parseActiveTestingGate(raw.activeTestingGate);
  if (!activeTestingGate.ok) return activeTestingGate;
  const persistGate = parsePersistGate(raw.persistGate);
  if (!persistGate.ok) return persistGate;
  return {
    ok: true,
    artifact: {
      resultKind: SECURITY_RESULT_KIND,
      contractVersion: REVIEW_CONTRACT_VERSION,
      generatedAt: generatedAt.value,
      target: target.value,
      threatModelSnapshot: threatModelSnapshot.value,
      posture: posture.value,
      findings: findings.value,
      attackPathSummary: attackPathSummary.value,
      falsePositivesRemoved: falsePositivesRemoved.value,
      positiveObservations: positiveObservations.value,
      integrity: integrity.value,
      activeTestingGate: activeTestingGate.value,
      persistGate: persistGate.value,
    },
  };
}

function parseTarget(
  raw: unknown,
):
  | { ok: true; value: SecurityResult["target"] }
  | { ok: false; error: string } {
  if (!isRecord(raw)) return { ok: false, error: "target must be an object" };
  const projectPath = expectNonEmptyString(
    raw.projectPath,
    "target.projectPath",
  );
  if (!projectPath.ok) return projectPath;
  const mode = expectEnumValue(raw.mode, "target.mode", [
    "whole-repo",
    "diff",
  ] as const);
  if (!mode.ok) return mode;
  const agent = expectNonEmptyString(raw.agent, "target.agent");
  if (!agent.ok) return agent;
  return {
    ok: true,
    value: {
      projectPath: projectPath.value,
      mode: mode.value,
      agent: agent.value,
    },
  };
}

function parseThreatModelSnapshot(
  raw: unknown,
):
  | { ok: true; value: SecurityResult["threatModelSnapshot"] }
  | { ok: false; error: string } {
  if (!isRecord(raw)) {
    return { ok: false, error: "threatModelSnapshot must be an object" };
  }
  const assets = expectStringArray(raw.assets, "threatModelSnapshot.assets");
  if (!assets.ok) return assets;
  const trustBoundaries = expectStringArray(
    raw.trustBoundaries,
    "threatModelSnapshot.trustBoundaries",
  );
  if (!trustBoundaries.ok) return trustBoundaries;
  const attackerTypes = expectStringArray(
    raw.attackerTypes,
    "threatModelSnapshot.attackerTypes",
  );
  if (!attackerTypes.ok) return attackerTypes;
  const criticalSurfaces = expectStringArray(
    raw.criticalSurfaces,
    "threatModelSnapshot.criticalSurfaces",
  );
  if (!criticalSurfaces.ok) return criticalSurfaces;
  return {
    ok: true,
    value: {
      assets: assets.value,
      trustBoundaries: trustBoundaries.value,
      attackerTypes: attackerTypes.value,
      criticalSurfaces: criticalSurfaces.value,
    },
  };
}

function parsePosture(
  raw: unknown,
): { ok: true; value: SecurityPosture } | { ok: false; error: string } {
  if (!isRecord(raw)) return { ok: false, error: "posture must be an object" };
  if (!isRecord(raw.rollupBySeverity)) {
    return { ok: false, error: "posture.rollupBySeverity must be an object" };
  }
  const rollupBySeverity = {} as Record<SecuritySeverity, number>;
  for (const severity of SECURITY_SEVERITIES) {
    const count = expectNonNegativeInteger(
      raw.rollupBySeverity[severity],
      `posture.rollupBySeverity.${severity}`,
    );
    if (!count.ok) return count;
    rollupBySeverity[severity] = count.value;
  }
  const conclusion = expectEnumValue(raw.conclusion, "posture.conclusion", [
    "confident",
    "coverage-degraded",
    "tool-limited",
  ] as const);
  if (!conclusion.ok) return conclusion;
  return {
    ok: true,
    value: { rollupBySeverity, conclusion: conclusion.value },
  };
}

function parseFindings(
  raw: unknown,
): { ok: true; value: SecurityFinding[] } | { ok: false; error: string } {
  if (!Array.isArray(raw))
    return { ok: false, error: "findings must be an array" };
  const findings: SecurityFinding[] = [];
  for (let index = 0; index < raw.length; index += 1) {
    const parsed = parseFinding(raw[index], index);
    if (!parsed.ok) return parsed;
    findings.push(parsed.value);
  }
  return { ok: true, value: findings };
}

function parseFinding(
  raw: unknown,
  index: number,
): { ok: true; value: SecurityFinding } | { ok: false; error: string } {
  const path = `findings[${index}]`;
  if (!isRecord(raw)) return { ok: false, error: `${path} must be an object` };
  const id = expectNonEmptyString(raw.id, `${path}.id`);
  if (!id.ok) return id;
  const kind = expectEnumValue(raw.kind, `${path}.kind`, ["security"] as const);
  if (!kind.ok) return kind;
  const file = expectNonEmptyString(raw.file, `${path}.file`);
  if (!file.ok) return file;
  const anchor = expectNonEmptyString(raw.anchor, `${path}.anchor`);
  if (!anchor.ok) return anchor;
  const lines = parseFindingLines(raw.lines ?? null, `${path}.lines`);
  if (!lines.ok) return lines;
  const title = expectNonEmptyString(raw.title, `${path}.title`);
  if (!title.ok) return title;
  const body = expectNonEmptyString(raw.body, `${path}.body`);
  if (!body.ok) return body;
  const severity = expectEnumValue(
    raw.severity,
    `${path}.severity`,
    SECURITY_SEVERITIES,
  );
  if (!severity.ok) return severity;
  const proofClass = expectEnumValue(
    raw.proofClass,
    `${path}.proofClass`,
    PROOF_CLASSES,
  );
  if (!proofClass.ok) return proofClass;
  const evidence = expectEnumValue(
    raw.evidence,
    `${path}.evidence`,
    EVIDENCE_QUALITIES,
  );
  if (!evidence.ok) return evidence;
  const footgun = expectNonEmptyString(
    raw.footgun ?? "none",
    `${path}.footgun`,
  );
  if (!footgun.ok) return footgun;
  const source = parseFindingSource(raw.source, `${path}.source`);
  if (!source.ok) return source;
  const asset = expectNonEmptyString(raw.asset, `${path}.asset`);
  if (!asset.ok) return asset;
  const entry = expectNonEmptyString(raw.entry, `${path}.entry`);
  if (!entry.ok) return entry;
  const sink = expectNonEmptyString(raw.sink, `${path}.sink`);
  if (!sink.ok) return sink;
  const trustBoundary = expectNonEmptyString(
    raw.trustBoundary,
    `${path}.trustBoundary`,
  );
  if (!trustBoundary.ok) return trustBoundary;
  const attackerPreconditions = expectNonEmptyString(
    raw.attackerPreconditions,
    `${path}.attackerPreconditions`,
  );
  if (!attackerPreconditions.ok) return attackerPreconditions;
  const confidence = expectEnumValue(
    raw.confidence,
    `${path}.confidence`,
    SECURITY_CONFIDENCES,
  );
  if (!confidence.ok) return confidence;
  const exploitability = expectNonEmptyString(
    raw.exploitability,
    `${path}.exploitability`,
  );
  if (!exploitability.ok) return exploitability;
  const blastRadius = expectNonEmptyString(
    raw.blastRadius,
    `${path}.blastRadius`,
  );
  if (!blastRadius.ok) return blastRadius;
  const proofOfFix = expectNonEmptyString(raw.proofOfFix, `${path}.proofOfFix`);
  if (!proofOfFix.ok) return proofOfFix;
  const diffMetadata = parseDiffMetadata(
    raw.diffMetadata,
    `${path}.diffMetadata`,
  );
  if (!diffMetadata.ok) return diffMetadata;
  return {
    ok: true,
    value: {
      id: id.value,
      kind: kind.value,
      file: file.value,
      anchor: anchor.value,
      lines: lines.value,
      title: title.value,
      body: body.value,
      severity: severity.value,
      proofClass: proofClass.value,
      evidence: evidence.value,
      footgun: footgun.value === "none" ? null : footgun.value,
      source: source.value,
      asset: asset.value,
      entry: entry.value,
      sink: sink.value,
      trustBoundary: trustBoundary.value,
      attackerPreconditions: attackerPreconditions.value,
      confidence: confidence.value,
      exploitability: exploitability.value,
      blastRadius: blastRadius.value,
      proofOfFix: proofOfFix.value,
      ...(diffMetadata.value ? { diffMetadata: diffMetadata.value } : {}),
    },
  };
}

function parseDiffMetadata(
  raw: unknown,
  path: string,
):
  | { ok: true; value: SecurityFinding["diffMetadata"] | null }
  | { ok: false; error: string } {
  if (raw === undefined || raw === null) return { ok: true, value: null };
  if (!isRecord(raw)) return { ok: false, error: `${path} must be an object` };
  const changedFileCount = expectNonNegativeInteger(
    raw.changedFileCount,
    `${path}.changedFileCount`,
  );
  if (!changedFileCount.ok) return changedFileCount;
  const riskyBuckets = expectStringArray(
    raw.riskyBuckets,
    `${path}.riskyBuckets`,
  );
  if (!riskyBuckets.ok) return riskyBuckets;
  const introduction = expectEnumValue(
    raw.introduction,
    `${path}.introduction`,
    ["added", "modified", "pre-existing context"] as const,
  );
  if (!introduction.ok) return introduction;
  return {
    ok: true,
    value: {
      changedFileCount: changedFileCount.value,
      riskyBuckets: riskyBuckets.value,
      introduction: introduction.value,
    },
  };
}

function parseSecurityIntegrity(
  raw: unknown,
): { ok: true; value: SecurityIntegrity } | { ok: false; error: string } {
  const base = parseBaseIntegrity(raw, "integrity");
  if (!base.ok) return base;
  if (!isRecord(raw))
    return { ok: false, error: "integrity must be an object" };
  const reviewMode = expectNonEmptyString(
    raw.reviewMode,
    "integrity.reviewMode",
  );
  if (!reviewMode.ok) return reviewMode;
  const provenance = expectEnumValue(raw.provenance, "integrity.provenance", [
    "trusted",
    "untrusted",
    "unknown",
  ] as const);
  if (!provenance.ok) return provenance;
  const surfacesScanned = expectStringArray(
    raw.surfacesScanned,
    "integrity.surfacesScanned",
  );
  if (!surfacesScanned.ok) return surfacesScanned;
  const surfacesSkipped = expectStringArray(
    raw.surfacesSkipped,
    "integrity.surfacesSkipped",
  );
  if (!surfacesSkipped.ok) return surfacesSkipped;
  const scannerTools = expectStringArray(
    raw.scannerTools,
    "integrity.scannerTools",
  );
  if (!scannerTools.ok) return scannerTools;
  const unavailableTools = expectStringArray(
    raw.unavailableTools,
    "integrity.unavailableTools",
  );
  if (!unavailableTools.ok) return unavailableTools;
  const proofClasses = parseCountRecord(
    raw.proofClasses,
    PROOF_CLASSES,
    "integrity.proofClasses",
  );
  if (!proofClasses.ok) return proofClasses;
  const confidence = parseCountRecord(
    raw.confidence,
    SECURITY_CONFIDENCES,
    "integrity.confidence",
  );
  if (!confidence.ok) return confidence;
  return {
    ok: true,
    value: {
      ...base.value,
      reviewMode: reviewMode.value,
      provenance: provenance.value,
      surfacesScanned: surfacesScanned.value,
      surfacesSkipped: surfacesSkipped.value,
      scannerTools: scannerTools.value,
      unavailableTools: unavailableTools.value,
      proofClasses: proofClasses.value as Record<ProofClass, number>,
      confidence: confidence.value as Record<SecurityConfidence, number>,
    },
  };
}

function parseCountRecord<T extends string>(
  raw: unknown,
  keys: readonly T[],
  path: string,
): { ok: true; value: Record<T, number> } | { ok: false; error: string } {
  if (!isRecord(raw)) return { ok: false, error: `${path} must be an object` };
  const value = {} as Record<T, number>;
  for (const key of keys) {
    const count = expectNonNegativeInteger(raw[key], `${path}.${key}`);
    if (!count.ok) return count;
    value[key] = count.value;
  }
  return { ok: true, value };
}

function parseActiveTestingGate(
  raw: unknown,
):
  | { ok: true; value: SecurityResult["activeTestingGate"] }
  | { ok: false; error: string } {
  if (!isRecord(raw))
    return { ok: false, error: "activeTestingGate must be an object" };
  if (typeof raw.required !== "boolean") {
    return { ok: false, error: "activeTestingGate.required must be a boolean" };
  }
  const reason = expectNonEmptyString(raw.reason, "activeTestingGate.reason");
  if (!reason.ok) return reason;
  const status = expectEnumValue(raw.status, "activeTestingGate.status", [
    "not-required",
    "pending",
    "complete",
    "blocked",
  ] as const);
  if (!status.ok) return status;
  return {
    ok: true,
    value: {
      required: raw.required,
      reason: reason.value,
      status: status.value,
    },
  };
}

function parsePersistGate(
  raw: unknown,
):
  | { ok: true; value: SecurityResult["persistGate"] }
  | { ok: false; error: string } {
  if (!isRecord(raw))
    return { ok: false, error: "persistGate must be an object" };
  const artifactPath = expectNonEmptyString(
    raw.artifactPath,
    "persistGate.artifactPath",
  );
  if (!artifactPath.ok) return artifactPath;
  if (typeof raw.wroteArtifact !== "boolean") {
    return { ok: false, error: "persistGate.wroteArtifact must be a boolean" };
  }
  const confirmation = expectNonEmptyString(
    raw.confirmation,
    "persistGate.confirmation",
  );
  if (!confirmation.ok) return confirmation;
  return {
    ok: true,
    value: {
      artifactPath: artifactPath.value,
      wroteArtifact: raw.wroteArtifact,
      confirmation: confirmation.value,
    },
  };
}
