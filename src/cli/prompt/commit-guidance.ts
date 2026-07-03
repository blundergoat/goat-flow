/**
 * Generate project-local commit guidance from recent git history.
 * The detector prefers existing project convention over goat-flow defaults so installed guidance
 * helps future agents write useful commit subjects instead of generic "improve/clarify" summaries.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

/**
 * Canonical project-relative location for generated commit guidance.
 *
 * A docs path - not a bespoke .github file - because IDEs only auto-read .github/copilot-instructions.md;
 * the instruction file points here, so one doc serves humans and every agent. See ADR-031.
 */
const GIT_COMMIT_INSTRUCTIONS_PATH = "docs/coding-standards/git-commit.md";

type CommitSubjectKind = "conventional" | "ticket-prefixed" | "free-form";

type CommitGuidanceStatus =
  CommitSubjectKind | "mixed" | "insufficient-history";

/** Subject-style tallies from the recent commit sample used to choose a dominant convention. */
interface CommitConventionCounts {
  conventional: number;
  ticketPrefixed: number;
  freeForm: number;
}

/** Observed commit-history style and metadata rendered into `docs/coding-standards/git-commit.md`. */
export interface CommitConventionDetection {
  status: CommitGuidanceStatus;
  total: number;
  counts: CommitConventionCounts;
  conventionalTypes: string[];
  subjectLengthP95: number | null;
  bodiesUsed: boolean;
  coAuthoredBy: boolean;
  signedOffBy: boolean;
  ticketPrefixPattern: string | null;
  exampleSubject: string | null;
  gitAvailable: boolean;
}

/** Outcome from trying to create commit guidance without overwriting user-maintained instructions. */
export interface CommitGuidanceWriteResult {
  status: "written" | "skipped-existing";
  path: string;
  detection: CommitConventionDetection | null;
}

/** Parsed git log record after separating the first-line subject from the optional body. */
interface ParsedCommitMessage {
  subject: string;
  body: string;
  kind: CommitSubjectKind;
}

const CONVENTIONAL_SUBJECT_RE =
  /^(?<type>[a-z][a-z0-9-]*)(?:\([^)]+\))?!?: .+/u;
const TICKET_SUBJECT_RE =
  /^(?:\[(?<bracketKey>[A-Z][A-Z0-9]+-\d+)\]|(?<plainKey>[A-Z][A-Z0-9]+-\d+))(?::|\s)\s*.+/u;

/** Build the fallback detection used when git history cannot support a project-specific rule. */
function emptyDetection(gitAvailable: boolean): CommitConventionDetection {
  return {
    status: "insufficient-history",
    total: 0,
    counts: { conventional: 0, ticketPrefixed: 0, freeForm: 0 },
    conventionalTypes: [],
    subjectLengthP95: null,
    bodiesUsed: false,
    coAuthoredBy: false,
    signedOffBy: false,
    ticketPrefixPattern: null,
    exampleSubject: null,
    gitAvailable,
  };
}

/** Classify one commit subject before aggregate style detection chooses a dominant convention. */
function classifySubject(subject: string): CommitSubjectKind {
  if (CONVENTIONAL_SUBJECT_RE.test(subject)) return "conventional";
  if (TICKET_SUBJECT_RE.test(subject)) return "ticket-prefixed";
  return "free-form";
}

/** Parse `git log --format=%B%x1e` output while preserving commit bodies for trailer detection. */
function parseMessages(output: string): ParsedCommitMessage[] {
  return output
    .split("\x1e")
    .map((raw) => raw.trim())
    .filter((raw) => raw.length > 0)
    .map((raw) => {
      const [subjectLine = "", ...bodyLines] = raw.split(/\r?\n/u);
      const subject = subjectLine.trim();
      return {
        subject,
        body: bodyLines.join("\n").trim(),
        kind: classifySubject(subject),
      };
    })
    .filter((message) => message.subject.length > 0);
}

/** Stable p95 subject-length helper; one extreme commit must not set generated guidance. */
function percentile95(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.max(0, Math.ceil(sorted.length * 0.95) - 1);
  return sorted[index] ?? null;
}

/** Mutates a local frequency map, then returns deterministic conventional types for generated examples. */
function conventionalTypes(messages: ParsedCommitMessage[]): string[] {
  const counts = new Map<string, number>();
  for (const message of messages) {
    const match = CONVENTIONAL_SUBJECT_RE.exec(message.subject);
    const type = match?.groups?.type;
    if (!type) continue;
    counts.set(type, (counts.get(type) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort(([a, aCount], [b, bCount]) => bCount - aCount || a.localeCompare(b))
    .map(([type]) => type);
}

/** Reads the ticket project key without baking one tracker name into the regex. */
function ticketPrefix(subject: string): string | null {
  const match = TICKET_SUBJECT_RE.exec(subject);
  const ticket = match?.groups?.bracketKey ?? match?.groups?.plainKey;
  if (!ticket) return null;
  return ticket.split("-")[0] ?? null;
}

function collectTicketPrefixes(
  messages: ParsedCommitMessage[],
): Map<string, number> {
  const prefixes = new Map<string, number>();
  for (const message of messages) {
    const prefix = ticketPrefix(message.subject);
    if (!prefix) continue;
    prefixes.set(prefix, (prefixes.get(prefix) ?? 0) + 1);
  }
  return prefixes;
}

/** Infer a narrow ticket prefix only when history consistently uses one project key. */
function ticketPrefixPattern(messages: ParsedCommitMessage[]): string | null {
  const prefixes = collectTicketPrefixes(messages);
  if (prefixes.size === 0) return null;
  if (prefixes.size === 1) {
    const prefix = prefixes.keys().next().value;
    if (typeof prefix !== "string") return null;
    return `^${prefix}-\\d+`;
  }
  return "^[A-Z][A-Z0-9]+-\\d+";
}

function dominantStatus(
  counts: CommitConventionCounts,
  total: number,
): CommitGuidanceStatus {
  const threshold = total * 0.7;
  if (counts.conventional >= threshold) return "conventional";
  if (counts.ticketPrefixed >= threshold) return "ticket-prefixed";
  if (counts.freeForm >= threshold) return "free-form";
  return "mixed";
}

/** Count classified subjects once so rendering and dominance decisions use the same sample. */
function countsFor(messages: ParsedCommitMessage[]): CommitConventionCounts {
  return messages.reduce<CommitConventionCounts>(
    (counts, message) => {
      if (message.kind === "conventional") counts.conventional += 1;
      if (message.kind === "ticket-prefixed") counts.ticketPrefixed += 1;
      if (message.kind === "free-form") counts.freeForm += 1;
      return counts;
    },
    { conventional: 0, ticketPrefixed: 0, freeForm: 0 },
  );
}

function exampleFor(
  messages: ParsedCommitMessage[],
  status: CommitGuidanceStatus,
): string | null {
  if (status === "mixed" || status === "insufficient-history") {
    return messages[0]?.subject ?? null;
  }
  return (
    messages.find((message) => message.kind === status)?.subject ??
    messages[0]?.subject ??
    null
  );
}

function detectCommitConventions(
  targetRoot: string,
): CommitConventionDetection {
  const root = resolve(targetRoot);
  const result = spawnSync(
    "git",
    ["-C", root, "log", "-n", "100", "--format=%B%x1e"],
    {
      encoding: "utf-8",
      timeout: 5000,
      maxBuffer: 1024 * 1024,
    },
  );

  if (result.error || result.status !== 0) {
    return emptyDetection(false);
  }

  const messages = parseMessages(result.stdout);
  if (messages.length < 10) {
    return {
      ...emptyDetection(true),
      total: messages.length,
      exampleSubject: messages[0]?.subject ?? null,
    };
  }

  const counts = countsFor(messages);
  const status = dominantStatus(counts, messages.length);
  const allMessageText = messages
    .map((message) => `${message.subject}\n${message.body}`)
    .join("\n");

  return {
    status,
    total: messages.length,
    counts,
    conventionalTypes: conventionalTypes(messages),
    subjectLengthP95: percentile95(
      messages.map((message) => message.subject.length),
    ),
    bodiesUsed: messages.some((message) => message.body.length > 0),
    coAuthoredBy: /^co-authored-by:/imu.test(allMessageText),
    signedOffBy: /^signed-off-by:/imu.test(allMessageText),
    ticketPrefixPattern: ticketPrefixPattern(messages),
    exampleSubject: exampleFor(messages, status),
    gitAvailable: true,
  };
}

/** Render style counts as evidence so generated guidance is reviewable instead of opaque. */
function renderCounts(detection: CommitConventionDetection): string[] {
  return [
    `- Conventional commits: ${detection.counts.conventional}`,
    `- Ticket-prefixed subjects: ${detection.counts.ticketPrefixed}`,
    `- Free-form subjects: ${detection.counts.freeForm}`,
  ];
}

function renderObservedMetadata(
  detection: CommitConventionDetection,
): string[] {
  const lines = [
    `- Sampled commits: ${detection.total}`,
    `- Subject length p95: ${detection.subjectLengthP95 ?? "n/a"} characters`,
    `- Bodies observed: ${detection.bodiesUsed ? "yes" : "no"}`,
    `- Co-authored-by trailers observed: ${detection.coAuthoredBy ? "yes" : "no"}`,
    `- Signed-off-by trailers observed: ${detection.signedOffBy ? "yes" : "no"}`,
  ];
  if (detection.exampleSubject) {
    lines.push(`- Example from history: \`${detection.exampleSubject}\``);
  }
  return lines;
}

/** Render editable fallback guidance when history is unavailable or too small to trust. */
function renderStub(detection: CommitConventionDetection): string {
  const reason = detection.gitAvailable
    ? `only ${detection.total} recent commits found`
    : "git history unavailable";
  return [
    "# Git Commit Instructions",
    "",
    "<!-- goat-flow: generated stub - insufficient git history; please edit -->",
    "",
    "Use concise conventional commits unless this project documents a different rule.",
    "",
    "## Format",
    "",
    "- Prefer `type(scope): subject` or `type: subject`.",
    "- Keep subjects imperative, concrete, and under 72 characters when practical.",
    "- Add a body when the motivation is not obvious from the subject.",
    "",
    `Stub reason: ${reason}.`,
    "",
  ].join("\n");
}

function renderGitCommitInstructions(
  detection: CommitConventionDetection,
): string {
  if (detection.status === "insufficient-history") return renderStub(detection);

  const lines = [
    "# Git Commit Instructions",
    "",
    "<!-- goat-flow: generated from recent git history; review and edit for project policy -->",
    "",
    "## Observed Commit Style",
    "",
    ...renderCounts(detection),
    "",
  ];

  if (detection.status === "conventional") {
    lines.push(
      "Use conventional commits because at least 70% of sampled subjects matched that style.",
      "",
      "## Format",
      "",
      "- Use `type(scope): subject` or `type: subject`.",
      `- Observed types: ${detection.conventionalTypes.join(", ") || "none"}.`,
      "- Keep the subject concrete: name the behavior, file family, or command that changed.",
      "- Add a body when the subject names more than one axis or the motivation is not obvious.",
      "",
    );
  } else if (detection.status === "ticket-prefixed") {
    lines.push(
      "Use ticket-prefixed commit subjects because at least 70% of sampled subjects matched that style.",
      "",
      "## Format",
      "",
      `- Prefix subjects with a ticket matching \`${detection.ticketPrefixPattern ?? "^[A-Z][A-Z0-9]+-\\d+"}\`.`,
      "- Keep the subject concrete and imperative after the ticket prefix.",
      "- Add a body when the change spans multiple behaviors or the motivation is not obvious.",
      "",
    );
  } else if (detection.status === "free-form") {
    lines.push(
      "Recent history is mostly free-form. Keep that style concise unless the project owner chooses a stricter convention.",
      "",
      "## Format",
      "",
      "- Use a concrete imperative subject.",
      "- Avoid vague subjects that only say the change improves or updates something.",
      "- Add a body when the change spans multiple behaviors or the motivation is not obvious.",
      "",
    );
  } else {
    lines.push(
      "TODO: choose the project commit style. Recent history is mixed, so goat-flow did not pick one silently.",
      "",
      "## Observed Patterns",
      "",
      ...renderCounts(detection),
      "",
      "After choosing a style, replace this TODO section with the project rule.",
      "",
    );
  }

  lines.push("## Evidence", "", ...renderObservedMetadata(detection), "");
  return lines.join("\n");
}

/**
 * Create the canonical commit-guidance doc from detected history, never clobbering existing rules.
 *
 * Writes docs/coding-standards/git-commit.md (creating parent dirs) only when it is absent, so a
 * project owner's hand-maintained conventions are preserved across re-installs. No .github/
 * directory is required - the doc lives under docs/ regardless of which agent is installed.
 *
 * @param targetRoot - Project root to write commit guidance into; resolved to an absolute path.
 * @returns A result describing whether the doc was written or skipped because one already exists, plus the detection used.
 */
export function ensureGitCommitInstructions(
  targetRoot: string,
): CommitGuidanceWriteResult {
  const root = resolve(targetRoot);
  const outputPath = join(root, GIT_COMMIT_INSTRUCTIONS_PATH);

  if (existsSync(outputPath)) {
    return {
      status: "skipped-existing",
      path: GIT_COMMIT_INSTRUCTIONS_PATH,
      detection: null,
    };
  }

  const detection = detectCommitConventions(root);
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, renderGitCommitInstructions(detection), "utf-8");
  return {
    status: "written",
    path: GIT_COMMIT_INSTRUCTIONS_PATH,
    detection,
  };
}
