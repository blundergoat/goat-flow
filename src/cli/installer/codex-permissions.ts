/** Preserve active Codex permissions while migrating supported historical forms. */
const anySectionPattern = /^\s*\[[^\]]+\]\s*$/u;
const tomlStringPattern = String.raw`(?:"((?:\\.|[^"\\])*)"|'([^']*)')`;
const noneEntryPattern = new RegExp(
  String.raw`^\s*${tomlStringPattern}\s*=\s*(?:"none"|'none')\s*(?:#.*)?$`,
  "u",
);
const inlineTablePattern = /^\s*"[^"]+"\s*=\s*\{([^}]*)\}\s*(?:#.*)?$/u;
const inlineEntryPattern = new RegExp(
  String.raw`${tomlStringPattern}\s*=\s*(?:"none"|'none')`,
  "gu",
);
const filesystemAccessEntryPattern = new RegExp(
  String.raw`${tomlStringPattern}\s*=\s*(?:"(none|deny|read|write)"|'(none|deny|read|write)')`,
  "gu",
);
const legacyAccessPattern = new RegExp(
  String.raw`^\s*${tomlStringPattern}\s*=\s*(?:"none"|'none')\s*(?:#.*)?$`,
  "u",
);
const legacyInlineAccessPattern = new RegExp(
  String.raw`${tomlStringPattern}\s*=\s*(?:"none"|'none')`,
  "u",
);
const legacyProjectRootsPattern = /":project_roots"/u;
const canonicalDenyPatterns = new Set([
  "**/.env",
  "**/.env.local",
  "**/.env.development",
  "**/.env.production",
  "**/.env.staging",
  "**/.env.test",
  "**/.envrc",
  "**/.env.*.local",
  "**/.ssh/**",
  "**/.aws/**",
  "**/.gnupg/**",
  "**/.config/gcloud/**",
  "**/.docker/**",
  "**/.kube/**",
  "**/.npmrc",
  "**/.netrc",
  "**/.git-credentials",
  "**/.config/gh/hosts.yml",
  "**/.pgpass",
  "**/.pypirc",
  "**/*.pem",
  "**/*.key",
  "**/*.pfx",
]);
const oldGeneratedPatterns = new Set([
  ".",
  "secrets/**",
  "**/secrets/**",
  ".ssh/**",
  ".aws/**",
  ".docker/**",
  ".gnupg/**",
  ".kube/**",
  "**/.env*",
  "**/credentials",
  "**/credentials*",
]);

function parseTomlBasicString(value: string) {
  try {
    return JSON.parse(`"${value}"`) as string;
    // A quoted TOML value with escapes JSON cannot decode keeps the simple quote/backslash fallback for profile matching.
  } catch {
    return value.replace(/\\"/gu, '"').replace(/\\\\/gu, "\\");
  }
}

function tomlKeyFromMatch(match: RegExpMatchArray) {
  return match[1] ?? match[2] ?? "";
}

function tomlModeFromMatch(match: RegExpMatchArray) {
  return match[3] ?? match[4] ?? "";
}

function readActivePermissionProfile(configLines: string[]) {
  // Find the user's explicit active permission profile before falling back to the managed profile.
  for (const line of configLines) {
    const basicMatch = line.match(
      /^\s*default_permissions\s*=\s*"((?:\\.|[^"\\])*)"\s*(?:#.*)?$/u,
    );
    // A quoted default profile selects the permission table setup should refresh.
    if (basicMatch) {
      const profile = parseTomlBasicString(basicMatch[1] ?? "").trim();
      // An empty decoded profile does not select a permission table; continue to the fallback.
      if (profile) return profile;
    }
    const literalMatch = line.match(
      /^\s*default_permissions\s*=\s*'([^']+)'\s*(?:#.*)?$/u,
    );
    // A nonempty literal profile selects the user's active permission table.
    if (literalMatch && (literalMatch[1] ?? "").trim())
      return (literalMatch[1] ?? "").trim();
  }
  return "goat-flow";
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function isInvalidNoneKey(key: string) {
  // An exact path contains no unsupported glob and does not need this compatibility repair.
  if (!key.includes("*")) return false;
  return !key.endsWith("/**");
}

function escapeTomlString(value: string) {
  return value.replace(/\\/gu, "\\\\").replace(/"/gu, '\\"');
}

interface Region {
  start: number;
  end: number;
}
interface PermissionRegions {
  regions: Region[];
  profileRegions: Region[];
}
interface PermissionEvidence {
  hasInvalidEntry: boolean;
  usesLegacyAccess: boolean;
  usesLegacyAnchor: boolean;
  profileExtendsWorkspace: boolean;
  hasProfileInheritance: boolean;
  additionalDenyPatterns: Set<string>;
  activeDenyPatterns: Set<string>;
  legacyDenyPatterns: Set<string>;
  removedAccessRules: Set<string>;
}

/** Bound all edits to the active permission profile's exact TOML regions. */
function permissionRegions(
  lines: string[],
  activeProfile: string,
): PermissionRegions {
  const profileSectionPattern = new RegExp(
    `^\\s*\\[\\s*permissions\\.${escapeRegExp(activeProfile)}\\s*\\]\\s*$`,
    "u",
  );
  const filesystemSectionPattern = new RegExp(
    `^\\s*\\[\\s*permissions\\.${escapeRegExp(activeProfile)}\\.filesystem(?:\\..+)?\\s*\\]\\s*$`,
    "u",
  );

  const regions: Region[] = [];
  const profileRegions: Region[] = [];
  let i = 0;
  // Find only the active profile's permission regions before refreshing user settings.
  while (i < lines.length) {
    // Record the active profile's metadata section for workspace inheritance checks.
    if (profileSectionPattern.test(lines[i] ?? "")) {
      const start = i;
      i = nextSectionStart(lines, i + 1);
      profileRegions.push({ start, end: i });
      // Record the active profile's filesystem tables for deny-rule migration.
    } else if (filesystemSectionPattern.test(lines[i] ?? "")) {
      const start = i;
      i = nextSectionStart(lines, i + 1);
      regions.push({ start, end: i });
    } else {
      i += 1;
    }
  }
  return { regions, profileRegions };
}

/** Stop a permission region before the next table so unrelated profile content survives. */
function nextSectionStart(lines: string[], start: number): number {
  let end = start;
  while (end < lines.length && !anySectionPattern.test(lines[end] ?? ""))
    end += 1;
  return end;
}

/** Flatten only selected profile regions, retaining their source order. */
function regionLines(lines: string[], regions: Region[]): string[] {
  return regions.flatMap(({ start, end }) => lines.slice(start, end));
}

/** Classify one saved access rule while retaining nonstandard user denies. */
function collectPermissionEntry(
  entry: RegExpMatchArray,
  state: PermissionEvidence,
): void {
  const pattern = tomlKeyFromMatch(entry);
  const mode = tomlModeFromMatch(entry);
  if (["read", "write"].includes(mode))
    state.removedAccessRules.add(
      `${JSON.stringify(pattern)} = ${JSON.stringify(mode)}`,
    );
  if (!pattern || !["none", "deny"].includes(mode)) return;
  state.activeDenyPatterns.add(pattern);
  if (mode === "none") state.legacyDenyPatterns.add(pattern);
  if (!canonicalDenyPatterns.has(pattern) && !oldGeneratedPatterns.has(pattern))
    state.additionalDenyPatterns.add(pattern);
  if (mode === "none" && isInvalidNoneKey(pattern))
    state.hasInvalidEntry = true;
}

/** Detect unsupported none entries in both TOML spellings already handled by the installer. */
function hasInvalidNoneEntry(line: string): boolean {
  const standalone = line.match(noneEntryPattern);
  if (standalone && isInvalidNoneKey(tomlKeyFromMatch(standalone))) return true;
  const inline = line.match(inlineTablePattern);
  return [...(inline?.[1] ?? "").matchAll(inlineEntryPattern)].some((entry) =>
    isInvalidNoneKey(tomlKeyFromMatch(entry)),
  );
}

/** Read existing restrictions before replacing any region or reporting a policy delta. */
function permissionEvidence(
  lines: string[],
  bounds: PermissionRegions,
): PermissionEvidence {
  const metadata = regionLines(lines, bounds.profileRegions);
  const state: PermissionEvidence = {
    hasInvalidEntry: false,
    usesLegacyAccess: false,
    usesLegacyAnchor: false,
    profileExtendsWorkspace: metadata.some((line) =>
      /^\s*extends\s*=\s*":workspace"\s*(?:#.*)?$/u.test(line),
    ),
    hasProfileInheritance: metadata.some((line) =>
      /^\s*extends\s*=/u.test(line),
    ),
    additionalDenyPatterns: new Set(),
    activeDenyPatterns: new Set(),
    legacyDenyPatterns: new Set(),
    removedAccessRules: new Set(),
  };
  for (const raw of regionLines(lines, bounds.regions)) {
    const line = raw.replace(/"(?:\\.|[^"\\])*"|'[^']*'|#.*$/gu, (token) =>
      token.startsWith("#") ? "" : token,
    );
    state.usesLegacyAnchor ||= legacyProjectRootsPattern.test(line);
    state.usesLegacyAccess ||=
      legacyAccessPattern.test(line) || legacyInlineAccessPattern.test(line);
    for (const entry of line.matchAll(filesystemAccessEntryPattern))
      collectPermissionEntry(entry, state);
    state.hasInvalidEntry ||= hasInvalidNoneEntry(line);
  }
  return state;
}

/** Render the managed restriction block in the existing stable order. */
function permissionBlock(
  activeProfile: string,
  additionalDenyPatterns: Set<string>,
): string[] {
  const canonicalBlock = [
    `[permissions.${activeProfile}]`,
    'description = "goat-flow workspace editing with secret-path read denies."',
    'extends = ":workspace"',
    "",
    `[permissions.${activeProfile}.filesystem]`,
    "glob_scan_max_depth = 3",
    "",
    `[permissions.${activeProfile}.filesystem.":workspace_roots"]`,
    "# Deny rules win over allow/read rules on both Codex and Claude, so a broad",
    "# .env* deny cannot be re-opened for the sample file. Real env variants are",
    "# denied individually so .env.example stays readable, matching the Bash deny",
    "# hook; nonstandard variants (e.g. .env.backup) are covered by that hook.",
    "# Rules match secret content shapes and credential stores, never plain folder",
    "# or file names such as secrets/ or credentials*, which collide with ordinary",
    "# application code. The Bash deny hook covers shell access to home stores.",
    '"**/.env" = "deny"',
    '"**/.env.local" = "deny"',
    '"**/.env.development" = "deny"',
    '"**/.env.production" = "deny"',
    '"**/.env.staging" = "deny"',
    '"**/.env.test" = "deny"',
    '"**/.envrc" = "deny"',
    '"**/.env.*.local" = "deny"',
    '"**/.ssh/**" = "deny"',
    '"**/.aws/**" = "deny"',
    '"**/.gnupg/**" = "deny"',
    '"**/.config/gcloud/**" = "deny"',
    '"**/.docker/**" = "deny"',
    '"**/.kube/**" = "deny"',
    '"**/.npmrc" = "deny"',
    '"**/.netrc" = "deny"',
    '"**/.git-credentials" = "deny"',
    '"**/.config/gh/hosts.yml" = "deny"',
    '"**/.pgpass" = "deny"',
    '"**/.pypirc" = "deny"',
    '"**/*.pem" = "deny"',
    '"**/*.key" = "deny"',
    '"**/*.pfx" = "deny"',
  ];
  for (const pattern of additionalDenyPatterns)
    canonicalBlock.push(`"${escapeTomlString(pattern)}" = "deny"`);
  return canonicalBlock;
}

/** Replace only selected regions and preserve surrounding user settings and newline style. */
function renderPermissions(
  lines: string[],
  bounds: PermissionRegions,
  canonicalBlock: string[],
  format: { eol: string; hadFinalNewline: boolean },
): string {
  const { regions, profileRegions } = bounds;
  const { eol, hadFinalNewline } = format;

  const firstRegionStart = Math.min(
    ...regions.map((region) => region.start),
    ...profileRegions.map((region) => region.start),
  );
  const before = lines.slice(0, firstRegionStart);
  const after = retainedFollowingLines(lines, bounds);

  // Trim only blank separators immediately before the rebuilt permission profile.
  while (before.at(-1)?.trim() === "") before.pop();
  let trailingStart = 0;
  // Trim only blank separators immediately after the rebuilt permission profile.
  while (after[trailingStart]?.trim() === "") trailingStart += 1;

  const rebuilt = [...before];
  // Separate the refreshed profile from earlier retained user settings.
  if (rebuilt.length > 0) rebuilt.push("");
  rebuilt.push(...canonicalBlock);
  // Append later retained settings with one separator after the refreshed profile.
  if (trailingStart < after.length) {
    rebuilt.push("");
    rebuilt.push(...after.slice(trailingStart));
  }

  const result = rebuilt.join(eol) + (hadFinalNewline ? eol : "");
  return result;
}

/** Keep lines outside replaced permission regions in their original order. */
function retainedFollowingLines(
  lines: string[],
  bounds: PermissionRegions,
): string[] {
  const { regions, profileRegions } = bounds;
  const inRegion = new Array(lines.length).fill(false);
  // Mark the old filesystem regions that the refreshed profile will replace.
  for (const region of [...regions, ...profileRegions]) {
    // Each line in these owned regions is omitted from the retained surrounding settings.
    for (let j = region.start; j < region.end; j += 1) inRegion[j] = true;
  }
  const firstRegionStart = Math.min(
    ...regions.map((region) => region.start),
    ...profileRegions.map((region) => region.start),
  );

  const after = [];
  // Retain the settings after the first replaced region, excluding the other replaced profile regions.
  for (let j = firstRegionStart; j < lines.length; j += 1) {
    // Lines outside the replaced regions remain part of the user's settings.
    if (!inRegion[j]) after.push(lines[j] ?? "");
  }

  return after;
}

/** Report only final policy differences, excluding unrelated profile values. */
function reportPermissionMigration(
  state: PermissionEvidence,
  report: (message: string) => void,
): void {
  const {
    activeDenyPatterns,
    removedAccessRules,
    legacyDenyPatterns,
    usesLegacyAnchor,
    profileExtendsWorkspace,
    hasProfileInheritance,
  } = state;
  const retiredDenyPatterns = [...activeDenyPatterns].filter((pattern) =>
    oldGeneratedPatterns.has(pattern),
  );

  // Report permission deltas only; unrelated values and profile descriptions are never echoed.
  for (const pattern of retiredDenyPatterns) {
    report(
      `  - retired Codex deny pattern removed: ${JSON.stringify(pattern)}`,
    );
  }
  for (const rule of removedAccessRules) {
    report(`  - Codex filesystem access rule removed: ${rule}`);
  }
  for (const pattern of canonicalDenyPatterns) {
    if (!activeDenyPatterns.has(pattern)) {
      report(`  + Codex deny pattern added: ${JSON.stringify(pattern)}`);
    }
  }
  for (const pattern of legacyDenyPatterns) {
    if (!oldGeneratedPatterns.has(pattern)) {
      report(
        `  ~ Codex deny mode rewritten: ${JSON.stringify(pattern)}: none -> deny`,
      );
    }
  }
  if (usesLegacyAnchor) {
    report(
      "  ~ Codex permission anchor rewritten: :project_roots -> :workspace_roots",
    );
  }
  if (!profileExtendsWorkspace) {
    const change = hasProfileInheritance
      ? "~ Codex permission inheritance rewritten"
      : "+ Codex permission inheritance added";
    report(`  ${change}: extends = ":workspace"`);
  }
}

/** Refresh the active profile without rewriting current bytes or losing extra user denies. */
export function migrateCodexPermissions(
  content: string,
  report: (message: string) => void = () => {},
): string {
  const eol = content.includes("\r\n") ? "\r\n" : "\n";
  const hadFinalNewline = /\r?\n$/u.test(content);
  const lines = content.split(/\r?\n/u);
  if (hadFinalNewline) lines.pop();
  const activeProfile = readActivePermissionProfile(lines);
  const bounds = permissionRegions(lines, activeProfile);
  const hasDefaultPermissions = lines.some((line) =>
    /^\s*default_permissions\s*=/u.test(line),
  );
  if (
    !hasDefaultPermissions &&
    [...bounds.regions, ...bounds.profileRegions].length === 0
  )
    return content;
  const state = permissionEvidence(lines, bounds);
  const needsInheritance =
    activeProfile === "goat-flow" &&
    hasDefaultPermissions &&
    !state.profileExtendsWorkspace;
  const missing = [...canonicalDenyPatterns].some(
    (pattern) => !state.activeDenyPatterns.has(pattern),
  );
  const retired = [...state.activeDenyPatterns].some((pattern) =>
    oldGeneratedPatterns.has(pattern),
  );
  if (
    ![
      state.hasInvalidEntry,
      state.usesLegacyAnchor,
      state.usesLegacyAccess,
      needsInheritance,
      missing,
      retired,
    ].some(Boolean)
  )
    return content;
  const result = renderPermissions(
    lines,
    bounds,
    permissionBlock(activeProfile, state.additionalDenyPatterns),
    { eol, hadFinalNewline },
  );
  reportPermissionMigration(state, report);
  return result;
}

/** Validate one active filesystem line without reading unrelated profiles. */
function permissionLineProblems(line: string): string[] {
  const problems: string[] = [];
  const standalone = line.match(/^\s*"([^"]+)"\s*=\s*"none"\s*(?:#.*)?$/u);
  if (standalone && isInvalidNoneKey(standalone[1] ?? ""))
    problems.push(`section entry "${standalone[1]}" with access="none"`);
  if (
    /^\s*"[^"]+"\s*=\s*"none"\s*(?:#.*)?$/u.test(line) ||
    /"[^"]+"\s*=\s*"none"/u.test(line)
  )
    problems.push('legacy access value "none" still present');
  if (legacyProjectRootsPattern.test(line))
    problems.push("legacy :project_roots anchor still present");
  problems.push(...inlinePermissionProblems(line));
  return problems;
}

/** Decode unsupported legacy inline access entries from one filesystem line. */
function inlinePermissionProblems(line: string): string[] {
  const problems: string[] = [];
  const inline = line.match(inlineTablePattern);
  for (const entry of (inline?.[1] ?? "").matchAll(
    /"([^"]+)"\s*=\s*"none"/gu,
  )) {
    if (isInvalidNoneKey(entry[1] ?? ""))
      problems.push(`inline entry "${entry[1]}" with access="none"`);
  }
  return problems;
}

/** Report unsupported active entries before installation records success. */
export function validateCodexPermissions(content: string): string | null {
  const lines = content.split(/\r?\n/u);
  const activeProfile = readActivePermissionProfile(lines);
  const bounds = permissionRegions(lines, activeProfile);
  const problems = new Set<string>();
  const hasDefaultPermissions = lines.some((line) =>
    /^\s*default_permissions\s*=/u.test(line),
  );
  const extendsWorkspace = regionLines(lines, bounds.profileRegions).some(
    (line) => /^\s*extends\s*=\s*":workspace"\s*(?:#.*)?$/u.test(line),
  );
  if (
    activeProfile === "goat-flow" &&
    hasDefaultPermissions &&
    !extendsWorkspace
  )
    problems.add('active goat-flow profile does not extend ":workspace"');
  for (const line of regionLines(lines, bounds.regions))
    for (const problem of permissionLineProblems(line)) problems.add(problem);
  return problems.size ? [...problems].join("; ") : null;
}
