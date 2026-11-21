/** Repair only Claude deny entries; allow/ask choices and unchanged bytes survive. */
// Claude removed MultiEdit in favor of Edit; keep all three migration lists aligned with agent-config-template-parity.test.ts.
const REMOVED_CLAUDE_TOOLS = new Set(["MultiEdit"]);
// File checks use Edit(path) for editing and Read(path) for reading; these unmatched forms warn at launch and enforce nothing.
const UNMATCHED_RULE_REWRITES = new Map([
  ["Write", "Edit"],
  ["NotebookEdit", "Edit"],
  ["Glob", "Read"],
]);
// Broad environment denies blocked reading and editing .env.example even with an allow rule, because deny rules take precedence.
// Expand only denies into explicit sensitive-file variants so the user's sample file no longer matches a deny.
const ENV_DENY_EXPANSIONS = new Map([
  [
    "Read(**/.env*)",
    [
      "Read(**/.env)",
      "Read(**/.env.local)",
      "Read(**/.env.development)",
      "Read(**/.env.production)",
      "Read(**/.env.staging)",
      "Read(**/.env.test)",
      "Read(**/.envrc)",
      "Read(**/.env.*.local)",
    ],
  ],
  [
    "Edit(**/.env*)",
    [
      "Edit(**/.env)",
      "Edit(**/.env.local)",
      "Edit(**/.env.development)",
      "Edit(**/.env.production)",
      "Edit(**/.env.staging)",
      "Edit(**/.env.test)",
      "Edit(**/.envrc)",
      "Edit(**/.env.*.local)",
    ],
  ],
]);
// Retire earlier generated denies that blocked read-only quoted commands or application names such as secrets routes and credentials.ts.
// Identical user-added rules cannot be distinguished, so each removal is reported for the user to inspect.
const RETIRED_DENY_RULES = new Set([
  "Bash(*sudo *)",
  "Bash(*mkfs*)",
  "Bash(*dd if=*)",
  "Bash(*git reset --hard*)",
  "Read(**/secrets/**)",
  "Edit(**/secrets/**)",
  "Read(**/credentials*)",
  "Edit(**/credentials*)",
]);
// Each credential-store rule protects both the developer's home and copies inside the project.
// Pair only a store the user already denies; absent pairs remain a deliberate project choice.
const HOME_ANCHOR_REWRITES = new Map([
  ["Read(**/.ssh/**)", "Read(~/.ssh/**)"],
  ["Read(**/.aws/**)", "Read(~/.aws/**)"],
  ["Read(**/.gnupg/**)", "Read(~/.gnupg/**)"],
  ["Read(**/.docker/config.json)", "Read(~/.docker/**)"],
  ["Read(**/.kube/config)", "Read(~/.kube/**)"],
  ["Read(**/.npmrc)", "Read(~/.npmrc)"],
  ["Read(**/.pypirc)", "Read(~/.pypirc)"],
  ["Edit(**/.ssh/**)", "Edit(~/.ssh/**)"],
  ["Edit(**/.aws/**)", "Edit(~/.aws/**)"],
  ["Edit(**/.gnupg/**)", "Edit(~/.gnupg/**)"],
  ["Edit(**/.docker/config.json)", "Edit(~/.docker/**)"],
  ["Edit(**/.kube/config)", "Edit(~/.kube/**)"],
  ["Edit(**/.npmrc)", "Edit(~/.npmrc)"],
  ["Edit(**/.pypirc)", "Edit(~/.pypirc)"],
]);
const credentialStorePaths = [
  ".ssh/**",
  ".aws/**",
  ".gnupg/**",
  ".config/gcloud/**",
  ".docker/**",
  ".kube/**",
  ".npmrc",
  ".pypirc",
  ".netrc",
  ".git-credentials",
  ".config/gh/hosts.yml",
  ".pgpass",
];
const credentialStoreRulePairs = new Map<string, string[]>();
// Both tools bypass the shell guard, so a saved restriction must protect either way of accessing each store.
for (const tool of ["Read", "Edit"]) {
  for (const storePath of credentialStorePaths) {
    const homeRule = `${tool}(~/${storePath})`;
    const projectRule = `${tool}(**/${storePath})`;
    credentialStoreRulePairs.set(homeRule, [homeRule, projectRule]);
    credentialStoreRulePairs.set(projectRule, [projectRule, homeRule]);
  }
}

// Split a permission rule into tool name and path pattern; null for non-rules.
const parseRule = (entry: unknown) =>
  typeof entry === "string" ? entry.match(/^([A-Za-z]+)\((.*)\)$/u) : null;

// Normalize tool spelling before classifying a deny, so its new form is fully migrated in this install.
const normalizeRule = (entry: unknown) => {
  const rule = parseRule(entry);
  return rule && UNMATCHED_RULE_REWRITES.has(rule[1] ?? "")
    ? `${UNMATCHED_RULE_REWRITES.get(rule[1] ?? "")}(${rule[2]})`
    : entry;
};

// Replace a stale permission rule; an empty list retires it, while null keeps the user's existing rule.
// Only normalized denies enter this function; allow and ask arrays are never transformed.
const replacementsFor = (entry: unknown, savedRules: Set<unknown>) => {
  if (typeof entry !== "string") return null;
  if (RETIRED_DENY_RULES.has(entry)) return [];
  const credentialPair = credentialStoreRulePairs.get(entry);
  // Complete pairs already protect both locations; preserve their positions so reinstalling stays byte-stable.
  if (credentialPair && credentialPair.every((rule) => savedRules.has(rule)))
    return null;
  // Legacy Docker and Kubernetes file rules receive the current store pair without losing project coverage.
  if (HOME_ANCHOR_REWRITES.has(entry)) {
    return credentialStoreRulePairs.get(HOME_ANCHOR_REWRITES.get(entry) ?? "");
  }
  // A home-only upgrade or a project-only rule receives its missing partner.
  if (credentialStoreRulePairs.has(entry))
    return credentialStoreRulePairs.get(entry);
  // A broad retired environment deny expands into the current explicit sensitive-file rules.
  if (ENV_DENY_EXPANSIONS.has(entry)) {
    return ENV_DENY_EXPANSIONS.get(entry);
  }
  return null;
};

// Repair stale permission rules and avoid duplicate replacements while retaining untouched user rules in order.
// Return the repaired array, or null when the saved list needs no change.
const repairRules = (rules: unknown) => {
  // A missing or malformed rule list returns null so setup leaves that setting untouched.
  if (!Array.isArray(rules)) return null;
  const survivors = rules.filter((entry) => {
    const rule = parseRule(entry);
    return !(rule && REMOVED_CLAUDE_TOOLS.has(rule[1] ?? ""));
  });
  const normalized = survivors.map(normalizeRule);
  const savedRules = new Set(normalized);
  const replacements = normalized.map(
    (entry, index) =>
      replacementsFor(entry, savedRules) ??
      (entry === survivors[index] ? null : [entry]),
  );
  const present = new Set(
    survivors.filter((_entry, index) => replacements[index] === null),
  );
  const kept = [];
  // Repair surviving rules in order so unrelated user permissions keep their positions.
  for (const [index, entry] of survivors.entries()) {
    const replacementRules = replacements[index] ?? null;
    // A rule needing no replacement is retained exactly as the user saved it.
    if (replacementRules === null) {
      kept.push(entry);
      continue;
    }
    // Append each replacement once without duplicating a restriction already present.
    for (const replacement of replacementRules) {
      // An existing equivalent rule already expresses this permission choice.
      if (present.has(replacement)) continue;
      present.add(replacement);
      kept.push(replacement);
    }
  }
  const changed =
    kept.length !== rules.length ||
    kept.some((entry, index) => entry !== rules[index]);
  return changed ? kept : null;
};

/** Repair only saved deny rules, preserving allow/ask and byte-identical current settings. */
export function migrateClaudePermissions(
  content: string,
  report: (message: string) => void = () => {},
): string {
  const raw = content;
  let settings: { permissions?: { deny?: unknown } } | null;
  try {
    settings = JSON.parse(raw);
  } catch {
    // A hand-edited syntax error leaves no safe JSON to merge; preserve the user's settings for repair.
    return content;
  }

  const perms = settings && settings.permissions;
  // Without a permissions object, there are no existing Claude rule lists to migrate.
  if (!perms || typeof perms !== "object") {
    return content;
  }

  const previousRules = Array.isArray(perms.deny)
    ? (perms.deny as unknown[])
    : [];
  const repaired = repairRules(previousRules);
  // A current deny list leaves the entire settings file byte-identical, including inert allow/ask spellings.
  if (!repaired) {
    return content;
  }
  perms.deny = repaired;
  const result = renderClaudeSettings(settings, raw);
  reportClaudeChanges(previousRules, repaired, report);
  return result;
}

/** Preserve the settings file's newline style while serializing the repaired rule list. */
function renderClaudeSettings(settings: unknown, raw: string): string {
  const eol = raw.includes("\r\n") ? "\r\n" : "\n";
  const hadFinalNewline = /\r?\n$/u.test(raw);
  let out = JSON.stringify(settings, null, 2);
  // Restore Windows newlines when that was the user's existing settings style.
  if (eol === "\r\n") out = out.replace(/\n/gu, "\r\n");
  return out + (hadFinalNewline ? eol : "");
}

/** Report final deny changes without exposing unrelated settings. */
function reportClaudeChanges(
  previousRules: unknown[],
  repaired: unknown[],
  report: (message: string) => void,
): void {
  // Report final set differences, not intermediate expansions or replacements already present.
  const previousSet = new Set(
    previousRules.filter((entry): entry is string => typeof entry === "string"),
  );
  const repairedSet = new Set(
    repaired.filter((entry): entry is string => typeof entry === "string"),
  );
  for (const entry of previousSet) {
    if (repairedSet.has(entry)) continue;
    const label = RETIRED_DENY_RULES.has(String(normalizeRule(entry)))
      ? "retired Claude"
      : "Claude";
    report(`  - ${label} deny rule removed: ${JSON.stringify(entry)}`);
  }
  for (const entry of repairedSet) {
    if (previousSet.has(entry)) continue;
    const label = credentialStoreRulePairs.has(entry)
      ? "paired Claude credential"
      : "Claude";
    report(`  + ${label} deny rule added: ${JSON.stringify(entry)}`);
  }
  // Retiring the broad filename rule calls for reviewed exact replacements, never automatic additions.
  const exactCredentialRules = [
    "Read(**/credentials.json)",
    "Edit(**/credentials.json)",
  ];
  if (
    [...previousSet].some((entry) =>
      ["Read(**/credentials*)", "Edit(**/credentials*)"].includes(
        String(normalizeRule(entry)),
      ),
    ) &&
    !exactCredentialRules.every((rule) => repairedSet.has(rule))
  ) {
    report(
      `  ! Review replacement denies: ${exactCredentialRules.join(", ")}. Show the diff and obtain approval before adding missing rules; install did not add them.`,
    );
  }
}
