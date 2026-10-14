#!/usr/bin/env node
/**
 * Decide whether a CI run needs the platform jobs: hook ports, native Windows contracts, Linux references and the Windows warning ratchet.
 *
 * In CI it reads the GitHub event from stdin, lists the files changed by the commits this push added, and prints one line,
 * `platform=true` or `platform=false`, for the workflow step to append to `$GITHUB_OUTPUT`; the reason goes to stderr. A schedule, a
 * manual run, a new pull request or any commit range Git cannot read selects the platform jobs, so an unreadable range never skips them.
 *
 * Usage: node scripts/ci-changed-paths.mjs < "$GITHUB_EVENT_PATH" >> "$GITHUB_OUTPUT"
 *        node scripts/ci-changed-paths.mjs --files <path>...   (decides for an explicit file list instead of the event)
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

// Files whose change most directly alters what the platform jobs prove: hook sources, the scripts and tests these jobs run, and the files
// that install them. Changes to other modules those tests import wait for the weekly run.
const PLATFORM_PATH_PATTERNS = [
  /^workflow\/hooks\//u,
  /^\.goat-flow\/hooks\//u,
  /^src\/cli\/hook/u,
  /^src\/cli\/server\/(?:agent-hook-|hook-|hooks-|terminal|dashboard-terminal)/u,
  /^src\/cli\/path-write-claim/u,
  /^src\/cli\/local-state/u,
  /^scripts\/(?:check-hook-parity|hook-parity-reference-command|generate-hook-|generate-managed-hook-|check-gruff-warning-ratchet|gruff-warning-ratchet-checks|gruff-ts\.sh|preflight-checks\.sh|ci-changed-paths)/u,
  /^\.gruff-ts\.yaml$/u,
  /^test\/fixtures\/hooks-bash\//u,
  /^test\/integration\/(?:restricted-env-controls|hook-|deny-|post-turn-|gruff-|packaged-hook-install|preflight-progress|local-state-migration)/u,
  /^test\/unit\/(?:hook-|terminal-spawn|path-write-claim|audit-command\/agent-deny-hooks-drift)/u,
  /^package(?:-lock)?\.json$/u,
  /^\.github\/workflows\/ci\.yml$/u,
];

const ABSENT_COMMIT = /^0+$/u;

/**
 * Report whether any changed file is a platform path.
 *
 * @param files - repository-relative paths with forward slashes
 * @returns the first matching path, or null when none of the files can affect a platform job
 */
function firstPlatformPath(files) {
  return (
    files.find((file) =>
      PLATFORM_PATH_PATTERNS.some((pattern) => pattern.test(file)),
    ) ?? null
  );
}

/**
 * Find the commit range this run added, or the reason the whole platform set must run.
 *
 * @param eventName - `GITHUB_EVENT_NAME`, such as `push`, `pull_request` or `schedule`
 * @param event - the parsed GitHub event payload
 * @returns `{ base, head }` for a readable push or pull-request update, otherwise `{ reason }` naming why every platform job runs
 */
function changedRange(eventName, event) {
  // A scheduled or manual run exists to exercise the platform jobs regardless of what changed.
  if (eventName === "schedule" || eventName === "workflow_dispatch")
    return { reason: `${eventName} run` };
  // Only a pull-request update carries the previous head; a new or reopened pull request has no earlier run to compare with.
  if (eventName === "pull_request") {
    if (event.action !== "synchronize" || !event.before || !event.after)
      return {
        reason: `pull_request ${event.action ?? "event"} without a previous head`,
      };
    return { base: event.before, head: event.after };
  }
  // A push that creates a branch reports an all-zero previous commit.
  if (eventName === "push") {
    if (!event.before || !event.after || ABSENT_COMMIT.test(event.before))
      return { reason: "push without a previous commit" };
    return { base: event.before, head: event.after };
  }
  return { reason: `unhandled event ${eventName}` };
}

/**
 * List the files changed between two commits; spawns `git diff --name-only`.
 *
 * @param base - commit before this run's changes
 * @param head - commit after them
 * @returns changed paths, or null when Git cannot read the range, for example after a force-push removed the base commit
 */
function listChangedFiles(base, head) {
  const result = spawnSync("git", ["diff", "--name-only", base, head], {
    encoding: "utf8",
  });
  // An unreadable range must not hide a platform change, so the caller treats null as "run everything".
  if (result.status !== 0) return null;
  return result.stdout.split("\n").filter(Boolean);
}

/**
 * Decide whether this run needs the platform jobs.
 *
 * @returns `{ platform, reason }`; reads the event from stdin unless `--files` supplies an explicit list
 */
function decide() {
  const fileArgumentIndex = process.argv.indexOf("--files");
  // An explicit list lets a maintainer check the path rules without a GitHub event.
  if (fileArgumentIndex !== -1) {
    const match = firstPlatformPath(process.argv.slice(fileArgumentIndex + 1));
    return {
      platform: match !== null,
      reason: match
        ? `changed platform path ${match}`
        : "no platform path in the given files",
    };
  }
  const event = JSON.parse(readFileSync(0, "utf8"));
  const range = changedRange(process.env.GITHUB_EVENT_NAME ?? "", event);
  if (range.reason) return { platform: true, reason: range.reason };
  const files = listChangedFiles(range.base, range.head);
  if (files === null)
    return {
      platform: true,
      reason: `cannot read ${range.base}..${range.head}`,
    };
  const match = firstPlatformPath(files);
  return {
    platform: match !== null,
    reason: match
      ? `changed platform path ${match}`
      : `no platform path in ${files.length} changed file(s)`,
  };
}

const { platform, reason } = decide();
// Only the decision goes to stdout, so the workflow can append it to $GITHUB_OUTPUT unchanged.
console.log(`platform=${platform}`);
console.error(`ci-changed-paths: ${reason}`);
