/** Preserve saved Codex hook choices when replacing the retired feature key. */
export function migrateCodexFeatures(content: string): string {
  const eol = content.includes("\r\n") ? "\r\n" : "\n";
  const hadFinalNewline = /\r?\n$/u.test(content);
  const lines = content.split(/\r?\n/u);
  // Keep the user's original final-newline choice when rebuilding Codex settings.
  if (hadFinalNewline) lines.pop();

  const { deprecated, current } = collectFeatureAssignments(lines);

  // Without the retired flag, the user's current feature settings need no migration.
  if (deprecated.length === 0) {
    return content;
  }

  const remove = new Set();
  // If no current flag exists, rename the first retired flag while keeping its saved boolean.
  if (current.length === 0) {
    const first = deprecated[0];
    if (!first) return content;
    const replacementKey = first.assignment.rawKey.includes(".")
      ? "features.hooks"
      : "hooks";
    lines[first.index] =
      first.assignment.indent +
      replacementKey +
      first.assignment.separator +
      first.assignment.value +
      first.assignment.suffix;
    // Remove duplicate retired flags after retaining the user's first migrated choice.
    for (const entry of deprecated.slice(1)) remove.add(entry.index);
  } else {
    // Remove retired flags when a current flag already records the user's choice.
    for (const entry of deprecated) remove.add(entry.index);
  }

  const next = lines.filter((_, index) => !remove.has(index)).join(eol);
  return next + (hadFinalNewline ? eol : "");
}

/** Read saved feature assignments without changing current-key precedence. */
function collectFeatureAssignments(lines: string[]) {
  // Read a saved Codex hook flag without changing its boolean; null means the line has no migratable flag.
  function parseFeatureBooleanAssignment(line: string, section: string) {
    // Blank and comment lines cannot supply a hook feature toggle.
    if (/^\s*(#|$)/u.test(line)) return null;
    const match = line.match(
      /^(\s*)([A-Za-z0-9_.-]+)(\s*=\s*)(true|false)(\s*(?:#.*)?)$/u,
    );
    // A non-boolean assignment is outside this hook-flag migration.
    if (!match) return null;
    const [
      ,
      indent = "",
      rawKey = "",
      separator = "",
      value = "",
      suffix = "",
    ] = match;
    const normalizedKey =
      section === "features" && !rawKey.includes(".")
        ? `features.${rawKey}`
        : rawKey;
    return { indent, rawKey, separator, value, suffix, normalizedKey };
  }

  let section = "";
  const deprecated = [];
  const current = [];
  // Inspect Codex feature assignments while retaining the user's surrounding settings.
  for (let index = 0; index < lines.length; index += 1) {
    const sectionMatch = (lines[index] ?? "").match(
      /^\s*\[([^\]]+)\]\s*(?:#.*)?$/u,
    );
    // Track the TOML table so a hook flag is interpreted in its actual section.
    if (sectionMatch) {
      section = (sectionMatch[1] ?? "").trim();
      continue;
    }
    const assignment = parseFeatureBooleanAssignment(
      lines[index] ?? "",
      section,
    );
    // Unrelated assignments do not change the user's hook feature choice.
    if (!assignment) continue;
    // Collect the retired hook flag so its saved boolean can migrate.
    if (assignment.normalizedKey === "features.codex_hooks") {
      deprecated.push({ index, assignment });
      // A current hook flag takes priority over the user's earlier retired flag.
    } else if (assignment.normalizedKey === "features.hooks") {
      current.push(index);
    }
  }

  return { deprecated, current };
}
