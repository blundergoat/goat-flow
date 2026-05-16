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

interface SarifMessage {
  text: string;
}

interface SarifArtifactLocation {
  uri: string;
}

interface SarifRegion {
  startLine?: number;
}

interface SarifPhysicalLocation {
  artifactLocation: SarifArtifactLocation;
  region?: SarifRegion;
}

interface SarifLocation {
  physicalLocation: SarifPhysicalLocation;
}

interface SarifSuppression {
  kind: "external";
  justification: string;
}

interface SarifPropertyBag {
  [key: string]: unknown;
}

interface SarifReportingDescriptor {
  id: string;
  name: string;
  shortDescription?: SarifMessage;
  fullDescription?: SarifMessage;
  helpUri?: string;
  properties?: SarifPropertyBag;
}

interface SarifResult {
  ruleId: string;
  level: SarifLevel;
  message: SarifMessage;
  locations?: SarifLocation[];
  suppressions?: SarifSuppression[];
  partialFingerprints: Record<string, string>;
  properties?: SarifPropertyBag;
}

interface SarifToolComponent {
  name: string;
  informationUri: string;
  semanticVersion: string;
  rules: SarifReportingDescriptor[];
}

interface SarifRun {
  tool: {
    driver: SarifToolComponent;
  };
  results: SarifResult[];
}

interface SarifLog {
  $schema: string;
  version: "2.1.0";
  runs: SarifRun[];
}

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

/** Render an AuditReport as a SARIF 2.1.0 JSON string. */
export function renderAuditSarif(report: AuditReport): string {
  return JSON.stringify(buildAuditSarifLog(report), null, 2);
}

/** Build the SARIF log object before JSON serialization. */
export function buildAuditSarifLog(report: AuditReport): SarifLog {
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

function levelFromImpact(impact: CheckImpact): SarifLevel {
  if (impact === "scope-fail") return "error";
  if (impact === "score-only") return "warning";
  return "note";
}

function locationsFromCheck(check: CheckResult): SarifLocation[] {
  const paths = [
    ...(check.provenance.target_evidence_paths ?? []),
    ...(check.provenance.evidence_paths ?? []),
  ];
  return locationsFromPaths(paths);
}

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

function locationsFromPaths(paths: string[]): SarifLocation[] {
  for (const path of paths) {
    const locations = locationsFromPath(path);
    if (locations.length > 0) return locations;
  }
  return [];
}

function normalizeRepoUri(path: string): string | null {
  const trimmed = path.trim().replace(/\\/g, "/");
  if (trimmed === "") return null;
  if (trimmed.startsWith("/")) return null;
  if (/^[a-z][a-z0-9+.-]*:/iu.test(trimmed)) return null;
  if (trimmed.split("/").includes("..")) return null;
  return trimmed.replace(/^\.\//u, "");
}

function driftRuleId(kind: DriftKind): string {
  return `drift:${kind}`;
}

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

function compareScope(left: SarifScope, right: SarifScope): number {
  return SCOPE_ORDER[left] - SCOPE_ORDER[right];
}

function compareString(left: string, right: string): number {
  return left.localeCompare(right, "en");
}

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
