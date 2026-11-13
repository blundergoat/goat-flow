/** Check preset visibility and badges through the real dashboard readers and helpers. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { createContext, runInContext } from "node:vm";
import { ScriptTarget, transpileModule } from "typescript";

type PresetRow = { id: string };
type PresetRuntime = ReturnType<typeof createContext> & {
  /** Decode one shipped catalog row using the browser reader. */
  readPreset(raw: unknown): PresetRow | null;
  /** Return the cards a user can browse on the Prompts screen. */
  dashboardBrowsablePresets(state: {
    presets: PresetRow[];
    customPrompts: unknown[];
  }): PresetRow[];
  /** Return the visible compatibility badges for one card. */
  dashboardPresetBadges(preset: PresetRow): Array<{ label: string }>;
};

it("keeps quality workflows out of browsing while retaining their Quality badges", () => {
  const runtime = createContext({
    URL,
    window: { location: { href: "http://localhost/" } },
  }) as PresetRuntime;
  const source = [
    "dashboard-readers.ts",
    "dashboard-model-readers.ts",
    "dashboard-custom-prompts.ts",
    "dashboard-prompts.ts",
  ]
    .map((file) =>
      readFileSync(
        new URL(`../../src/dashboard/${file}`, import.meta.url),
        "utf8",
      ),
    )
    .join("\n");
  runInContext(
    transpileModule(source, {
      compilerOptions: { target: ScriptTarget.ES2023 },
    }).outputText,
    runtime,
  );
  const catalog: unknown[] = JSON.parse(
    readFileSync(
      new URL("../../src/dashboard/preset-prompts.json", import.meta.url),
      "utf8",
    ),
  );
  const presets = catalog.map((raw) => {
    const preset = runtime.readPreset(raw);
    assert.ok(preset, "every shipped preset must decode");
    return preset;
  });
  const visibleIds = new Set(
    runtime
      .dashboardBrowsablePresets({ presets, customPrompts: [] })
      .map((p) => p.id),
  );

  for (const id of ["skill-quality-test", "quality-check-goatflow"]) {
    const preset = presets.find((row) => row.id === id);
    assert.ok(preset, `${id} must remain in the shipped catalog`);
    assert.equal(visibleIds.has(id), false, `${id} must stay out of browsing`);
    const withoutInternalFlag = { ...preset, internalOnly: false };
    assert.equal(
      runtime.dashboardBrowsablePresets({
        presets: [withoutInternalFlag],
        customPrompts: [],
      }).length,
      0,
      `${id} must stay hidden independently of the Internal flag`,
    );
    assert.ok(
      runtime
        .dashboardPresetBadges(preset)
        .some((badge) => badge.label === "Quality"),
      `${id} must retain its Quality badge`,
    );
  }

  const ordinary = presets.find((row) => row.id === "error");
  assert.ok(ordinary);
  assert.equal(
    visibleIds.has(ordinary.id),
    true,
    "ordinary presets remain browsable",
  );
  assert.equal(
    runtime
      .dashboardPresetBadges(ordinary)
      .some((badge) => badge.label === "Quality"),
    false,
    "ordinary presets do not gain a Quality badge",
  );
});
