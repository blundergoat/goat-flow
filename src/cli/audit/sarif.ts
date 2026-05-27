/**
 * SARIF 2.1.0 renderer for `goat-flow audit`.
 *
 * This is a renderer-only export: it maps the existing AuditReport contract to
 * SARIF without changing audit status, scoring, or check semantics.
 */
import { AUDIT_VERSION } from "../constants.js";
import type {
  AuditFailure,
  AuditReport,
  AuditScope,
  CheckImpact,
  CheckResult,
  ContentFinding,
  DriftFinding,
} from "./types.js";

const SARIF_SCHEMA_URI =
  "https://docs.oasis-open.org/sarif/sarif/v2.1.0/errata01/os/schemas/sarif-schema-2.1.0.json";
const TOOL_INFORMATION_URI = "https://github.com/blundergoat/goat-flow";
const ACKNOWLEDGED_SUPPRESSION =
  "Acknowledged by goat-flow harness configuration.";

type SarifScope = "setup" | "agent" | "harness" | "drift" | "content";
type SarifLevel = "error" | "warning" | "note" | "none";

/** Minimal SARIF message shape used by this renderer; audit text is already plain text. */
interface SarifMessage {
  text: string;
}

/** Repo-relative artifact reference accepted by SARIF uploaders. */
interface SarifArtifactLocation {
  uri: string;
}

/** Location detail is intentionally line-only because audit evidence does not track columns. */
interface SarifRegion {
  startLine?: number;
}

/** SARIF nests file and region under physicalLocation even when only a file URI exists. */
interface SarifPhysicalLocation {
  artifactLocation: SarifArtifactLocation;
  region?: SarifRegion;
}

/** Result locations are omitted entirely when goat-flow evidence is not file-addressable. */
interface SarifLocation {
  physicalLocation: SarifPhysicalLocation;
}

/** External suppressions preserve acknowledged audit findings without marking them as fixed. */
interface SarifSuppression {
  kind: "external";
  justification: string;
}

/** Extension bag for goat-flow fields that have no first-class SARIF slot. */
interface SarifPropertyBag {
  [key: string]: unknown;
}

/** Registered rule metadata shared by all SARIF results using the same audit check id. */
interface SarifReportingDescriptor {
  id: string;
  name: string;
  shortDescription?: SarifMessage;
  fullDescription?: SarifMessage;
  helpUri?: string;
  properties?: SarifPropertyBag;
}

/** Audit finding projected into SARIF with a stable fingerprint for downstream dedupe. */
interface SarifResult {
  ruleId: string;
  level: SarifLevel;
  message: SarifMessage;
  locations?: SarifLocation[];
  suppressions?: SarifSuppression[];
  partialFingerprints: Record<string, string>;
  properties?: SarifPropertyBag;
}

/** Tool driver block shown by SARIF consumers, pinned to the audit renderer version. */
interface SarifToolComponent {
  name: string;
  informationUri: string;
  semanticVersion: string;
  rules: SarifReportingDescriptor[];
}

/** A single goat-flow audit invocation produces exactly one SARIF run. */
interface SarifRun {
  tool: {
    driver: SarifToolComponent;
  };
  results: SarifResult[];
}

/** Top-level SARIF document shape emitted by `audit --format sarif`. */
interface SarifLog {
  $schema: string;
  version: "2.1.0";
  runs: SarifRun[];
}

/** Couples rule descriptors to goat-flow scopes so sorting stays deterministic. */
interface RuleRegistration {
  scope: SarifScope;
  descriptor: SarifReportingDescriptor;
}

type DriftKind = DriftFinding["kind"];

const SCOPE_ORDER: Record<SarifScope, number> = {
  setup: 0,
  agent: 1,
  harness: 2,
  drift: 3,
  content: 4,
};

const DRIFT_RULE_DESCRIPTIONS: Record<DriftKind, string> = {
  content: "Installed skill content differs from the goat-flow template.",
  missing:
    "A goat-flow skill mirror expected in the target project is missing.",
  orphan:
    "A goat-flow skill mirror exists without a matching current template.",
  deprecated:
    "A deprecated goat-flow skill mirror exists in the target project.",
};

/**
 * Render an AuditReport as a SARIF 2.1.0 JSON string.
 *
 * @param report - Completed goat-flow audit report to project into SARIF.
 * @returns Pretty-printed SARIF JSON ready for stdout or `--output`.
 */
export function renderAuditSarif(report: AuditReport): string {
  return JSON.stringify(buildAuditSarifLog(report), null, 2);
}

/**
 * Build the SARIF log object before JSON serialization.
 *
 * Invariant: rule and result order must stay deterministic because CI uploads
 * and code-scanning baselines diff SARIF across runs.
 */
function buildAuditSarifLog(report: AuditReport): SarifLog {
  const rules = new Map<string, RuleRegistration>();
  const results: SarifResult[] = [];

  collectScope(rules, results, "setup", report.scopes.setup);
  collectScope(rules, results, "agent", report.scopes.agent);
  if (report.scopes.harness) {
    collectScope(rules, results, "harness", report.scopes.harness);
  }
  if (report.drift) {
    collectDrift(rules, results, report.drift.findings);
  }
  if (report.content) {
    collectContent(rules, results, report.content.findings);
  }

  const orderedRules = [...rules.values()]
    .sort(compareRuleRegistrations)
    .map((registration) => registration.descriptor);
  const orderedResults = results.sort(compareResults);

  return {
    $schema: SARIF_SCHEMA_URI,
    version: "2.1.0",
    runs: [
      {
        tool: {
          driver: {
            name: "goat-flow",
            informationUri: TOOL_INFORMATION_URI,
            semanticVersion: AUDIT_VERSION,
            rules: orderedRules,
          },
        },
        results: orderedResults,
      },
    ],
  };
}

function collectScope(
  rules: Map<string, RuleRegistration>,
  results: SarifResult[],
  scope: SarifScope,
  auditScope: AuditScope,
): void {
  for (const check of auditScope.checks) {
    registerRule(rules, scope, ruleFromCheck(scope, check));
    if (check.status !== "fail" || !check.failure) continue;
    results.push(resultFromCheck(scope, check, check.failure));
  }
}

function collectDrift(
  rules: Map<string, RuleRegistration>,
  results: SarifResult[],
  findings: DriftFinding[],
): void {
  for (const kind of Object.keys(DRIFT_RULE_DESCRIPTIONS) as DriftKind[]) {
    const id = driftRuleId(kind);
    registerRule(rules, "drift", {
      id,
      name: `Skill template drift: ${kind}`,
      shortDescription: { text: DRIFT_RULE_DESCRIPTIONS[kind] },
      properties: {
        scope: "drift",
        kind,
      },
    });
  }

  for (const finding of findings) {
    const ruleId = driftRuleId(finding.kind);
    const locations = locationsFromPath(finding.path);
    results.push({
      ruleId,
      level: "error",
      message: { text: finding.message },
      ...(locations.length > 0 ? { locations } : {}),
      partialFingerprints: fingerprintFor(
        "drift",
        ruleId,
        locationUri(locations),
        finding.message,
      ),
      properties: {
        scope: "drift",
        kind: finding.kind,
        path: finding.path,
      },
    });
  }
}

function collectContent(
  rules: Map<string, RuleRegistration>,
  results: SarifResult[],
  findings: ContentFinding[],
): void {
  for (const finding of findings) {
    const ruleId = contentRuleId(finding.rule);
    registerRule(rules, "content", {
      id: ruleId,
      name: `Content lint: ${finding.rule}`,
      shortDescription: {
        text: `Cold-path content lint rule ${finding.rule}.`,
      },
      properties: {
        scope: "content",
        contentRule: finding.rule,
      },
    });

    const locations = locationsFromPath(finding.path, finding.line);
    results.push({
      ruleId,
      level: finding.severity === "warning" ? "warning" : "note",
      message: { text: finding.message },
      ...(locations.length > 0 ? { locations } : {}),
      partialFingerprints: fingerprintFor(
        "content",
        ruleId,
        locationUri(locations),
        finding.message,
      ),
      properties: {
        scope: "content",
        severity: finding.severity,
        contentRule: finding.rule,
        path: finding.path,
        ...(finding.line !== undefined ? { line: finding.line } : {}),
        ...(finding.suggestion ? { suggestion: finding.suggestion } : {}),
      },
    });
  }
}

function registerRule(
  rules: Map<string, RuleRegistration>,
  scope: SarifScope,
  descriptor: SarifReportingDescriptor,
): void {
  if (rules.has(descriptor.id)) return;
  rules.set(descriptor.id, { scope, descriptor });
}

function ruleFromCheck(
  scope: SarifScope,
  check: CheckResult,
): SarifReportingDescriptor {
  return {
    id: check.id,
    name: check.name,
    shortDescription: { text: check.name },
    helpUri: check.provenance.source_urls[0],
    properties: {
      scope,
      impact: check.impact,
      status: check.status,
      displayStatus: check.displayStatus,
      provenance: check.provenance,
      ...(check.type ? { type: check.type } : {}),
      ...(check.evidenceKind ? { evidenceKind: check.evidenceKind } : {}),
      ...(check.assurance ? { assurance: check.assurance } : {}),
    },
  };
}

function resultFromCheck(
  scope: SarifScope,
  check: CheckResult,
  failure: AuditFailure,
): SarifResult {
  const locations = locationsFromCheck(check);
  const messageText = failure.message;
  return {
    ruleId: check.id,
    level: levelFromImpact(check.impact),
    message: { text: messageText },
    ...(locations.length > 0 ? { locations } : {}),
    ...(check.acknowledged === true
      ? {
          suppressions: [
            {
              kind: "external" as const,
              justification: ACKNOWLEDGED_SUPPRESSION,
            },
          ],
        }
      : {}),
    partialFingerprints: fingerprintFor(
      scope,
      check.id,
      locationUri(locations),
      messageText,
    ),
    properties: {
      scope,
      status: check.status,
      displayStatus: check.displayStatus,
      impact: check.impact,
      check: failure.check,
      provenance: check.provenance,
      ...(failure.evidence ? { evidence: failure.evidence } : {}),
      ...(failure.howToFix ? { howToFix: failure.howToFix } : {}),
      ...(check.type ? { type: check.type } : {}),
      ...(check.acknowledged !== undefined
        ? { acknowledged: check.acknowledged }
        : {}),
      ...(check.evidenceKind ? { evidenceKind: check.evidenceKind } : {}),
      ...(check.assurance ? { assurance: check.assurance } : {}),
    },
  };
}

/** Map goat-flow audit impact to the closest SARIF level without changing audit semantics. */
function levelFromImpact(impact: CheckImpact): SarifLevel {
  if (impact === "scope-fail") return "error";
  if (impact === "score-only") return "warning";
  return "note";
}

/** Prefer target evidence so SARIF annotations point at the files users can change first. */
function locationsFromCheck(check: CheckResult): SarifLocation[] {
  const paths = [
    ...(check.provenance.target_evidence_paths ?? []),
    ...(check.provenance.evidence_paths ?? []),
  ];
  return locationsFromPaths(paths);
}

/**
 * Convert a single safe repo path into a SARIF location.
 *
 * Unsafe paths return no locations because SARIF uploads should omit
 * annotations rather than leak host paths or invent placeholder files.
 */
function locationsFromPath(path: string, line?: number): SarifLocation[] {
  const uri = normalizeRepoUri(path);
  if (!uri) return [];
  return [
    {
      physicalLocation: {
        artifactLocation: { uri },
        ...(line !== undefined ? { region: { startLine: line } } : {}),
      },
    },
  ];
}

/** Use only the first addressable evidence path because one result should create one annotation. */
function locationsFromPaths(paths: string[]): SarifLocation[] {
  for (const path of paths) {
    const locations = locationsFromPath(path);
    if (locations.length > 0) return locations;
  }
  return [];
}

/** Keep SARIF URIs repo-relative and prevent local paths or URI schemes from leaking. */
function normalizeRepoUri(path: string): string | null {
  const trimmed = path.trim().replace(/\\/g, "/");
  if (trimmed === "") return null;
  if (trimmed.startsWith("/")) return null;
  if (/^[a-z][a-z0-9+.-]*:/iu.test(trimmed)) return null;
  if (trimmed.split("/").includes("..")) return null;
  return trimmed.replace(/^\.\//u, "");
}

/** Namespace drift rules away from setup check ids so SARIF rule identities cannot collide. */
function driftRuleId(kind: DriftKind): string {
  return `drift:${kind}`;
}

/** Namespace content lint rules away from setup check ids so downstream alerts stay distinct. */
function contentRuleId(rule: string): string {
  return `content:${rule}`;
}

function compareRuleRegistrations(
  left: RuleRegistration,
  right: RuleRegistration,
): number {
  return (
    compareScope(left.scope, right.scope) ||
    compareString(left.descriptor.id, right.descriptor.id)
  );
}

/** Deterministic result ordering keeps SARIF diffs focused on finding changes. */
function compareResults(left: SarifResult, right: SarifResult): number {
  return (
    compareScope(resultScope(left), resultScope(right)) ||
    compareString(left.ruleId, right.ruleId) ||
    compareString(
      locationUri(left.locations ?? []),
      locationUri(right.locations ?? []),
    ) ||
    compareString(left.message.text, right.message.text)
  );
}

/** Treat malformed extension properties as setup scope so sorting never throws. */
function resultScope(result: SarifResult): SarifScope {
  const scope = result.properties?.scope;
  if (
    scope === "setup" ||
    scope === "agent" ||
    scope === "harness" ||
    scope === "drift" ||
    scope === "content"
  ) {
    return scope;
  }
  return "setup";
}

/** Compare scopes in the same order the audit summary presents them. */
function compareScope(left: SarifScope, right: SarifScope): number {
  return SCOPE_ORDER[left] - SCOPE_ORDER[right];
}

/** Locale-pinned string comparison avoids host-locale drift in generated SARIF. */
function compareString(left: string, right: string): number {
  return left.localeCompare(right, "en");
}

/** Empty URI keeps unlocated results sortable and fingerprintable without fake paths. */
function locationUri(locations: SarifLocation[]): string {
  return locations[0]?.physicalLocation.artifactLocation.uri ?? "";
}

function fingerprintFor(
  scope: SarifScope,
  ruleId: string,
  uri: string,
  message: string,
): Record<string, string> {
  return {
    "goatFlowAudit/v1": [scope, ruleId, uri, message].join("|"),
  };
}
