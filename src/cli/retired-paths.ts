/**
 * Files an earlier goat-flow release installed and the current package no longer ships, measured from real projects' install records.
 * A name here never authorizes deletion by itself: install deletes a file only when its bytes match the project's own record or
 * `--force-path` names it, and forgets the record once the file is gone.
 */
import { load } from "js-yaml";
import type { ReadonlyFS } from "./types.js";

const HOOKS = ".goat-flow/hooks";
const PLAYBOOKS = ".goat-flow/skill-docs/playbooks";

/**
 * Each Bash hook runtime file the Node hooks replaced, with what a caller should run instead. A `node ... .mjs` entrypoint takes the
 * same options the Bash entrypoint took; null means the file was an internal part of the Bash runtime with no direct replacement.
 */
const RETIRED_RUNTIME: readonly (readonly [string, string | null])[] = [
  ["deny-dangerous.sh", `node ${HOOKS}/deny-dangerous.mjs`],
  ["deny-git-mutations.sh", `node ${HOOKS}/deny-git-mutations.mjs`],
  ["post-turn-safety.sh", `node ${HOOKS}/post-turn-safety.mjs`],
  ["gruff-code-quality.sh", `node ${HOOKS}/gruff-code-quality.mjs`],
  ["run-with-bash.mjs", `${HOOKS}/run-hook.mjs`],
  ["deny-dangerous/guard-runtime.sh", null],
  ["deny-dangerous/patterns-shell.sh", null],
  ["deny-dangerous/patterns-paths.sh", null],
  ["deny-dangerous/patterns-writes.sh", null],
  [
    "deny-dangerous/deny-dangerous-self-test.sh",
    `node ${HOOKS}/deny-dangerous.mjs --self-test=full and node ${HOOKS}/deny-git-mutations.mjs --self-test=full`,
  ],
];

/** Bash hook runtime files the Node hooks replaced; install removes them once no provider config still runs them. */
export const RETIRED_RUNTIME_PATHS: readonly string[] = RETIRED_RUNTIME.map(
  ([name]) => `${HOOKS}/${name}`,
);

/** Each old playbook path mapped to the playbook that replaced it. */
export const RENAMED_PLAYBOOKS: ReadonlyMap<string, string> = new Map([
  [
    `${PLAYBOOKS}/writing-for-agents.md`,
    `${PLAYBOOKS}/writing-agent-facing-instructions.md`,
  ],
  [
    `${PLAYBOOKS}/writing-style.md`,
    `${PLAYBOOKS}/writing-human-facing-prose.md`,
  ],
]);

/** Every retired path whose file install may delete and whose record it forgets. */
export const RETIRED_PATHS: readonly string[] = [
  ...RETIRED_RUNTIME_PATHS,
  ...RENAMED_PLAYBOOKS.keys(),
];

/**
 * Decide whether an old playbook's YAML frontmatter marks it user-owned, which opts it out of cleanup. Ownership text in the body,
 * or frontmatter that does not parse, does not count.
 * Error behavior: never throws; a YAML parse error returns false.
 *
 * @param content - complete playbook text
 * @returns true only for a top-level `goat-flow-ownership: user-owned` frontmatter value
 */
export function isUserOwnedPlaybook(content: string): boolean {
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u.exec(content);
  let metadata: unknown;
  try {
    metadata = load(frontmatter?.[1] ?? "");
  } catch {
    // Unparsable frontmatter claims nothing, so the copy is treated as goat-flow's.
    return false;
  }
  return Boolean(
    metadata &&
    typeof metadata === "object" &&
    "goat-flow-ownership" in metadata &&
    metadata["goat-flow-ownership"] === "user-owned",
  );
}

/**
 * Explain what a kept old file means and how to finish removing it.
 *
 * @param path - retired path install kept because it is edited, unrecorded or linked
 * @param isRegularFile - false for a symlink or unreadable path, which `--force-path` cannot delete
 * @returns one sentence for install output, the closing summary and the preview
 */
export function keptRetiredFileAdvice(
  path: string,
  isRegularFile: boolean,
): string {
  const replacement = RENAMED_PLAYBOOKS.get(path);
  // A renamed playbook points at its replacement; a retired hook file has none, because the Node hooks replaced the whole runtime.
  const consequence = replacement
    ? `it will not be updated. Carry over needed edits to ${replacement}`
    : "it no longer runs, is not registered and will not be updated. Carry over needed edits";
  // Install never deletes a linked or unreadable path, so only a regular file can be finished with --force-path.
  return isRegularFile
    ? `${consequence}, then delete it or rerun install with --force-path ${path}`
    : `${consequence}, then delete it yourself; install never deletes a linked or unreadable path`;
}

/** One line in a project file that calls a retired path. */
export interface RetiredPathReference {
  /** 1-based line number */
  line: number;
  /** the retired path, option or glob as written, without a leading `./` */
  token: string;
  /** the command or path to use instead; null when nothing replaces it, and `note` says what to do */
  replacement: string | null;
  /** a full sentence for a reference with no replacement; null when `replacement` is set */
  note: string | null;
}

/** What to use instead of one retired reference: a command or path, or a sentence saying why none exists. */
type RetiredReplacement = Pick<RetiredPathReference, "replacement" | "note">;

const RETIRED_COMMAND =
  /(?<![\w./-])(?:\.\/)?(\.goat-flow\/(?:hooks|skill-docs\/playbooks)\/[\w.*/-]*[\w*])["']?(?:[ \t]+(--(?:self-test(?:=(?:smoke|full))?|check))(?![\w-]))?/gu;
const GLOB_NOTE =
  "This glob targets retired Bash hooks. To check the Node hooks, use `.goat-flow/hooks/**/*.mjs`.";
const INTERNAL_NOTE =
  "This file was an internal part of the retired Bash runtime and has no direct replacement; remove the call.";

/**
 * Say what replaces one retired path, keeping a self-test or check option for a hook entrypoint.
 *
 * @param path - retired path from the shared table
 * @param option - `--self-test`, `--self-test=smoke|full` or `--check` written after the path, when present
 * @returns the replacement command or path, or a note when an internal runtime file has none
 */
function replacementFor(
  path: string,
  option: string | undefined,
): RetiredReplacement {
  const playbook = RENAMED_PLAYBOOKS.get(path);
  // A renamed playbook is replaced by the playbook that took its content.
  if (playbook) return { replacement: playbook, note: null };
  const runtime =
    RETIRED_RUNTIME.find(([name]) => `${HOOKS}/${name}` === path)?.[1] ?? null;
  // Internal runtime files had no callers of their own in a supported setup, so the advice is to remove the call.
  if (runtime === null) return { replacement: null, note: INTERNAL_NOTE };
  // Node entrypoints accept the same options, so a written option carries over.
  const keepsOption =
    option !== undefined &&
    runtime.startsWith("node ") &&
    !runtime.includes(" and ");
  return {
    replacement: keepsOption ? `${runtime} ${option}` : runtime,
    note: null,
  };
}

/**
 * Find each call of a retired path on every line of one project file.
 * Report a hook glob when it covers the retired inventory and has no matches outside it.
 *
 * @param text - complete file text
 * @param includeBarePlaybookNames - true for instruction files, where agents are told to read a playbook by name alone
 * @param fs - project filesystem used to distinguish retired and local hook globs
 * @returns references in line order; empty when the file calls no retired path
 */
export function findRetiredPathReferences(
  text: string,
  includeBarePlaybookNames: boolean,
  fs: Pick<ReadonlyFS, "glob">,
): RetiredPathReference[] {
  const references: RetiredPathReference[] = [];
  for (const [index, raw] of text.split(/\r?\n/u).entries()) {
    const found = retiredReferencesOnLine(raw, includeBarePlaybookNames, fs);
    // Each reference keeps its line so the report points the user at the exact place to change.
    for (const reference of found)
      references.push({ line: index + 1, ...reference });
  }
  return references;
}

/** List the retired paths, globs and bare playbook names one line calls, each with its replacement. */
function retiredReferencesOnLine(
  line: string,
  includeBarePlaybookNames: boolean,
  fs: Pick<ReadonlyFS, "glob">,
): (RetiredReplacement & { token: string })[] {
  const found: (RetiredReplacement & { token: string })[] = [];
  for (const [, path, option] of line.matchAll(RETIRED_COMMAND)) {
    // The pattern always captures a path; this guard only narrows the type.
    if (path === undefined) continue;
    if (isRetiredHookGlob(path, fs))
      found.push({ token: path, replacement: null, note: GLOB_NOTE });
    else if (RETIRED_PATHS.includes(path))
      found.push({ token: path, ...replacementFor(path, option) });
  }
  // Mask full paths so bare names elsewhere on the same line remain visible.
  if (includeBarePlaybookNames)
    found.push(...barePlaybookReferences(line.replace(RETIRED_COMMAND, " ")));
  return found;
}

/** Use the project's glob results to protect callers of local shell files. */
function isRetiredHookGlob(
  path: string,
  fs: Pick<ReadonlyFS, "glob">,
): boolean {
  if (
    !path.startsWith(`${HOOKS}/`) ||
    !path.endsWith(".sh") ||
    !path.includes("*")
  )
    return false;
  const glob = path
    .split(/(\*\*\/|\*)/u)
    .map((part) => {
      if (part === "**/") return "(?:[^/]+/)*";
      if (part === "*") return "[^/]*";
      return part.replaceAll(".", "\\.");
    })
    .join("");
  const pattern = new RegExp(`^${glob}$`, "u");
  return (
    RETIRED_RUNTIME_PATHS.some((retired) => pattern.test(retired)) &&
    fs.glob(path).every((match) => RETIRED_RUNTIME_PATHS.includes(match))
  );
}

/** List each renamed playbook a line names by file name alone, with the playbook that replaced it. */
function barePlaybookReferences(
  line: string,
): (RetiredReplacement & { token: string })[] {
  return [...RENAMED_PLAYBOOKS]
    .map(([oldPath, newPath]) => ({
      token: oldPath.slice(PLAYBOOKS.length + 1),
      replacement: newPath,
      note: null,
    }))
    .filter(({ token }) =>
      new RegExp(
        `(?<![\\w./-])${token.replaceAll(".", "\\.")}(?![\\w/-]|\\.[\\w])`,
        "u",
      ).test(line),
    );
}

/** A shell script: a `.sh`, `.bash`, `.zsh` or `.ps1` file, or a file named without an extension, as executables often are. */
const SHELL_SCRIPT = /(?:^|\/)[^/.]+$|\.(?:sh|bash|zsh|ps1)$/u;
/** A GitHub Actions workflow definition. */
const WORKFLOW_FILE = /\.ya?ml$/u;

/**
 * List the project files that can call a retired path: `package.json`, shell scripts under `scripts/` and workflow files under
 * `.github/workflows/`. Learning-loop entries and documentation prose are not callers. Source files such as `.mjs` are skipped too,
 * because a path inside a string literal there is as often test data as a command.
 *
 * @param fs - read-only project filesystem
 * @returns sorted project-relative paths that exist; empty when the project has none of them
 */
export function retiredPathCallerFiles(fs: ReadonlyFS): string[] {
  const files = fs.exists("package.json") ? ["package.json"] : [];
  // Walk each caller folder a few levels deep; deeper trees are generated or vendored, not project scripts.
  files.push(
    ...listFilesUnder(fs, "scripts", 4).filter((path) =>
      SHELL_SCRIPT.test(path),
    ),
    ...listFilesUnder(fs, ".github/workflows", 2).filter((path) =>
      WORKFLOW_FILE.test(path),
    ),
  );
  return files.sort();
}

/** Recursively list the files below one folder, skipping dependency folders and stopping at the given depth. */
function listFilesUnder(
  fs: ReadonlyFS,
  folder: string,
  depth: number,
): string[] {
  // A missing or unreadable folder, or one past the depth limit, contributes nothing.
  if (depth === 0 || !fs.isReadableDirectory(folder)) return [];
  return fs.listDir(folder).flatMap((name) => {
    const path = `${folder}/${name}`;
    // Installed dependencies are not the project's own callers.
    if (name === "node_modules") return [];
    return fs.isReadableDirectory(path)
      ? listFilesUnder(fs, path, depth - 1)
      : [path];
  });
}
