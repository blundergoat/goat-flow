/**
 * Agent config template parity: Claude and Codex use different config formats,
 * but their broad secret path families must not drift silently.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const PROJECT_ROOT = resolve(import.meta.dirname, "..", "..");

/** Escape a deny glob before embedding it in a regex that checks template parity. */
function escapeRegExp(literalText: string): string {
  return literalText.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

describe("agent config template parity", () => {
  const claude = JSON.parse(
    readFileSync(
      join(PROJECT_ROOT, "workflow/hooks/agent-config/claude.json"),
      "utf-8",
    ),
  ) as { permissions?: { deny?: unknown; allow?: unknown } };
  const claudeDeny = Array.isArray(claude.permissions?.deny)
    ? claude.permissions.deny.filter(
        (entry): entry is string => typeof entry === "string",
      )
    : [];
  const claudeAllow = Array.isArray(claude.permissions?.allow)
    ? claude.permissions.allow.filter(
        (entry): entry is string => typeof entry === "string",
      )
    : [];
  const claudeReadPatterns = new Set(
    claudeDeny.flatMap((entry) => {
      const match = entry.match(/^Read\((.+)\)$/u);
      return match?.[1] ? [match[1]] : [];
    }),
  );
  const codexTemplate = readFileSync(
    join(PROJECT_ROOT, "workflow/hooks/agent-config/codex.toml"),
    "utf-8",
  );

  // Env policy: deny rules beat allow rules on BOTH agents, so a broad
  // **/.env* deny would shadow .env.example. Each real env variant is
  // denied individually instead - for Read AND Edit - so .env.example stays
  // readable and writable (matching the Bash deny hook).
  const envDenyPaths = [
    "**/.env",
    "**/.env.local",
    "**/.env.development",
    "**/.env.production",
    "**/.env.staging",
    "**/.env.test",
    "**/.envrc",
    "**/.env.*.local",
  ];

  // One named case per env file, so a failure names the variant left readable.
  for (const pattern of envDenyPaths) {
    // Covers one real env variant: both agents must deny it for Read and Edit.
    it(`keeps Codex secret-path denies aligned with Claude for ${pattern}`, () => {
      assert.ok(
        claudeReadPatterns.has(pattern),
        `Claude template should deny Read(${pattern})`,
      );
      assert.ok(
        claudeDeny.includes(`Edit(${pattern})`),
        `Claude template should deny Edit(${pattern})`,
      );
      assert.match(
        codexTemplate,
        new RegExp(`"${escapeRegExp(pattern)}"\\s*=\\s*"deny"`),
        `Codex template should deny ${pattern}`,
      );
    });
  }

  // Covers the broad-glob trap: a wildcard deny would shadow the .env.example allow.
  it("keeps .env.example usable by avoiding a broad env deny", () => {
    assert.ok(
      !claudeReadPatterns.has("**/.env*"),
      "broad Read(**/.env*) would shadow the .env.example allow (deny wins)",
    );
    assert.ok(
      !claudeDeny.includes("Edit(**/.env*)"),
      "broad Edit(**/.env*) would shadow the .env.example edit allow (deny wins)",
    );
    assert.doesNotMatch(
      codexTemplate,
      new RegExp(`"${escapeRegExp("**/.env*")}"\\s*=\\s*"deny"`),
      "broad **/.env* would deny .env.example on Codex",
    );
    assert.ok(
      claudeAllow.includes("Read(**/.env.example)"),
      "sample env allow entry present on Claude",
    );
    assert.ok(
      claudeAllow.includes("Edit(**/.env.example)"),
      "sample env edit allow entry present on Claude",
    );
    assert.match(codexTemplate, /env\.example stays readable/);

    assert.ok(
      claudeReadPatterns.has("**/credentials*"),
      "Claude template should deny Read(**/credentials*)",
    );
    assert.match(
      codexTemplate,
      new RegExp(`"${escapeRegExp("**/credentials*")}"\\s*=\\s*"deny"`),
      "Codex template should deny **/credentials*",
    );
  });

  // Regression guard: Claude Code v2.x removed the MultiEdit tool ("matches
  // no known tool" on every launch), and file permission checks only match
  // Edit(path)/Read(path) rules - Write(path), NotebookEdit(path), and
  // Glob(path) deny rules warn at launch and enforce nothing (Edit covers all
  // file-editing tools). The MultiEdit fix silently regressed once (re-added
  // by a later hook commit), so this locks every deny rule in the template
  // AND the controlling workspace settings to a form Claude actually matches.
  // Keep this allow-set in sync with REMOVED_CLAUDE_TOOLS and
  // UNMATCHED_RULE_REWRITES in workflow/install-goat-flow.sh.
  // One named case per config file and rule list, so a failure names the exact list to open.
  for (const configPath of [
    "workflow/hooks/agent-config/claude.json",
    ".claude/settings.json",
  ]) {
    for (const arrayName of ["deny", "allow", "ask"]) {
      // Covers rule forms Claude cannot match: a rule naming an unmatched tool never applies,
      // so a user would believe a permission is enforced while it silently does nothing.
      it(`never carries a rule form Claude will not match in ${configPath} ${arrayName}`, () => {
        const matchedRuleTools = new Set(["Bash", "Read", "Edit"]);
        const claude = JSON.parse(
          readFileSync(join(PROJECT_ROOT, configPath), "utf-8"),
        ) as { permissions?: Record<string, unknown> };
        const rules = Array.isArray(claude.permissions?.[arrayName])
          ? (claude.permissions?.[arrayName] as unknown[]).filter(
              (entry): entry is string => typeof entry === "string",
            )
          : [];
        const unmatchedRules = rules.filter((entry) => {
          const tool = entry.match(/^([A-Za-z]+)\(/u)?.[1];
          return !tool || !matchedRuleTools.has(tool);
        });
        assert.deepEqual(
          unmatchedRules,
          [],
          `${configPath} ${arrayName} rules must use permission-matched tools (Bash/Read/Edit); got ${unmatchedRules.join(", ")}`,
        );
      });
    }
  }
});
