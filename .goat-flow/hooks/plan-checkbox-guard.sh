#!/usr/bin/env bash
# plan-checkbox-guard.sh
# goat-flow-hook-version: 1.12.0
#
# Universal Stop hook that catches changed-work / unchanged-plan drift.
# It is workflow hygiene only: it does not run tests, linters, builds, or
# project-specific validation commands.

set -uo pipefail

if ! command -v node >/dev/null 2>&1; then
  printf 'plan-checkbox-guard: node unavailable; cannot inspect plan state.\n' >&2
  exit 1
fi

payload="$(cat)"
PLAN_CHECKBOX_GUARD_PAYLOAD="$payload" node --input-type=module <<'NODE'
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, relative, resolve, sep } from "node:path";

const STATE_RELATIVE_PATH = ".goat-flow/logs/plan-guard-state.json";
const CONFIG_RELATIVE_PATH = ".goat-flow/config.yaml";
const ACTIVE_MARKER_RELATIVE_PATH = ".goat-flow/plans/.active";
const DEFAULT_CONFIG = {
  enabled: true,
  searchPaths: [".goat-flow/plans"],
  maxDepth: 3,
  stalenessDays: 14,
  planFile: null,
};
const FINAL_STATUSES = new Set([
  "done",
  "complete",
  "completed",
  "shelved",
  "archived",
]);
const SKIPPED_PLAN_BASENAMES = new Set(["README.md", "backlog.md"]);

function stderr(message) {
  process.stderr.write(`plan-checkbox-guard: ${message}\n`);
}

function exitWith(code, message) {
  if (message) stderr(message);
  process.exit(code);
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function git(args, options = {}) {
  return execFileSync("git", args, {
    cwd: options.cwd,
    encoding: options.encoding ?? "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function gitBuffer(args, cwd) {
  return execFileSync("git", args, {
    cwd,
    encoding: "buffer",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function currentGitRoot() {
  try {
    return git(["rev-parse", "--show-toplevel"], { cwd: process.cwd() }).trim();
  } catch {
    return null;
  }
}

function parsePayload() {
  const raw = process.env.PLAN_CHECKBOX_GUARD_PAYLOAD ?? "";
  if (raw.trim() === "") return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed
      : {};
  } catch {
    exitWith(1, "malformed Stop hook payload JSON; skipped plan guard check.");
  }
}

function firstString(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim() !== "") return value.trim();
  }
  return null;
}

function isTruthy(value) {
  return value === true || value === "true" || value === 1 || value === "1";
}

function stripInlineComment(value) {
  return value.replace(/\s+#.*$/u, "").trim();
}

function unquote(value) {
  const trimmed = stripInlineComment(value);
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function parseScalar(value) {
  const cleaned = unquote(value);
  if (cleaned === "true") return true;
  if (cleaned === "false") return false;
  const number = Number(cleaned);
  if (cleaned !== "" && Number.isFinite(number)) return number;
  return cleaned;
}

function parseInlineList(value) {
  const cleaned = stripInlineComment(value);
  if (!cleaned.startsWith("[") || !cleaned.endsWith("]")) return null;
  return cleaned
    .slice(1, -1)
    .split(",")
    .map((item) => unquote(item))
    .filter((item) => item.length > 0);
}

function readPlanGuardConfig(root) {
  const configPath = join(root, CONFIG_RELATIVE_PATH);
  if (!existsSync(configPath)) return { ...DEFAULT_CONFIG };
  const lines = readFileSync(configPath, "utf8").split(/\r?\n/u);
  const config = { ...DEFAULT_CONFIG, searchPaths: [...DEFAULT_CONFIG.searchPaths] };
  let inBlock = false;
  let inList = null;
  let collectedSearchPaths = null;

  for (const line of lines) {
    if (/^\S/u.test(line) && !/^plan-guard\s*:/u.test(line)) {
      inBlock = false;
      inList = null;
    }
    if (/^plan-guard\s*:/u.test(line)) {
      inBlock = true;
      inList = null;
      continue;
    }
    if (!inBlock) continue;

    const listItem = line.match(/^    -\s*(.+)$/u);
    if (listItem && inList === "search-paths") {
      collectedSearchPaths ??= [];
      collectedSearchPaths.push(unquote(listItem[1]));
      continue;
    }

    const match = line.match(/^  ([A-Za-z0-9_-]+):\s*(.*)$/u);
    if (!match) continue;
    const key = match[1];
    const rawValue = match[2] ?? "";
    inList = rawValue.trim() === "" ? key : null;

    if (key === "enabled") {
      const value = parseScalar(rawValue);
      if (typeof value === "boolean") config.enabled = value;
    } else if (key === "max-depth") {
      const value = parseScalar(rawValue);
      if (Number.isInteger(value) && value >= 0) config.maxDepth = value;
    } else if (key === "staleness-days") {
      const value = parseScalar(rawValue);
      if (Number.isInteger(value) && value >= 0) config.stalenessDays = value;
    } else if (key === "plan-file") {
      const value = parseScalar(rawValue);
      if (typeof value === "string" && value.trim() !== "") {
        config.planFile = value.trim();
      }
    } else if (key === "search-paths") {
      const inline = parseInlineList(rawValue);
      if (inline) {
        collectedSearchPaths = inline;
      } else if (rawValue.trim() === "") {
        collectedSearchPaths = [];
      }
    }
  }

  if (collectedSearchPaths && collectedSearchPaths.length > 0) {
    config.searchPaths = collectedSearchPaths;
  }
  return config;
}

function toRepoRelative(root, candidate) {
  const absolute = resolve(root, candidate);
  const fromRoot = relative(root, absolute);
  if (
    fromRoot === "" ||
    fromRoot.startsWith("..") ||
    fromRoot.includes(`${sep}..${sep}`)
  ) {
    return null;
  }
  return fromRoot.split(sep).join("/");
}

function readFrontmatter(content) {
  if (!content.startsWith("---\n") && !content.startsWith("---\r\n")) {
    return { hasFrontmatter: false, fields: {} };
  }
  const normalized = content.replace(/\r\n/gu, "\n");
  const lines = normalized.split("\n");
  const fields = {};
  let end = -1;
  for (let index = 1; index < lines.length; index += 1) {
    if (lines[index] === "---") {
      end = index;
      break;
    }
  }
  if (end === -1) return { hasFrontmatter: false, fields: {} };
  for (const line of lines.slice(1, end)) {
    const match = line.match(/^([A-Za-z0-9_-]+):\s*(.+)$/u);
    if (match) fields[match[1]] = unquote(match[2]);
  }
  return { hasFrontmatter: true, fields };
}

function countOpenBoxes(content) {
  return content
    .split(/\r?\n/u)
    .filter((line) => /^\s*-\s+\[ \]/u.test(line)).length;
}

function isSkippedPlanFile(relPath) {
  const file = basename(relPath);
  return (
    SKIPPED_PLAN_BASENAMES.has(file) ||
    /^ISSUE(?:[-.].*)?\.md$/u.test(file) ||
    file.startsWith(".")
  );
}

function readPlanCandidate(root, relPath) {
  if (isSkippedPlanFile(relPath)) return null;
  const absPath = join(root, relPath);
  if (!existsSync(absPath)) return null;
  const stats = statSync(absPath);
  if (!stats.isFile()) return null;
  const content = readFileSync(absPath, "utf8");
  const frontmatter = readFrontmatter(content);
  const status =
    typeof frontmatter.fields.status === "string"
      ? frontmatter.fields.status.toLowerCase()
      : null;
  const openBoxes = countOpenBoxes(content);
  if (openBoxes === 0) return null;
  if (status && FINAL_STATUSES.has(status)) return null;
  return {
    relPath,
    content,
    hash: sha256(content),
    openBoxes,
    status,
    hasFrontmatter: frontmatter.hasFrontmatter,
    mtimeMs: stats.mtimeMs,
  };
}

function walkMarkdownFiles(root, baseRelPath, maxDepth) {
  const startRel = toRepoRelative(root, baseRelPath);
  if (!startRel) return [];
  const startAbs = join(root, startRel);
  if (!existsSync(startAbs)) return [];
  const result = [];

  function visit(relPath, depth) {
    if (depth > maxDepth) return;
    const absPath = join(root, relPath);
    const stats = statSync(absPath);
    if (stats.isFile()) {
      if (relPath.endsWith(".md")) result.push(relPath.split(sep).join("/"));
      return;
    }
    if (!stats.isDirectory()) return;
    for (const entry of readdirSync(absPath, { withFileTypes: true })) {
      if (entry.name === ".git" || entry.name === "node_modules") continue;
      visit(join(relPath, entry.name), depth + 1);
    }
  }

  visit(startRel, 0);
  return result;
}

function newestCandidate(candidates) {
  return [...candidates].sort((left, right) => {
    const byTime = right.mtimeMs - left.mtimeMs;
    if (byTime !== 0) return byTime;
    return left.relPath.localeCompare(right.relPath);
  })[0] ?? null;
}

function readActiveMarker(root) {
  const markerPath = join(root, ACTIVE_MARKER_RELATIVE_PATH);
  if (!existsSync(markerPath)) return null;
  const marker = readFileSync(markerPath, "utf8").trim();
  if (marker === "" || marker.includes("..")) return null;
  return `.goat-flow/plans/${marker.replace(/^\/+|\/+$/gu, "")}/`;
}

function resolveActivePlan(root, config) {
  if (config.planFile) {
    const relPath = toRepoRelative(root, config.planFile);
    if (!relPath) exitWith(1, `configured plan-file escapes repository: ${config.planFile}`);
    if (!existsSync(join(root, relPath))) {
      exitWith(1, `configured plan-file missing: ${relPath}`);
    }
    return readPlanCandidate(root, relPath);
  }

  const relPaths = new Set();
  for (const searchPath of config.searchPaths) {
    for (const relPath of walkMarkdownFiles(root, searchPath, config.maxDepth)) {
      relPaths.add(relPath);
    }
  }
  const candidates = [...relPaths]
    .map((relPath) => readPlanCandidate(root, relPath))
    .filter(Boolean);
  const activeStatusCandidates = candidates.filter(
    (candidate) => candidate.status === "active",
  );
  if (activeStatusCandidates.length > 0) return newestCandidate(activeStatusCandidates);

  const activeMarkerDir = readActiveMarker(root);
  if (activeMarkerDir) {
    const markerCandidates = candidates.filter((candidate) =>
      candidate.relPath.startsWith(activeMarkerDir),
    );
    if (markerCandidates.length > 0) return newestCandidate(markerCandidates);
  }

  const cutoff = Date.now() - config.stalenessDays * 24 * 60 * 60 * 1000;
  const freshFrontmatterless = candidates.filter(
    (candidate) =>
      candidate.hasFrontmatter === false && candidate.mtimeMs >= cutoff,
  );
  if (freshFrontmatterless.length === 1) return freshFrontmatterless[0];
  if (freshFrontmatterless.length > 1) {
    stderr(
      `multiple recent frontmatter-less plans have open checkboxes; add status: active or plan-guard.plan-file (skipped).`,
    );
  }
  return null;
}

function readState(root) {
  const path = join(root, STATE_RELATIVE_PATH);
  if (!existsSync(path)) return { version: 1, sessions: {} };
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    if (!parsed || typeof parsed !== "object" || !parsed.sessions) {
      throw new Error("invalid state");
    }
    return parsed;
  } catch {
    stderr("state file was corrupt; resetting plan guard baseline.");
    return { version: 1, sessions: {} };
  }
}

function statePathIsIgnored(root) {
  const result = spawnSync(
    "git",
    ["check-ignore", "-q", STATE_RELATIVE_PATH],
    { cwd: root },
  );
  return result.status === 0;
}

function pruneSessions(state) {
  const now = Date.now();
  const cutoff = now - 14 * 24 * 60 * 60 * 1000;
  const sessions = {};
  for (const [key, value] of Object.entries(state.sessions ?? {})) {
    if (!value || typeof value !== "object") continue;
    const updatedAt = Date.parse(value.updatedAt ?? "");
    if (Number.isFinite(updatedAt) && updatedAt >= cutoff) {
      sessions[key] = value;
    }
  }
  return { version: 1, sessions };
}

function writeState(root, state) {
  if (!statePathIsIgnored(root)) {
    stderr(`${STATE_RELATIVE_PATH} is not gitignored; skipped state write.`);
    return false;
  }
  const path = join(root, STATE_RELATIVE_PATH);
  mkdirSync(dirname(path), { recursive: true });
  const temp = `${path}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(temp, `${JSON.stringify(pruneSessions(state), null, 2)}\n`);
  renameSync(temp, path);
  return true;
}

function readUntrackedMetadata(root) {
  const raw = gitBuffer(["ls-files", "--others", "--exclude-standard", "-z"], root);
  const paths = raw
    .toString("utf8")
    .split("\0")
    .filter(Boolean)
    .sort();
  return paths
    .map((path) => {
      try {
        const stats = statSync(join(root, path));
        return [
          path,
          stats.isFile() ? "file" : stats.isDirectory() ? "dir" : "other",
          stats.size,
          Math.trunc(stats.mtimeMs),
          stats.mode,
        ].join("\t");
      } catch {
        return `${path}\tmissing`;
      }
    })
    .join("\0");
}

function trackedDiffBuffer(root) {
  try {
    return gitBuffer(["diff", "--no-ext-diff", "--binary", "HEAD"], root);
  } catch {
    return Buffer.concat([
      gitBuffer(["diff", "--no-ext-diff", "--binary"], root),
      gitBuffer(["diff", "--cached", "--no-ext-diff", "--binary"], root),
    ]);
  }
}

function changesetDigest(root) {
  const status = gitBuffer(["status", "--porcelain=v1", "-z"], root);
  const diff = trackedDiffBuffer(root);
  const untracked = Buffer.from(readUntrackedMetadata(root), "utf8");
  return sha256(Buffer.concat([
    Buffer.from("status\0", "utf8"),
    status,
    Buffer.from("\0diff\0", "utf8"),
    diff,
    Buffer.from("\0untracked\0", "utf8"),
    untracked,
  ]));
}

const payload = parsePayload();
if (isTruthy(payload.stop_hook_active) || isTruthy(payload.stopHookActive)) {
  process.exit(0);
}

const sessionId = firstString(
  payload.session_id,
  payload.sessionId,
  payload.transcript_path,
  payload.transcriptPath,
);
if (!sessionId) {
  exitWith(1, "Stop hook payload has no session_id or transcript_path; skipped plan guard check.");
}

const root = currentGitRoot();
if (!root) exitWith(1, "git repository root unavailable; skipped plan guard check.");
process.chdir(root);

const config = readPlanGuardConfig(root);
if (config.enabled === false) process.exit(0);

const activePlan = resolveActivePlan(root, config);
if (!activePlan) process.exit(0);

const currentDigest = changesetDigest(root);
const state = readState(root);
const prior = state.sessions[sessionId];
const nextSessionState = {
  planPath: activePlan.relPath,
  planHash: activePlan.hash,
  changesetHash: currentDigest,
  updatedAt: new Date().toISOString(),
};

if (!prior || prior.planPath !== activePlan.relPath) {
  state.sessions[sessionId] = nextSessionState;
  writeState(root, state);
  process.exit(0);
}

if (prior.planHash !== activePlan.hash) {
  state.sessions[sessionId] = nextSessionState;
  writeState(root, state);
  process.exit(0);
}

if (prior.changesetHash !== currentDigest) {
  stderr(
    `${activePlan.relPath} still has ${activePlan.openBoxes} open checkbox(es), but repository changes moved since the last baseline.`,
  );
  stderr(
    "Tick completed tasks, update the plan with an out-of-plan note, or explain why no checkbox moved before stopping.",
  );
  process.exit(2);
}

state.sessions[sessionId] = nextSessionState;
writeState(root, state);
process.exit(0);
NODE
