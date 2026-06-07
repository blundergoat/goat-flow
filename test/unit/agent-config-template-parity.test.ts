/**
 * Agent config template parity: Claude and Codex use different config formats,
 * but their broad secret path families must not drift silently.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const PROJECT_ROOT = resolve(import.meta.dirname, "..", "..");

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

describe("agent config template parity", () => {
  it("keeps Codex broad secret-path denies aligned with Claude", () => {
    const claude = JSON.parse(
      readFileSync(
        join(PROJECT_ROOT, "workflow/hooks/agent-config/claude.json"),
        "utf-8",
      ),
    ) as { permissions?: { deny?: unknown } };
    const claudeDeny = Array.isArray(claude.permissions?.deny)
      ? claude.permissions.deny.filter(
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

    for (const pattern of ["**/.env*", "**/credentials*"]) {
      assert.ok(
        claudeReadPatterns.has(pattern),
        `Claude template should deny Read(${pattern})`,
      );
      assert.match(
        codexTemplate,
        new RegExp(`"${escapeRegExp(pattern)}"\\s*=\\s*"deny"`),
        `Codex template should deny ${pattern}`,
      );
    }
    assert.match(codexTemplate, /env\.example is intentionally denied/);
  });

  // Regression guard: Claude Code v2.x removed the MultiEdit tool, so any
  // `MultiEdit(...)` deny rule prints "matches no known tool" on every launch.
  // The fix has silently regressed once (re-added by a later hook commit), so
  // this locks every deny rule to a tool Claude still recognises.
  it("never denies a removed/unknown Claude tool (e.g. MultiEdit)", () => {
    const claude = JSON.parse(
      readFileSync(
        join(PROJECT_ROOT, "workflow/hooks/agent-config/claude.json"),
        "utf-8",
      ),
    ) as { permissions?: { deny?: unknown } };
    const claudeDeny = Array.isArray(claude.permissions?.deny)
      ? claude.permissions.deny.filter(
          (entry): entry is string => typeof entry === "string",
        )
      : [];
    const knownTools = new Set(["Bash", "Read", "Edit", "Write"]);
    for (const entry of claudeDeny) {
      const tool = entry.match(/^([A-Za-z]+)\(/u)?.[1];
      assert.ok(
        tool && knownTools.has(tool),
        `Claude deny rule "${entry}" targets unknown tool "${tool ?? "?"}" — Claude Code will warn "matches no known tool" on launch (MultiEdit was removed in v2.x).`,
      );
    }
  });
});
