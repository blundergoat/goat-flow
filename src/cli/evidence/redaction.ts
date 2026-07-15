/**
 * Redaction helpers for local evidence and user-readable durable artifacts.
 *
 * Sensitive runtime values are recorded as hashes plus byte length so local
 * continuity can compare values without storing raw tool bodies. Copyable
 * session, review, quality, and export text uses a separate pattern scrubber
 * so users retain useful context while common credential shapes disappear.
 */
import { createHash } from "node:crypto";

/** One ordered readable-text replacement used before a local artifact reaches disk. */
interface DurableTextRedactionRule {
  pattern: RegExp;
  replacement: string;
}

const DURABLE_TEXT_REDACTION_RULES: readonly DurableTextRedactionRule[] = [
  {
    pattern:
      /-----BEGIN ([A-Z0-9 ]*PRIVATE KEY)-----[\s\S]*?-----END \1-----/gu,
    replacement: "[REDACTED:private-key]",
  },
  {
    pattern: /^(\s*Authorization\s*:\s*(?:Bearer|Basic)\s+)\S.*$/gimu,
    replacement: "$1[REDACTED:authorization]",
  },
  {
    pattern: /^(\s*(?:Cookie|Set-Cookie)\s*:\s*).+$/gimu,
    replacement: "$1[REDACTED:cookie]",
  },
  {
    pattern:
      /^(\s*(?:export\s+)?[A-Z][A-Z0-9_]*(?:API_KEY|AUTH|COOKIE|PASSWORD|PASSWD|PRIVATE_KEY|SECRET|TOKEN)[A-Z0-9_]*\s*=\s*)(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s#\r\n]+)(.*)$/gimu,
    replacement: "$1[REDACTED:env-value]$2",
  },
  {
    pattern:
      /^(\s*["']?(?:api[_-]?key|access[_-]?token|auth[_-]?token|password|private[_-]?key|secret|token)["']?\s*:\s*)(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s,}\r\n]+)(\s*[,}]?)$/gimu,
    replacement: '$1"[REDACTED:field]"$2',
  },
  {
    pattern:
      /((?:^|[^\S\r\n])--(?:api-key|auth-token|password|secret|token)(?:=|\s+))(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s\r\n]+)/gimu,
    replacement: "$1[REDACTED:argument]",
  },
  {
    pattern:
      /([?&](?:access[_-]?token|api[_-]?key|auth|secret|token)=)[^&#\s"']+/giu,
    replacement: "$1[REDACTED:url-value]",
  },
  {
    pattern:
      /\b(?:gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,}|npm_[A-Za-z0-9]{20,}|sk-(?:proj-)?[A-Za-z0-9_-]{20,})\b/gu,
    replacement: "[REDACTED:token]",
  },
] as const;

/** Hash-only representation of sensitive evidence text safe for local persistence. */
export interface RedactedEvidenceValue {
  kind: "redacted";
  label: string;
  sha256: string;
  length: number;
}

/**
 * Return a deterministic hash/length summary for sensitive text.
 *
 * @param label - human-readable evidence field name; an empty label remains empty metadata
 * @param value - sensitive text to hash; empty text produces a stable zero-length summary
 * @returns hash metadata for same/different comparison without readable source content
 */
export function redactEvidenceText(
  label: string,
  value: string,
): RedactedEvidenceValue {
  const buffer = Buffer.from(value, "utf-8");
  return {
    kind: "redacted",
    label,
    sha256: createHash("sha256").update(buffer).digest("hex"),
    length: buffer.byteLength,
  };
}

/**
 * Replace common credential shapes while preserving readable continuation context.
 * Use before session, review, quality, security, or export text reaches disk.
 *
 * @param value - candidate durable text; an empty string remains empty
 * @returns scrubbed readable text, or the original text when no rule matches
 */
export function scrubDurableText(value: string): string {
  return DURABLE_TEXT_REDACTION_RULES.reduce(
    (scrubbedText, redactionRule) =>
      scrubbedText.replace(redactionRule.pattern, redactionRule.replacement),
    value,
  );
}

/**
 * Check whether an envelope value already uses hash-only redaction metadata.
 *
 * @param value - unknown payload value; null, empty, arrays, and primitives return false
 * @returns true only for a complete redacted evidence object
 */
export function isRedactedEvidenceValue(
  value: unknown,
): value is RedactedEvidenceValue {
  // Missing or non-record values cannot represent safe evidence in the user's event history.
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    record.kind === "redacted" &&
    typeof record.label === "string" &&
    typeof record.sha256 === "string" &&
    /^[a-f0-9]{64}$/u.test(record.sha256) &&
    typeof record.length === "number" &&
    Number.isInteger(record.length) &&
    record.length >= 0
  );
}
