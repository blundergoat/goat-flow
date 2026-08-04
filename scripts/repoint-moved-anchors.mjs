/**
 * Repoints learning-loop evidence anchors whose symbol moved to another file.
 *
 * Lessons and footguns cite code as `path` + `(search: "symbol")`. Splitting a large file
 * moves symbols to new modules, which silently invalidates those citations - the compiler
 * cannot see them, and they surface much later as a failing `feedback-loop-active` harness
 * check. This finds each stale citation, locates the file that now contains the cited text,
 * and rewrites the path when exactly one candidate matches.
 *
 * Run after any extraction:  node scripts/repoint-moved-anchors.mjs
 * Ambiguous or unfound symbols are reported for a human to resolve rather than guessed at.
 *
 * Two separate gates check these citations and both are read here, because covering only one
 * leaves the other to fail later in CI: `stats --check` covers lessons, footguns, and
 * patterns, while `audit --check-content` additionally covers decision records.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

/**
 * Ask the CLI which anchors are currently stale.
 *
 * @returns stale-ref findings as {file, citedPath, needle}; empty means nothing to repoint
 */
function readStaleAnchors() {
  let raw;
  try {
    raw = execFileSync(
      "node",
      ["--import", "tsx", "src/cli/cli.ts", "stats", ".", "--check"],
      { encoding: "utf-8", maxBuffer: 32 * 1024 * 1024 },
    );
  } catch (error) {
    // `stats --check` exits non-zero whenever it has findings, which is the case we care
    // about; the report itself is still on stdout.
    raw = error.stdout;
    if (typeof raw !== "string" || raw.length === 0) throw error;
  }
  const report = JSON.parse(raw);
  const stale = [];
  for (const finding of report.findings ?? []) {
    if (finding.rule !== "stale-ref") continue;
    // Message shape: "<file>: stale file ref <path> (search: `<needle>`)"
    const match = /stale file ref (\S+) \(search: `(.+)`\)$/u.exec(
      finding.message,
    );
    if (!match) continue;
    stale.push({ file: finding.file, citedPath: match[1], needle: match[2] });
  }
  return stale;
}

/**
 * Ask the content audit which semantic anchors are stale.
 * Decision records are checked here rather than by `stats --check`, so a split that moves a
 * symbol cited by an ADR is invisible to the other gate.
 *
 * @returns stale semantic-anchor findings as {file, citedPath, needle}
 */
function readStaleSemanticAnchors() {
  let raw;
  try {
    raw = execFileSync(
      "node",
      [
        "--import",
        "tsx",
        "src/cli/cli.ts",
        "audit",
        ".",
        "--check-content",
        "--format",
        "json",
      ],
      { encoding: "utf-8", maxBuffer: 64 * 1024 * 1024 },
    );
  } catch (error) {
    raw = error.stdout;
    if (typeof raw !== "string" || raw.length === 0) throw error;
  }

  const stale = [];
  for (const finding of JSON.parse(raw).content?.findings ?? []) {
    if (finding.rule !== "stale-semantic-anchor") continue;
    // Message shape: 'Semantic anchor "<needle>" no longer appears in <path>.'
    const match = /Semantic anchor "(.+)" no longer appears in (\S+?)\.$/u.exec(
      finding.message,
    );
    if (!match) continue;
    stale.push({ file: finding.path, citedPath: match[2], needle: match[1] });
  }
  return stale;
}

/**
 * Find the tracked files that now contain a cited literal.
 *
 * @param needle - the exact text the anchor cited
 * @returns matching tracked paths; empty means the symbol is gone rather than moved
 */
function filesContaining(needle) {
  try {
    // `--untracked` matters during a split: the module a symbol just moved into is usually
    // still unstaged, and a tracked-only search would report the symbol as simply gone.
    const out = execFileSync(
      "git",
      ["grep", "-l", "--untracked", "--fixed-strings", needle],
      { encoding: "utf-8", maxBuffer: 32 * 1024 * 1024 },
    );
    return out.split("\n").filter((line) => line.length > 0);
  } catch {
    // git grep exits non-zero when nothing matches, which is a real answer here.
    return [];
  }
}

const stale = [...readStaleAnchors(), ...readStaleSemanticAnchors()];
if (stale.length === 0) {
  console.log("no stale anchors");
  process.exit(0);
}

let repointed = 0;
for (const { file, citedPath, needle } of stale) {
  // Prefer a source file over a test that merely mentions the same string.
  const candidates = filesContaining(needle).filter(
    (path) => path !== citedPath && path.startsWith("src/"),
  );

  if (candidates.length !== 1) {
    console.log(
      `MANUAL  ${file}: ${citedPath} (search: \`${needle}\`) -> ${candidates.length} candidates`,
    );
    continue;
  }

  const from = `\`${citedPath}\` (search: \`${needle}\`)`;
  const to = `\`${candidates[0]}\` (search: \`${needle}\`)`;
  const text = readFileSync(file, "utf-8");
  if (!text.includes(from)) {
    console.log(`MANUAL  ${file}: could not match citation text for ${needle}`);
    continue;
  }
  writeFileSync(file, text.replace(from, to));
  console.log(`OK      ${citedPath} -> ${candidates[0]}  (${needle})`);
  repointed += 1;
}

console.log(`repointed ${repointed} of ${stale.length}`);
