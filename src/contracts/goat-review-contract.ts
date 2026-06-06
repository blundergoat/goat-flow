import type { BaseFinding, BaseIntegrity } from "./goat-flow-contract-shared.js";

export type ReviewAction =
  | "patch"
  | "needs-decision"
  | "pre-existing"
  | "intent-mismatch"
  | "needs-signal";

export type ReviewSeverity = "MUST" | "SHOULD" | "MAY";

export type ShipDecision = "SHIP" | "SHIP_WITH_CONDITIONS" | "NO" | "PARTIAL";

export interface ReviewFinding extends BaseFinding {
  kind: "review";
  severity: ReviewSeverity;
  action: ReviewAction;
  overlapTag: "confirmed-cross-model" | "cross-model-unresolved" | null;
}

export interface ReviewSpecDriftEntry {
  tag: "advisory" | "ready-to-tick";
  title: string;
  body: string;
}

export interface ReviewRefuterSummary {
  ran: boolean;
  confirmed: number;
  refuted: number;
  unresolved: number;
  leadsVerifiedByHost: number;
  model: string | null;
}

export interface ShipVerdict {
  decision: ShipDecision;
  confidence: "HIGH" | "MEDIUM" | "LOW";
  reasoning: string;
  conditions: string[];
}

export interface ReviewResult {
  resultKind: "goat-flow-review-result";
  contractVersion: "1";
  generatedAt: string;
  target: {
    projectPath: string;
    base: string | null;
    head: string | null;
    source: "diff" | "area" | "artifact";
  };
  integrity: BaseIntegrity & {
    refutationsLogged: number;
    size: { files: number; lines: number; chunked: string | null };
  };
  findings: ReviewFinding[];
  specDrift: ReviewSpecDriftEntry[];
  refuter: ReviewRefuterSummary;
  shipVerdict: ShipVerdict;
}
