/**
 * Registered history contracts through real project files and the CLI.
 * Synthetic timestamps isolate provenance and scope behavior; fixtures are never forecasting evidence.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  discoverPlanForecastHistory,
  selectPlanForecastHistory,
} from "../../src/cli/plans-forecast-history.js";
import { parseMilestoneMarkdown } from "../../src/cli/plans-export.js";
import {
  CLI_PATH,
  PROJECT_ROOT,
  eligibleWorkUnitSampleBody,
  registeredHistoryFixture,
  writeRegisteredHistory,
  historyRegistration,
  receiptStamp,
} from "./plans-check.helpers.js";

describe("plans check: bounded project history", () => {
  /** A real directory tree distinguishes the two admitted layers from nested scratch and archive content. */
  it("discovers direct and done plans with portable identities, without recursing other containers", () => {
    const root = mkdtempSync(join(tmpdir(), "goat-flow-history-"));
    try {
      const plans = join(root, ".goat-flow", "plans");
      for (const plan of [
        "selected",
        "sibling",
        "_done/old",
        "scratchpad/hidden",
        "archive/hidden",
        ".hidden",
        "_private",
        "sibling/nested",
        "_done/_done/nested",
      ]) {
        const directory = join(plans, plan);
        mkdirSync(directory, { recursive: true });
        writeFileSync(
          join(directory, "M01-work.md"),
          Buffer.concat([
            Buffer.from(eligibleWorkUnitSampleBody(23)),
            Buffer.from([0xff]),
          ]),
        );
      }
      const selected = join(plans, "selected");
      const history = discoverPlanForecastHistory(root, selected);
      assert.deepEqual(
        history.sources.map((source) => source.id),
        [
          ".goat-flow/plans/_done/old/M01-work.md",
          ".goat-flow/plans/selected/M01-work.md",
          ".goat-flow/plans/sibling/M01-work.md",
        ],
      );
      assert.ok(
        history.sources.every((source) =>
          /^[a-f0-9]{64}$/u.test(source.sha256),
        ),
      );
      for (const source of history.sources) {
        const bytes = readFileSync(join(root, source.id));
        assert.equal(
          source.sha256,
          createHash("sha256").update(bytes).digest("hex"),
        );
      }
      assert.equal(
        discoverPlanForecastHistory(null, selected).sources.length,
        0,
      );
      assert.equal(discoverPlanForecastHistory(root, root).sources.length, 0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  /** File and directory links exercise separate containment checks; EPERM skips only unsupported fixture setup. */
  it("excludes directory and milestone symlinks, including a selected plan that escapes", (t) => {
    const root = mkdtempSync(join(tmpdir(), "goat-flow-history-links-"));
    try {
      const plans = join(root, ".goat-flow", "plans");
      const selected = join(plans, "selected");
      const outside = join(root, "outside");
      mkdirSync(selected, { recursive: true });
      mkdirSync(outside);
      writeFileSync(
        join(outside, "M01-secret.md"),
        eligibleWorkUnitSampleBody(900),
      );
      try {
        symlinkSync(outside, join(plans, "escape"), "dir");
        symlinkSync(
          join(outside, "M01-secret.md"),
          join(selected, "M02-linked.md"),
          "file",
        );
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "EPERM") {
          t.skip(
            "Host blocks symlink fixture creation; containment runs on a capable host",
          );
          return;
        }
        throw error;
      }
      const history = discoverPlanForecastHistory(root, selected);
      assert.deepEqual(history.sources, []);
      assert.deepEqual(
        history.exclusions.map((entry) => entry.id),
        [".goat-flow/plans/escape", ".goat-flow/plans/selected/M02-linked.md"],
      );
      assert.equal(
        discoverPlanForecastHistory(root, join(plans, "escape")).root,
        null,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

/** Resolve tsx at the test owner so the CLI can be invoked from another project's working directory. */
function checkHistory(plan: string, cwd = PROJECT_ROOT) {
  return spawnSync(
    process.execPath,
    [
      "--import",
      import.meta.resolve("tsx"),
      CLI_PATH,
      "plans",
      "check",
      plan,
      "--strict",
    ],
    { cwd, encoding: "utf8" },
  );
}

/** Select through real parsing and bounded filesystem discovery, with no injected samples. */
function selectedHistory(
  root: string,
  target: ReturnType<typeof registeredHistoryFixture>,
) {
  const selected = join(root, ".goat-flow", "plans", "selected");
  writeRegisteredHistory(selected, target);
  return selectPlanForecastHistory(
    discoverPlanForecastHistory(root, selected),
    parseMilestoneMarkdown(target.body, "M01-work.md"),
  );
}

/** Two separated spans expose the exact residual cutoff: 11 prior seconds, then 12 forecast seconds in completed fixtures. */
function remainingHistoryFixture(start: number, isComplete = true) {
  const fixture = registeredHistoryFixture(start, 23, isComplete);
  const revision = {
    ...fixture.forecast,
    id: "F2",
    predecessorId: "F1",
    issuedAt: receiptStamp(start + 20).split(" / ")[0]!,
    scopeKind: "remaining" as const,
    receiptCutoff: { segmentId: "M01-S01", recordedSeconds: 11 },
  };
  const receipt = [
    "## Timing Receipt",
    "",
    `**Receipt state:** ${isComplete ? "finalized" : "paused"}`,
    ...(isComplete
      ? [
          "**Recorded seconds:** 23 total (11 product / 12 proof / 0 other)",
          "**Allocated minutes:** 0 total (0 product / 0 proof / 0 other)",
        ]
      : []),
    "",
    "| Segment | Category | Start UTC / epoch | End UTC / epoch | Seconds | State |",
    "|---|---|---|---|---:|---|",
    `| M01-S01 | product | ${receiptStamp(start)} | ${receiptStamp(start + 11)} | 11 | closed |`,
    ...(isComplete
      ? [
          `| M01-S02 | proof | ${receiptStamp(start + 30)} | ${receiptStamp(start + 42)} | 12 | closed |`,
        ]
      : []),
    "",
    "## Scope",
  ].join("\n");
  fixture.body = fixture.body.replace(
    JSON.stringify({ schemaVersion: 1, records: [fixture.forecast] }),
    JSON.stringify({ schemaVersion: 1, records: [fixture.forecast, revision] }),
  );
  fixture.body = isComplete
    ? fixture.body.replace(/## Timing Receipt[\s\S]*?## Scope/u, receipt)
    : fixture.body
        .replace("## Scope", receipt)
        .replace("Status: not-started", "Status: in-progress");
  fixture.registration.forecasts.push(historyRegistration(revision));
  return fixture;
}

describe("plans check: registered history selection", () => {
  it("requires registration before the first work second, even when the snapshot was issued earlier", (t) => {
    const root = mkdtempSync(join(tmpdir(), "goat-history-equal-start-"));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const fixture = registeredHistoryFixture(100);
    fixture.registration.forecasts[0]!.registeredAt =
      receiptStamp(100).split(" / ")[0]!;
    writeRegisteredHistory(join(root, ".goat-flow/plans/equal-start"), fixture);
    const selected = selectedHistory(
      root,
      registeredHistoryFixture(1000, 23, false),
    );
    assert.equal(selected.samples.length, 0);
    assert.match(
      selected.exclusions.map((entry) => entry.reason).join("\n"),
      /registration/u,
    );
  });

  it("preserves whole-work samples after completion but excludes cancelled scope", (t) => {
    const root = mkdtempSync(join(tmpdir(), "goat-history-removed-scope-"));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    for (const [name, start] of [
      ["completed", 100],
      ["cancelled", 200],
    ] as const) {
      const fixture = remainingHistoryFixture(start);
      const document = {
        schemaVersion: 1,
        records: fixture.registration.forecasts.map((entry) => entry.forecast),
      };
      const revision = structuredClone(document.records[1]!);
      revision.items = revision.items.filter((item) => item.id !== "T1");
      revision.scopeDelta = { added: [], removed: ["T1"] };
      revision.basis.agentWorkUnits = 2;
      revision.range = { lowMinutes: 1, likelyMinutes: 6, highMinutes: 20 };
      fixture.body = fixture.body.replace(
        JSON.stringify(document),
        JSON.stringify({ ...document, records: [fixture.forecast, revision] }),
      );
      fixture.registration.forecasts[1] = historyRegistration(revision);
      if (name === "cancelled")
        fixture.body = fixture.body.replace(
          /^- \[x\] Build the thing.*\n/mu,
          "",
        );
      const parsed = parseMilestoneMarkdown(fixture.body, "M01-work.md");
      assert.equal(
        parsed.forecastContext?.method,
        "contextual-v1",
        parsed.warnings.join("\n"),
      );
      writeRegisteredHistory(join(root, ".goat-flow/plans", name), fixture);
    }
    const selected = selectedHistory(
      root,
      registeredHistoryFixture(1000, 23, false),
    );
    assert.equal(selected.samples.length, 1);
    assert.match(
      selected.exclusions.find((entry) => entry.id.includes("cancelled"))
        ?.reason ?? "",
      /whole-work scope was removed/u,
    );
  });
  /** Whole and remaining forecasts share files but never share outcome denominators or the consumed receipt prefix. */
  it("matches remaining scope to registered revisions and counts only seconds after their closed cutoff", () => {
    const root = mkdtempSync(join(tmpdir(), "goat-flow-history-remaining-"));
    try {
      const plans = join(root, ".goat-flow", "plans");
      for (const start of [100, 200, 300])
        writeRegisteredHistory(
          join(plans, `remaining-${start}`),
          remainingHistoryFixture(start),
        );
      writeRegisteredHistory(
        join(plans, "whole-only"),
        registeredHistoryFixture(400),
      );
      const target = remainingHistoryFixture(1000, false);
      const selected = selectedHistory(root, target);
      assert.equal(selected.selection, "context-matched");
      assert.equal(selected.samples.length, 3);
      assert.ok(
        selected.samples.every(
          (sample) =>
            sample.forecastId === "F2" &&
            sample.measuredSeconds === 12 &&
            sample.agentWorkUnits === 3,
        ),
      );
      assert.match(
        selected.exclusions.find((entry) => entry.id.includes("whole-only"))!
          .reason,
        /requested scope/u,
      );
      const checked = checkHistory(join(plans, "selected"));
      assert.equal(checked.status, 0, checked.stdout + checked.stderr);
      assert.match(checked.stdout, /12s \/ 3 units/u);
      const late = remainingHistoryFixture(500);
      late.registration.forecasts[1]!.registeredAt =
        receiptStamp(531).split(" / ")[0]!;
      writeRegisteredHistory(join(plans, "late-revision"), late);
      const again = selectedHistory(root, target);
      assert.equal(again.samples.length, 3);
      assert.match(
        again.exclusions.find((entry) => entry.id.includes("late-revision"))!
          .reason,
        /late/u,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  /** Even matching frozen bytes outside the plan cannot enter through a linked evaluation directory or registration file. */
  it("keeps symlinked registrations diagnostic-only", (t) => {
    const root = mkdtempSync(
      join(tmpdir(), "goat-flow-history-registration-links-"),
    );
    try {
      const plans = join(root, ".goat-flow", "plans");
      const outside = join(root, "outside");
      mkdirSync(outside);
      for (const [index, kind] of ["directory", "file"].entries()) {
        const fixture = registeredHistoryFixture(100 + index * 100);
        const directory = join(plans, kind);
        mkdirSync(directory, { recursive: true });
        writeFileSync(join(directory, "M01-work.md"), fixture.body);
        writeFileSync(
          join(outside, "prospective-registration.json"),
          JSON.stringify(fixture.registration),
        );
        try {
          if (kind === "directory")
            symlinkSync(outside, join(directory, "evaluation"), "dir");
          else {
            mkdirSync(join(directory, "evaluation"));
            symlinkSync(
              join(outside, "prospective-registration.json"),
              join(directory, "evaluation", "prospective-registration.json"),
              "file",
            );
          }
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === "EPERM") {
            t.skip(
              "Host blocks symlink fixture creation; containment runs on a capable host",
            );
            return;
          }
          throw error;
        }
      }
      const selected = selectedHistory(
        root,
        registeredHistoryFixture(1000, 23, false),
      );
      assert.equal(selected.intactCount, 2);
      assert.equal(selected.samples.length, 0);
      assert.equal(
        selected.exclusions.filter((entry) =>
          /registration/u.test(entry.reason),
        ).length,
        2,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
  /** Two projects and an external operand prove cwd independence, selected-only totals and read-only history through the CLI. */
  it("reuses three short sibling receipts for a fresh plan from either working directory and preserves legacy advice", () => {
    const root = mkdtempSync(join(tmpdir(), "goat-flow-history-cli-"));
    try {
      const project = join(root, "owner");
      const other = join(root, "other");
      const plans = join(project, ".goat-flow", "plans");
      const target = registeredHistoryFixture(1000, 23, false);
      const selected = writeRegisteredHistory(join(plans, "selected"), target);
      const before = checkHistory(selected);
      assert.equal(before.status, 0, before.stdout + before.stderr);
      const sources: string[] = [];
      for (const [index, seconds] of [23, 20, 27].entries()) {
        const directory = writeRegisteredHistory(
          join(plans, index === 2 ? "_done/old" : `sibling-${index}`),
          registeredHistoryFixture(100 + index * 100, seconds),
        );
        sources.push(
          join(directory, "M01-work.md"),
          join(directory, "evaluation", "prospective-registration.json"),
        );
        writeRegisteredHistory(
          join(other, ".goat-flow", "plans", `foreign-${index}`),
          registeredHistoryFixture(100 + index * 100, 60),
        );
      }
      const bytes = sources.map((path) => readFileSync(path));
      const fromOwner = checkHistory(selected, project);
      const fromOther = checkHistory(selected, other);
      assert.equal(fromOwner.status, 0, fromOwner.stdout + fromOwner.stderr);
      assert.equal(fromOther.stdout, fromOwner.stdout);
      assert.match(
        fromOwner.stdout,
        /pool context-matched; 3 matched samples/u,
      );
      assert.match(fromOwner.stdout, /23s \/ 3 units/u);
      assert.match(fromOwner.stdout, /20s \/ 3 units/u);
      assert.match(fromOwner.stdout, /27s \/ 3 units/u);
      assert.doesNotMatch(fromOwner.stdout, /foreign-|error:/u);
      assert.equal(
        fromOwner.stdout.split("history selection:")[0],
        before.stdout.split("history selection:")[0],
      );
      assert.ok(
        sources.every((path, index) =>
          readFileSync(path).equals(bytes[index]!),
        ),
      );
      const history = discoverPlanForecastHistory(project, selected);
      for (const source of history.sources)
        assert.equal(
          source.sha256,
          createHash("sha256")
            .update(readFileSync(join(project, source.id)))
            .digest("hex"),
        );
      const external = writeRegisteredHistory(join(root, "external"), target);
      const fallback = checkHistory(external, other);
      assert.equal(fallback.status, 0, fallback.stdout + fallback.stderr);
      assert.match(
        fallback.stdout,
        /pool selected-plan; 0 matched samples.*no canonical project history/u,
      );
      assert.doesNotMatch(fallback.stdout, /history sample:/u);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  /** Each incompatible source has a distinct receipt, preventing duplicate handling from hiding the compatibility reason. */
  it("keeps unknown state, other work classes, other rubrics and tied or future completions out of matching", () => {
    const root = mkdtempSync(join(tmpdir(), "goat-flow-history-context-"));
    try {
      const plans = join(root, ".goat-flow", "plans");
      for (const [index, context] of [
        {},
        { workState: "unknown" },
        { workState: "reconciliation" },
        { workState: "verification-only" },
        { unitRubric: "legacy-checkbox-v1" },
      ].entries()) {
        writeRegisteredHistory(
          join(plans, `case-${index}`),
          registeredHistoryFixture(
            100 + index * 100,
            23,
            true,
            context as Parameters<typeof registeredHistoryFixture>[3],
          ),
        );
      }
      writeRegisteredHistory(
        join(plans, "tied"),
        registeredHistoryFixture(900, 90),
      );
      writeRegisteredHistory(
        join(plans, "future"),
        registeredHistoryFixture(1000, 23),
      );
      const selected = selectedHistory(
        root,
        registeredHistoryFixture(1000, 23, false),
      );
      assert.equal(selected.selection, "selected-plan");
      assert.deepEqual(
        selected.samples.map((sample) => sample.id),
        [".goat-flow/plans/case-0/M01-work.md"],
      );
      assert.equal(
        selected.exclusions.filter((entry) => /work state/u.test(entry.reason))
          .length,
        3,
      );
      assert.equal(
        selected.exclusions.filter((entry) => /unit rubric/u.test(entry.reason))
          .length,
        1,
      );
      assert.equal(
        selected.exclusions.filter((entry) =>
          /strictly before/u.test(entry.reason),
        ).length,
        2,
      );
      const unknown = selectedHistory(
        root,
        registeredHistoryFixture(1000, 23, false, { workState: "unknown" }),
      );
      assert.equal(unknown.samples.length, 0);
      assert.match(unknown.reason, /target work state is unknown/u);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  /** Mutations model invalid author-provided registrations; only the unchanged independently hashed snapshot remains eligible. */
  it("excludes missing, malformed, conflicting, late and drifted registrations without failing the selected plan", () => {
    const root = mkdtempSync(join(tmpdir(), "goat-flow-history-registration-"));
    try {
      const plans = join(root, ".goat-flow", "plans");
      const mutations = [
        (fixture: ReturnType<typeof registeredHistoryFixture>) =>
          fixture.registration,
        () => null,
        () => ({ schemaVersion: 2, forecasts: [] }),
        (fixture: ReturnType<typeof registeredHistoryFixture>) => ({
          ...fixture.registration,
          forecasts: [
            fixture.registration.forecasts[0],
            fixture.registration.forecasts[0],
          ],
        }),
        (fixture: ReturnType<typeof registeredHistoryFixture>) => ({
          schemaVersion: 1,
          forecasts: [
            {
              ...fixture.registration.forecasts[0],
              registeredAt: receiptStamp(2000).split(" / ")[0],
            },
          ],
        }),
        (fixture: ReturnType<typeof registeredHistoryFixture>) => ({
          schemaVersion: 1,
          forecasts: [
            { ...fixture.registration.forecasts[0], sha256: "0".repeat(64) },
          ],
        }),
        (fixture: ReturnType<typeof registeredHistoryFixture>) => ({
          schemaVersion: 1,
          forecasts: [
            {
              ...fixture.registration.forecasts[0],
              forecast: { ...fixture.forecast, workState: "reconciliation" },
            },
          ],
        }),
        (fixture: ReturnType<typeof registeredHistoryFixture>) => ({
          schemaVersion: 1,
          forecasts: [
            { ...fixture.registration.forecasts[0], milestone: "M99-other.md" },
          ],
        }),
      ];
      for (const [index, mutate] of mutations.entries()) {
        const fixture = registeredHistoryFixture(100 + index * 100);
        const directory = writeRegisteredHistory(
          join(plans, `case-${index}`),
          fixture,
        );
        writeFileSync(
          join(directory, "evaluation", "prospective-registration.json"),
          JSON.stringify(mutate(fixture)),
        );
      }
      const malformed = writeRegisteredHistory(
        join(plans, "malformed"),
        registeredHistoryFixture(1200),
      );
      writeFileSync(
        join(malformed, "evaluation", "prospective-registration.json"),
        "{broken",
      );
      const selected = selectedHistory(
        root,
        registeredHistoryFixture(5000, 23, false),
      );
      assert.deepEqual(
        selected.samples.map((sample) => sample.id),
        [".goat-flow/plans/case-0/M01-work.md"],
      );
      assert.equal(
        selected.exclusions.filter((entry) =>
          /registration/u.test(entry.reason),
        ).length,
        8,
      );
      const checked = checkHistory(join(plans, "selected"));
      assert.equal(checked.status, 0, checked.stdout + checked.stderr);
      assert.doesNotMatch(checked.stdout, /error:/u);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  /** Copied spans and explicit identities represent the same work; independently timed equal-duration observations remain distinct. */
  it("deduplicates shared receipt provenance and excludes every conflicting copy deterministically", () => {
    const root = mkdtempSync(join(tmpdir(), "goat-flow-history-copies-"));
    try {
      const plans = join(root, ".goat-flow", "plans");
      const first = registeredHistoryFixture(100);
      first.registration.forecasts = [
        historyRegistration(first.forecast, "shared-receipt"),
      ];
      writeRegisteredHistory(join(plans, "a"), first);
      writeRegisteredHistory(join(plans, "b"), registeredHistoryFixture(200));
      writeRegisteredHistory(join(plans, "c"), registeredHistoryFixture(300));
      writeRegisteredHistory(join(plans, "copy"), first);
      writeRegisteredHistory(join(plans, "relabeled"), {
        ...first,
        body: first.body.replaceAll("M01-S01", "M01-S99"),
      });
      const target = registeredHistoryFixture(1000, 23, false);
      const selected = selectedHistory(root, target);
      assert.equal(selected.samples.length, 3);
      assert.equal(
        selected.exclusions.filter((entry) =>
          /duplicate receipt/u.test(entry.reason),
        ).length,
        2,
      );
      writeRegisteredHistory(
        join(plans, "conflict"),
        registeredHistoryFixture(200, 23, true, {
          workState: "reconciliation",
        }),
      );
      const conflicted = selectedHistory(root, target);
      assert.equal(conflicted.selection, "selected-plan");
      assert.equal(conflicted.samples.length, 2);
      assert.deepEqual(
        conflicted.exclusions
          .filter((entry) => /conflicting metadata/u.test(entry.reason))
          .map((entry) => entry.id),
        [
          ".goat-flow/plans/b/M01-work.md",
          ".goat-flow/plans/conflict/M01-work.md",
        ],
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  /** Damaged receipt and basis variants keep their own diagnostics while a valid short receipt remains usable. */
  it("rejects malformed finalized claims, mismatched seconds and invalid units without importing lifecycle errors", () => {
    const root = mkdtempSync(join(tmpdir(), "goat-flow-history-integrity-"));
    try {
      const plans = join(root, ".goat-flow", "plans");
      const mutations = [
        (body: string) => body,
        (body: string) =>
          body.replace("Receipt state:** finalized", "Receipt state:** paused"),
        (body: string) =>
          body.replace("23 total (23 product", "24 total (23 product"),
        (body: string) =>
          body.replace("receipt 23 recorded", "receipt 24 recorded"),
        (body: string) =>
          body.replace("Forecast basis: 3 agent", "Forecast basis: 4 agent"),
        (body: string) =>
          body.replace("Status: complete", "Status: testing-gate"),
        (body: string) =>
          body.replace("Actual: measured:", "Actual: retrospective:"),
      ];
      for (const [index, mutate] of mutations.entries()) {
        const fixture = registeredHistoryFixture(100 + index * 100);
        writeRegisteredHistory(join(plans, `case-${index}`), {
          ...fixture,
          body: mutate(fixture.body),
        });
      }
      const unreadable = join(plans, "unreadable", "M01-directory.md");
      mkdirSync(unreadable, { recursive: true });
      const selected = selectedHistory(
        root,
        registeredHistoryFixture(2000, 23, false),
      );
      assert.deepEqual(
        selected.samples.map((sample) => sample.id),
        [".goat-flow/plans/case-0/M01-work.md"],
      );
      assert.equal(selected.samples[0]!.measuredSeconds, 23);
      assert.equal(selected.exclusions.length, 8);
      assert.match(
        selected.exclusions.find((entry) =>
          entry.id.endsWith("M01-directory.md"),
        )!.reason,
        /not a real contained file/u,
      );
      const checked = checkHistory(join(plans, "selected"));
      assert.equal(checked.status, 0, checked.stdout + checked.stderr);
      assert.doesNotMatch(checked.stdout, /error:/u);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
