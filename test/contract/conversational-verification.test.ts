import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

interface Preset {
  id: string;
  name: string;
  desc: string;
  prompt: string;
  cat: string;
}

const PRESETS_PATH = join(
  import.meta.dirname,
  "..",
  "..",
  "src",
  "dashboard",
  "preset-prompts.js",
);

function loadPresets(): Preset[] {
  const content = readFileSync(PRESETS_PATH, "utf-8");
  return eval(content + "; PRESETS") as Preset[];
}

describe("Dashboard presets have valid structure", () => {
  const presets = loadPresets();

  it("all presets have required fields", () => {
    for (const preset of presets) {
      assert.ok(preset.id, `Preset missing id`);
      assert.ok(preset.name, `${preset.id}: missing name`);
      assert.ok(preset.prompt, `${preset.id}: missing prompt`);
      assert.ok(preset.cat, `${preset.id}: missing cat`);
    }
  });

  it("no duplicate preset IDs", () => {
    const ids = presets.map((p) => p.id);
    const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
    assert.equal(dupes.length, 0, `Duplicate IDs: ${dupes.join(", ")}`);
  });
});
