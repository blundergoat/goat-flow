/** Attribute only changed source lines, keeping a failed Git query distinct from no repository. */
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { git, object, type EditRequest } from "./scope.mjs";

export interface EditRanges {
  text: string;
  status: "ready" | "whole-file" | "none" | "missing" | "failed";
}

export function wholeFile(path: string): string {
  try {
    const text = readFileSync(path, "utf8");
    const count =
      text === "" ? 0 : text.split("\n").length - (text.endsWith("\n") ? 1 : 0);
    return count > 0 ? `1-${count}` : "";
  } catch {
    return "";
  }
}

function hunkRanges(diff: string): string {
  return [
    ...diff.matchAll(/^@@ -[0-9]+(?:,[0-9]+)? \+([0-9]+)(?:,([0-9]+))? @@/gmu),
  ]
    .flatMap((match) => {
      const start = Number(match[1]);
      const count = match[2] === undefined ? 1 : Number(match[2]);
      return count > 0 ? [`${start}-${start + count - 1}`] : [];
    })
    .join(",");
}

function payloadRanges(request: EditRequest): string {
  const call = object(request.payload.toolCall);
  return [
    request.payload.tool_input,
    call.args,
    request.payload.toolArgs,
    request.payload.tool_args,
  ]
    .flatMap((value) => {
      let row = object(value);
      if (typeof value === "string") {
        try {
          row = object(JSON.parse(value));
        } catch {
          return [];
        }
      }
      const ranges = row.changed_ranges ?? row.changedRanges;
      if (!Array.isArray(ranges)) return [];
      return ranges.flatMap((value) => {
        const range = object(value);
        const start = Number(range.startLine ?? range.start ?? range.line);
        const end = Number(range.endLine ?? range.end ?? range.line ?? start);
        return start > 0 && end >= start ? [`${start}-${end}`] : [];
      });
    })
    .join(",");
}

function patchRanges(
  request: EditRequest,
  path: string,
  absolute: string,
): EditRanges | null {
  for (const patch of request.patches) {
    const sections = [
      ...patch.matchAll(/^\*\*\* (Add|Update|Delete) File: (.+)$/gmu),
    ];
    for (const [index, section] of sections.entries()) {
      if (section[2] !== path) continue;
      if (section[1] === "Delete") return { text: "", status: "none" };
      const text =
        section[1] === "Add"
          ? wholeFile(absolute)
          : hunkRanges(patch.slice(section.index, sections[index + 1]?.index));
      if (text) return { text, status: "ready" };
      if (section[1] === "Add") return { text: "", status: "none" };
    }
  }
  return null;
}

function noRepository(directory: string, absolute: string): EditRanges {
  for (
    let current = directory;
    current.length > 0;
    current = dirname(current)
  ) {
    if (
      existsSync(join(current, ".git/HEAD")) ||
      (() => {
        try {
          return statSync(join(current, ".git")).isFile();
        } catch {
          return false;
        }
      })()
    )
      return { text: "", status: "failed" };
    if (dirname(current) === current) break;
  }
  const text = wholeFile(absolute);
  return { text, status: text ? "whole-file" : "none" };
}

function headDiff(root: string, path: string) {
  const options = ["diff", "--no-ext-diff", "--no-textconv"];
  const names = git(root, [
    ...options,
    "--name-status",
    "--find-renames",
    "HEAD",
    "--",
  ]);
  if (names.status !== 0) return null;
  const renamed = names.stdout
    .split("\n")
    .map((line) => line.split("\t"))
    .find((row) => /^R[0-9]+$/u.test(row[0] ?? "") && row[2] === path);
  const source = renamed?.[1];
  return git(root, [
    ...options,
    "HEAD",
    "--unified=0",
    "--",
    ...(source ? [source] : []),
    path,
  ]);
}
function trackedDiff(root: string, path: string, allowCached: boolean) {
  const head = git(root, ["rev-parse", "--verify", "--quiet", "HEAD"]);
  if (head.status === 0) return headDiff(root, path);
  if (head.status !== 1) return null;
  const options = ["diff", "--no-ext-diff", "--no-textconv"];
  const diff = git(root, [...options, "--unified=0", "--", path]);
  if (diff.status === 0 && diff.stdout === "" && allowCached)
    return git(root, [...options, "--cached", "--unified=0", "--", path]);
  return diff;
}
function repositoryRanges(
  root: string,
  directory: string,
  absolute: string,
  allowCached: boolean,
): EditRanges {
  const prefix = git(directory, ["rev-parse", "--show-prefix"]);
  if (prefix.status !== 0) return { text: "", status: "failed" };
  const path =
    prefix.stdout.trimEnd() +
    relative(directory, absolute).replaceAll("\\", "/");
  const tracked = git(root, ["ls-files", "--", path]);
  if (tracked.status !== 0) return { text: "", status: "failed" };
  if (!tracked.stdout.trim()) {
    const text = wholeFile(absolute);
    return { text, status: text ? "ready" : "none" };
  }
  const diff = trackedDiff(root, path, allowCached);
  if (!diff || diff.status !== 0) return { text: "", status: "failed" };
  const text = hunkRanges(diff.stdout);
  return { text, status: text ? "ready" : diff.stdout ? "none" : "missing" };
}
function gitRanges(absolute: string, allowCached: boolean): EditRanges {
  let directory = dirname(absolute);
  while (!existsSync(directory) && dirname(directory) !== directory)
    directory = dirname(directory);
  const repository = git(directory, ["rev-parse", "--show-toplevel"]);
  if (repository.status !== 0 || !repository.stdout.trim())
    return noRepository(directory, absolute);
  return repositoryRanges(
    repository.stdout.trim(),
    directory,
    absolute,
    allowCached,
  );
}

/** Flat provider ranges apply to one file only; multi-file edits derive each file's own Git range. */
export function changedRanges(
  request: EditRequest,
  root: string,
  path: string,
  count: number,
  allowCached: boolean,
): EditRanges {
  const absolute = resolve(root, path);
  const patch = patchRanges(request, path, absolute);
  if (patch) return patch;
  const text = count <= 1 ? payloadRanges(request) : "";
  return text ? { text, status: "ready" } : gitRanges(absolute, allowCached);
}
