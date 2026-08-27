/**
 * Guards deterministic dispatcher-corpus integrity, not model behaviour.
 * The suite validates source provenance, policy coverage, and normalized expected outcomes;
 * live provider qualification remains a separate, explicitly identified run.
 */
import { execFileSync } from "node:child_process";
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { getSkillNames } from "../../src/cli/constants.js";
import {
  readMarkdownSection,
  readProjectFile,
  REPOSITORY_ROOT,
} from "./skill-hardening.helpers.js";

const DISPATCHER_PATH = "workflow/skills/goat/SKILL.md";
const FIXTURE_PATH = "test/fixtures/dispatcher-routing/cases.jsonl";
const EXPECTED_CASE_COUNT = 18;
const ROUTE_KINDS = [
  "skill",
  "quality-flow",
  "direct-execution",
  "direct-answer",
  "context-only",
] as const;
const NON_SKILL_KINDS = ROUTE_KINDS.filter((kind) => kind !== "skill");
const ROUTE_MODES = ["diagnose", "investigate"] as const;
const ROUTE_FLAGS = ["browser-evidence-first", "return-to-implement"] as const;
const CASE_TYPES = ["positive", "negative", "ambiguous"] as const;

type RouteKind = (typeof ROUTE_KINDS)[number];
type RouteMode = (typeof ROUTE_MODES)[number];
type RouteFlag = (typeof ROUTE_FLAGS)[number];
type CaseType = (typeof CASE_TYPES)[number];

/** Normalized terminal route whose optional fields are constrained by route kind. */
interface RouteDecision {
  kind: RouteKind;
  target?: string;
  mode?: RouteMode;
  flags?: RouteFlag[];
}

/** Source-grounded prompt case with strict expectations and explicit leniency. */
interface RoutingCase {
  id: string;
  prompt: string;
  source: { path: string; anchor: string };
  policy: { section: string; anchor: string };
  expected: RouteDecision[];
  acceptable: RouteDecision[][];
  type: CaseType;
  note: string;
}

const ROUTING_CASES = readProjectFile(FIXTURE_PATH)
  .split(/\r?\n/u)
  .filter(Boolean)
  .map((line) => JSON.parse(line) as RoutingCase);
const CANONICAL_TARGETS = new Set(
  getSkillNames().filter((skillName) => skillName !== "goat"),
);

/** Return sorted own keys so fixture schema drift produces deterministic diagnostics. */
function sortedKeys(candidateObject: object): string[] {
  return Object.keys(candidateObject).sort();
}

/** Maintain the exact-schema invariant by rejecting missing or surplus fields. */
function assertExactKeys(
  candidateObject: object,
  expectedKeys: readonly string[],
  label: string,
): void {
  assert.deepEqual(
    sortedKeys(candidateObject),
    [...expectedKeys].sort(),
    label,
  );
}

/** Invariant: each route kind uses only its permitted normalized fields and values. */
function assertDecision(decision: RouteDecision, label: string): void {
  const permittedKeys = ["kind", "target", "mode", "flags"];
  assert.ok(
    sortedKeys(decision).every((key) => permittedKeys.includes(key)),
    `${label}: unsupported decision field`,
  );
  assert.ok(ROUTE_KINDS.includes(decision.kind), `${label}: invalid kind`);

  if (decision.kind === "skill") {
    assert.equal(typeof decision.target, "string", `${label}: missing target`);
    assert.ok(
      CANONICAL_TARGETS.has(decision.target ?? ""),
      `${label}: target must be canonical and cannot be goat`,
    );
  } else {
    assert.equal(decision.target, undefined, `${label}: non-skill target`);
    assert.equal(decision.mode, undefined, `${label}: non-skill mode`);
  }

  if (decision.mode !== undefined) {
    assert.ok(ROUTE_MODES.includes(decision.mode), `${label}: invalid mode`);
    assert.equal(decision.target, "goat-debug", `${label}: mode owner`);
  }

  if (decision.flags !== undefined) {
    assert.ok(decision.flags.length > 0, `${label}: empty flags`);
    assert.deepEqual(
      decision.flags,
      [...new Set(decision.flags)].sort(),
      `${label}: flags must be sorted and unique`,
    );
    for (const flag of decision.flags) {
      assert.ok(ROUTE_FLAGS.includes(flag), `${label}: invalid flag ${flag}`);
      if (flag === "browser-evidence-first") {
        assert.equal(decision.target, "goat-debug", `${label}: browser flag`);
      }
      if (flag === "return-to-implement") {
        assert.equal(decision.target, "goat-plan", `${label}: return flag`);
      }
    }
  }
}

/** Assert every decision in one ordered route sequence. */
function assertDecisionSequence(
  decisions: RouteDecision[],
  label: string,
): void {
  assert.ok(decisions.length > 0, `${label}: empty decision sequence`);
  for (const [decisionIndex, decision] of decisions.entries()) {
    assertDecision(decision, `${label}[${decisionIndex}]`);
  }
}

/** Extract exact Intent cells from the live dispatcher Route Map table. */
function liveRouteMapIntents(): string[] {
  const routeMap = readMarkdownSection(DISPATCHER_PATH, "Route Map");
  return routeMap
    .split(/\r?\n/u)
    .map((line) => /^\|\s*([^|]+?)\s*\|/u.exec(line)?.[1] ?? "")
    .filter((cell) => cell !== "" && cell !== "Intent" && !/^-+$/u.test(cell));
}

/** Side effects: spawns a read-only Git query to verify clone-valid provenance paths. */
function trackedProjectPaths(): Set<string> {
  return new Set(
    execFileSync("git", ["ls-files", "-z"], {
      cwd: REPOSITORY_ROOT,
      encoding: "utf8",
    })
      .split("\0")
      .filter(Boolean),
  );
}

/** Flatten strict expected decisions without treating lenient alternatives as policy. */
function expectedDecisions(): RouteDecision[] {
  return ROUTING_CASES.flatMap((routingCase) => routingCase.expected);
}

/** Maintain source, schema, uniqueness, and ambiguity invariants for the full corpus. */
function assertCorpusIntegrity(): void {
  const trackedPaths = trackedProjectPaths();
  const ids = new Set<string>();
  const prompts = new Set<string>();
  const notes = new Set<string>();

  assert.equal(ROUTING_CASES.length, EXPECTED_CASE_COUNT);
  for (const routingCase of ROUTING_CASES) {
    assertExactKeys(
      routingCase,
      [
        "id",
        "prompt",
        "source",
        "policy",
        "expected",
        "acceptable",
        "type",
        "note",
      ],
      routingCase.id,
    );
    assertExactKeys(routingCase.source, ["path", "anchor"], routingCase.id);
    assertExactKeys(routingCase.policy, ["section", "anchor"], routingCase.id);
    assert.match(routingCase.id, /^[a-z0-9]+(?:-[a-z0-9]+)*$/u);
    assert.ok(routingCase.prompt.trim().length > 0, routingCase.id);
    assert.ok(CASE_TYPES.includes(routingCase.type), routingCase.id);
    assert.match(
      routingCase.note,
      /^Regression: .+ Impact: .+$/u,
      routingCase.id,
    );
    assert.equal(
      ids.has(routingCase.id),
      false,
      `duplicate id ${routingCase.id}`,
    );
    assert.equal(
      prompts.has(routingCase.prompt),
      false,
      `duplicate prompt ${routingCase.id}`,
    );
    assert.equal(
      notes.has(routingCase.note),
      false,
      `duplicate consequence ${routingCase.id}`,
    );
    ids.add(routingCase.id);
    prompts.add(routingCase.prompt);
    notes.add(routingCase.note);

    assert.ok(
      trackedPaths.has(routingCase.source.path),
      `${routingCase.id}: source path is not tracked`,
    );
    assert.match(routingCase.source.anchor, /\S/u, routingCase.id);
    assert.ok(
      readProjectFile(routingCase.source.path).includes(
        routingCase.source.anchor,
      ),
      `${routingCase.id}: source anchor does not resolve`,
    );
    assert.ok(
      readMarkdownSection(DISPATCHER_PATH, routingCase.policy.section).includes(
        routingCase.policy.anchor,
      ),
      `${routingCase.id}: policy anchor does not resolve`,
    );
    assertDecisionSequence(routingCase.expected, `${routingCase.id}.expected`);

    if (routingCase.type === "ambiguous") {
      assert.ok(
        routingCase.acceptable.length > 0,
        `${routingCase.id}: missing lenient alternative`,
      );
      assert.match(routingCase.note, /documented policy overlap/u);
    } else {
      assert.deepEqual(routingCase.acceptable, [], routingCase.id);
    }
    for (const [
      alternativeIndex,
      alternative,
    ] of routingCase.acceptable.entries()) {
      assertDecisionSequence(
        alternative,
        `${routingCase.id}.acceptable[${alternativeIndex}]`,
      );
      assert.notDeepEqual(alternative, routingCase.expected, routingCase.id);
    }
  }
}

describe("dispatcher routing fixture contract", () => {
  it("keeps the minimum corpus source-grounded and structurally deterministic", () => {
    assertCorpusIntegrity();
  });

  it("reconciles every live Route Map row and terminal kind", () => {
    const liveIntents = [...new Set(liveRouteMapIntents())].sort();
    const coveredIntents = [
      ...new Set(
        ROUTING_CASES.filter(
          (routingCase) => routingCase.policy.section === "Route Map",
        ).map((routingCase) => routingCase.policy.anchor),
      ),
    ].sort();
    const observedNonSkillKinds = [
      ...new Set(
        expectedDecisions()
          .map((decision) => decision.kind)
          .filter((kind) => kind !== "skill"),
      ),
    ].sort();

    assert.deepEqual(coveredIntents, liveIntents);
    assert.deepEqual(observedNonSkillKinds, [...NON_SKILL_KINDS].sort());
  });

  it("covers every canonical destination while excluding the dispatcher", () => {
    const expectedTargets = [
      ...new Set(
        expectedDecisions()
          .filter((decision) => decision.kind === "skill")
          .map((decision) => decision.target),
      ),
    ].sort();

    assert.deepEqual(expectedTargets, [...CANONICAL_TARGETS].sort());
    assert.equal(expectedTargets.includes("goat"), false);
  });

  it("keeps pass-through, ordered multi-intent, and ambiguity explicit", () => {
    const passThroughCases = ROUTING_CASES.filter(
      (routingCase) => routingCase.policy.anchor === "EXPLICIT PASS-THROUGH",
    );
    const multiIntentCases = ROUTING_CASES.filter(
      (routingCase) =>
        routingCase.policy.anchor ===
        "MUST split multi-intent requests into numbered intents and route each",
    );
    const ambiguousCaseIds = ROUTING_CASES.filter(
      (routingCase) => routingCase.type === "ambiguous",
    )
      .map((routingCase) => routingCase.id)
      .sort();

    assert.equal(passThroughCases.length, 1);
    assert.match(passThroughCases[0].prompt, /^\/goat-/u);
    assert.equal(passThroughCases[0].expected.length, 1);
    assert.equal(multiIntentCases.length, 1);
    assert.ok(multiIntentCases[0].expected.length > 1);
    assert.deepEqual(ambiguousCaseIds, [
      "ambiguous-change-verification",
      "ambiguous-test-quality",
    ]);
  });
});
