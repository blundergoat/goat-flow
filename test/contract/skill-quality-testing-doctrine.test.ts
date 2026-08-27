/**
 * Locks capability-aware fixtures and outcome-based scoring across the shipped authoring pack.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  readMarkdownSection,
  readProjectFile,
} from "./skill-hardening.helpers.js";

const ROOT_GUIDES = [
  "workflow/skills/playbooks/skill-quality-testing.md",
  ".goat-flow/skill-docs/skill-quality-testing/README.md",
] as const;
const TDD_GUIDES = [
  "workflow/skills/playbooks/skill-quality-testing/tdd-iteration.md",
  ".goat-flow/skill-docs/skill-quality-testing/tdd-iteration.md",
] as const;
const ADVERSARIAL_GUIDES = [
  "workflow/skills/playbooks/skill-quality-testing/adversarial-framing.md",
  ".goat-flow/skill-docs/skill-quality-testing/adversarial-framing.md",
] as const;

/** Apply one section-scoped assertion to each canonical and installed guide. */
function assertForEachSection(
  guidePaths: readonly string[],
  sectionHeading: string,
  assertion: (section: string, guidePath: string) => void,
): void {
  for (const guidePath of guidePaths) {
    assertion(readMarkdownSection(guidePath, sectionHeading), guidePath);
  }
}

describe("skill-quality-testing evaluation doctrine", () => {
  it("routes universal capability and scoring rules through the root and TDD guide", () => {
    assertForEachSection(
      ROOT_GUIDES,
      "Evaluation contract",
      (section, guidePath) => {
        assert.match(section, /capability and risk/u, guidePath);
        assert.match(section, /already-correct control/u, guidePath);
        assert.match(section, /application, not citation/u, guidePath);
        assert.match(section, /`tdd-iteration\.md`/u, guidePath);
        assert.match(section, /review-class specialisation/u, guidePath);
      },
    );
  });

  it("protects compliant controls according to the skill capability", () => {
    assertForEachSection(
      TDD_GUIDES,
      "Capability-aware evaluation fixtures",
      (section, guidePath) => {
        assert.match(
          section,
          /names at least one already-correct control and its expected no-op/u,
          guidePath,
        );
        assert.match(
          section,
          /mutation-capable[\s\S]+byte-for-byte/u,
          guidePath,
        );
        assert.match(
          section,
          /report-only or decision[\s\S]+no false finding, recommendation, or action/u,
          guidePath,
        );
        assert.match(
          section,
          /Blanket rewriting and blanket reporting both fail/u,
          guidePath,
        );
      },
    );
  });

  it("grounds attractive wrong answers and scales pressure to actual risk", () => {
    assertForEachSection(
      TDD_GUIDES,
      "Capability-aware evaluation fixtures",
      (section, guidePath) => {
        assert.match(
          section,
          /observed RED or REFACTOR rationalisations[\s\S]+explicitly labelled fixture input/u,
          guidePath,
        );
        assert.match(
          section,
          /Invented pressure is never repository evidence/u,
          guidePath,
        );
        assert.match(section, /when the risk warrants it/u, guidePath);
        assert.match(
          section,
          /narrow transformation needs relevant evidence, not review-class ceremony/u,
          guidePath,
        );
      },
    );
  });

  it("scores observable application and diagnoses citation-only misses", () => {
    assertForEachSection(
      TDD_GUIDES,
      "Score application, not citation",
      (section, guidePath) => {
        assert.match(
          section,
          /required outcome passes only when the produced diff, decision, or report demonstrates it/u,
          guidePath,
        );
        assert.match(
          section,
          /citation never substitutes for the required outcome/u,
          guidePath,
        );
        assert.match(section, /explicitly tests traceability/u, guidePath);
        assert.match(section, /citation-without-application/u, guidePath);
        for (const cause of [
          "instruction clarity",
          "routing",
          "conflicting examples",
          "capability limits",
        ]) {
          assert.match(section, new RegExp(cause, "u"), guidePath);
        }
        assert.match(
          section,
          /does not establish a routing gap on its own/u,
          guidePath,
        );
      },
    );
  });

  it("scopes retirement and qualification to one reproducible target", () => {
    assertForEachSection(
      TDD_GUIDES,
      "Dispatch protocol",
      (section, guidePath) => {
        assert.match(
          section,
          /classify capability versus preference/u,
          guidePath,
        );
        assert.match(section, /repeated model-scoped ablations/u, guidePath);
        assert.match(
          section,
          /capability success applies only to the named provider\/model\/config/u,
          guidePath,
        );
        assert.match(
          section,
          /keep a preference while its convention remains/u,
          guidePath,
        );
        assert.match(
          section,
          /retain the corpus as a reintroduction guard/u,
          guidePath,
        );
        assert.match(
          section,
          /Qualification is target-specific, not source-release proof/u,
          guidePath,
        );
        assert.match(
          section,
          /provider\/model\/class, runner\/version, reasoning\/config, skill hash, trial count, runtime, and cost/u,
          guidePath,
        );
        assert.match(section, /use `unknown`, never infer/u, guidePath);
      },
    );
  });

  it("records TDD evidence at a repository-approved task location", () => {
    assertForEachSection(TDD_GUIDES, "Iteration log", (section, guidePath) => {
      assert.match(
        section,
        /repository-approved task evidence path/u,
        guidePath,
      );
      assert.match(section, /prefer active task state/u, guidePath);
      assert.match(section, /local redacted-log policy/u, guidePath);
      assert.match(
        section,
        /Run: <provider\/model\/class; runner\/version; reasoning\/config; skill hash; trial count; runtime; cost>/u,
        guidePath,
      );
      assert.doesNotMatch(section, /Write the TDD log as/u, guidePath);
    });
  });

  it("keeps review-class control handling as a specialisation", () => {
    assertForEachSection(
      ADVERSARIAL_GUIDES,
      "Review-class control handling",
      (section, guidePath) => {
        assert.match(section, /generic fixture and scoring rules/u, guidePath);
        assert.match(section, /`tdd-iteration\.md`/u, guidePath);
        assert.match(section, /compliant review control/u, guidePath);
        assert.match(section, /no finding or recommendation/u, guidePath);
        assert.match(section, /risk warrants combined pressures/u, guidePath);
      },
    );
  });

  it("keeps each canonical guide byte-identical to its installed copy", () => {
    for (const [canonicalPath, installedPath] of [
      [ROOT_GUIDES[0], ROOT_GUIDES[1]],
      [TDD_GUIDES[0], TDD_GUIDES[1]],
      [ADVERSARIAL_GUIDES[0], ADVERSARIAL_GUIDES[1]],
    ] as const) {
      assert.equal(
        readProjectFile(installedPath),
        readProjectFile(canonicalPath),
        installedPath,
      );
    }
  });
});
