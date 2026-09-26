/**
 * Check how skill-authoring guides select fixtures, score outcomes, and interpret pressure-test evidence.
 *
 * Canonical and installed copies must preserve capability limits and avoid claiming more than the observed trials establish.
 * Use these contracts when changing authoring tests, evidence requirements, or deployment guidance.
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
const DEPLOYMENT_GUIDES = [
  "workflow/skills/playbooks/skill-quality-testing/deployment.md",
  ".goat-flow/skill-docs/skill-quality-testing/deployment.md",
] as const;

// Apply one section-scoped assertion to each canonical and installed guide.
function assertForEachSection(
  guidePaths: readonly string[],
  sectionHeading: string,
  assertion: (section: string, guidePath: string) => void,
): void {
  // Check the requested section in every guide so another copy cannot conceal missing authoring instructions.
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
        // Outcome-scoring guidance must consider each documented cause before treating a missing citation as failed skill use.
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
    // Every installed authoring guide must match its canonical source so users receive the same testing rules.
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

  it("scopes three-pass pressure evidence without broad robustness claims", () => {
    // None of the authoring or deployment guides may turn bounded pressure evidence into an unlimited reliability claim.
    for (const guidePath of [
      ...ROOT_GUIDES,
      ...TDD_GUIDES,
      ...ADVERSARIAL_GUIDES,
      ...DEPLOYMENT_GUIDES,
    ]) {
      const content = readProjectFile(guidePath);
      assert.doesNotMatch(content, /\bbulletproof(?:ing)?\b/iu, guidePath);
    }

    // Pressure-test claims must name the failure class and provider settings that the observed trials actually covered.
    for (const guidePath of [...TDD_GUIDES, ...DEPLOYMENT_GUIDES]) {
      assert.match(
        readProjectFile(guidePath),
        /three-pass pressure evidence[\s\S]+named failure class[\s\S]+provider\/model\/config/iu,
        guidePath,
      );
    }
  });

  it("treats mixed RED trials as evidence instead of forcing a failure", () => {
    // Both TDD guides must accept mixed outcomes as evidence instead of escalating pressure until a desired failure appears.
    for (const guidePath of TDD_GUIDES) {
      const content = readProjectFile(guidePath);
      assert.match(content, /pre-register[^\n]+trial count/iu, guidePath);
      assert.match(content, /mixed results are evidence/iu, guidePath);
      assert.match(
        content,
        /Do not add pressure solely to force a failure/u,
        guidePath,
      );
      assert.doesNotMatch(
        content,
        /If second subagent complies, the scenario is too weak[^\n]+add pressure/u,
        guidePath,
      );
    }
  });

  it("uses the published persuasion study without claiming skill validation", () => {
    // Study citations must preserve the published figures and state that the study does not validate this particular skill.
    for (const guidePath of TDD_GUIDES) {
      const content = readProjectFile(guidePath);
      assert.match(content, /Meincke et al\. \(2026\)/u, guidePath);
      assert.match(content, /N=126,000/u, guidePath);
      assert.match(content, /35\.3%[^\n]+51\.3%/u, guidePath);
      assert.match(content, /does not validate a specific skill/u, guidePath);
      assert.doesNotMatch(content, /N=28,000|33%[^\n]+72%/u, guidePath);
    }
  });

  it("keeps review pressure skeptical and permits supported zero-finding results", () => {
    // Adversarial review guidance must permit a supported zero-finding outcome so agents do not invent defects.
    for (const guidePath of ADVERSARIAL_GUIDES) {
      const content = readProjectFile(guidePath);
      assert.match(content, /skeptical, neutral reviewer/u, guidePath);
      assert.match(content, /coverage ledger/u, guidePath);
      assert.doesNotMatch(
        content,
        /cynical reviewer|expect to find problems|zero-findings HALT/iu,
        guidePath,
      );
    }
  });
});
