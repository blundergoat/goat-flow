import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const dispatcherContent = readFileSync(
  join(import.meta.dirname, "../../.claude/skills/goat/SKILL.md"),
  "utf-8",
);

describe("Dispatcher intake flow", () => {
  it("uses UNDERSTAND → GATHER → ROUTE instead of an intent table", () => {
    assert.ok(
      dispatcherContent.includes("UNDERSTAND"),
      "Dispatcher should have an UNDERSTAND step",
    );
    assert.ok(
      dispatcherContent.includes("GATHER"),
      "Dispatcher should have a GATHER step",
    );
    assert.ok(
      dispatcherContent.includes("ROUTE"),
      "Dispatcher should have a ROUTE step",
    );
    assert.ok(
      !dispatcherContent.includes("## Intent Mapping"),
      "Dispatcher should not keep the old intent mapping table",
    );
  });

  it("documents direct implementation path", () => {
    assert.ok(
      dispatcherContent.includes("Simple implementation") ||
        dispatcherContent.includes("no skill"),
      "Dispatcher should document direct implementation handling",
    );
    assert.ok(
      dispatcherContent.includes("execution loop"),
      "Simple implementation requests should proceed with the execution loop",
    );
  });

  it("documents clarification question budget", () => {
    assert.ok(
      dispatcherContent.includes("Ask 0/1/2"),
      "Dispatcher should have clarification rules with question budget",
    );
    assert.ok(
      dispatcherContent.includes("one question") ||
        dispatcherContent.includes("two question") ||
        dispatcherContent.includes("0/1/2"),
      "Dispatcher should cap at two clarifying questions maximum",
    );
  });

  it("has Planning Route with feature briefs and mob elaboration", () => {
    assert.ok(
      dispatcherContent.includes("Planning Route"),
      "Dispatcher should have a Planning Route section",
    );
    assert.ok(
      dispatcherContent.includes("Mob Elaboration") ||
        dispatcherContent.includes("mob elaboration"),
      "Dispatcher should handle mob elaboration in Planning Route",
    );
  });

  it("gathers enriched routing context", () => {
    assert.ok(
      dispatcherContent.includes("Ask First"),
      "Dispatcher should gather Ask First boundaries",
    );
    assert.ok(
      dispatcherContent.includes("footguns"),
      "Dispatcher should gather footgun context",
    );
    assert.ok(
      dispatcherContent.includes("git log --oneline -5"),
      "Dispatcher should gather recent git context",
    );
    assert.ok(
      dispatcherContent.includes("toolchain"),
      "Dispatcher should gather toolchain context",
    );
  });

  it("mentions all 5 specialized skills", () => {
    for (const skill of [
      "goat-debug",
      "goat-review",
      "goat-plan",
      "goat-security",
      "goat-test",
    ]) {
      assert.ok(
        dispatcherContent.includes(skill),
        `${skill} should appear in the dispatcher`,
      );
    }
  });
});

describe("Dispatcher skill content contracts", () => {
  it("has escape hatch for simple questions", () => {
    assert.ok(
      dispatcherContent.includes("Simple factual questions") ||
        dispatcherContent.includes("answer directly"),
      "Dispatcher should route simple factual questions to direct answers",
    );
  });

  it("has disambiguation for ambiguous inputs", () => {
    assert.ok(
      dispatcherContent.includes("Common Ambiguities"),
      "Should have Common Ambiguities table",
    );
    assert.ok(
      dispatcherContent.includes("check the auth code"),
      "Should have auth code disambiguation",
    );
  });

  it("has re-route support after handoff", () => {
    assert.ok(
      dispatcherContent.includes("Re-Route"),
      "Should support route handoff after setup context drift",
    );
  });

  it("has override support", () => {
    assert.ok(
      dispatcherContent.includes("Override"),
      "Should support explicit skill overrides",
    );
    assert.ok(
      dispatcherContent.includes("override"),
      "Should document explicit override handling",
    );
  });

  it("has bare invocation examples", () => {
    assert.ok(
      dispatcherContent.includes("Bare Invocation"),
      "Should handle /goat with no args",
    );
  });
});
