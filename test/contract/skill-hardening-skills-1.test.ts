/**
 * Check the dispatcher and user-invoked workflows covered by the shared skill contracts.
 *
 * These contracts inspect canonical and installed guidance so supported agents apply the same mode and evidence rules.
 * Use them when changing workflow routing, behavior, or required output.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  assertForEachTarget,
  installedSkillPaths,
  installedSkillReferencePaths,
  readMarkdownSection,
  readProjectFile,
  INSTALLED_SKILL_ROOTS,
} from "./skill-hardening.helpers.js";

// Users can finish goat-qa through five output variants, and each one must show what the agent disproved.
const GOAT_QA_FINAL_OUTPUT_VARIANT_COUNT = 5;

describe("skill hardening contracts: debug, qa, critique, security, dispatcher (1/2)", () => {
  it("keeps goat-debug bisect reporting-only until explicit approval", () => {
    // Example: a user asks for a regression diagnosis while unrelated edits remain open.
    assertForEachTarget(installedSkillPaths("goat-debug"), (skillPath) => {
      const skillGuidance = readProjectFile(skillPath);
      assert.match(
        skillGuidance,
        /Bisect is never required for a reporting-only diagnosis/,
        skillPath,
      );
      assert.match(skillGuidance, /clean worktree/, skillPath);
      assert.match(skillGuidance, /known-good and known-bad refs/, skillPath);
      assert.match(
        skillGuidance,
        /deterministic, non-destructive predicate/,
        skillPath,
      );
      assert.match(
        skillGuidance,
        /explicit current-session approval/,
        skillPath,
      );
      assert.match(skillGuidance, /`git bisect reset`/, skillPath);
      assert.match(
        skillGuidance,
        /success, error, cancellation, or interruption/,
        skillPath,
      );
    });
  });

  it("keeps goat-debug lifecycle gates explicit and conditional", () => {
    assertForEachTarget(installedSkillPaths("goat-debug"), (skillPath) => {
      const skillGuidance = readProjectFile(skillPath);

      assert.match(
        skillGuidance,
        /If a Quick diagnosis leads to a fix request, promote to Full at the D2 gate; do not skip either approval\./u,
        skillPath,
      );
      assert.match(
        skillGuidance,
        /Full diagnosis-only may stop at D2/u,
        skillPath,
      );
      assert.match(
        skillGuidance,
        /Approval to write D3 authorizes planning only, not implementation\./u,
        skillPath,
      );
      assert.match(
        skillGuidance,
        /Present the fix plan, then pause.*Implement only after explicit approval/u,
        skillPath,
      );
      assert.match(
        skillGuidance,
        /### D4 - Post-Fix Verification \(only after approved implementation\)/u,
        skillPath,
      );
      assert.doesNotMatch(
        skillGuidance,
        /\*\*Full path:\*\* run D1.D1\.5.D2.D3.D4/u,
        `${skillPath}: Full must be gated rather than a linear phase list`,
      );
    });
  });

  it("requires a hit or miss for every goat-debug footgun retrieval", () => {
    assertForEachTarget(installedSkillPaths("goat-debug"), (skillPath) => {
      const retrievalLines = readProjectFile(skillPath)
        .split(/\r?\n/u)
        .filter((line) => line.includes("Footgun retrieval:"));

      assert.equal(retrievalLines.length, 2, skillPath);
      assert.match(retrievalLines[0] ?? "", /hit.*miss/u, skillPath);
      assert.doesNotMatch(retrievalLines[0] ?? "", /\bskip\b/u, skillPath);
      assert.match(retrievalLines[1] ?? "", /hit.*miss/u, skillPath);
      assert.doesNotMatch(retrievalLines[1] ?? "", /\bskip\b/u, skillPath);
    });
  });

  // The debug closure step must require cleanup and the original reproduction before an agent declares the reported bug fixed.

  it("closes goat-debug only on the original reproduction with diagnostics cleaned", () => {
    assertForEachTarget(installedSkillPaths("goat-debug"), (skillPath) => {
      const skillGuidance = readProjectFile(skillPath);

      assert.match(
        skillGuidance,
        /Rerun the \*\*original, unminimized reproduction\*\* from D2/u,
        skillPath,
      );
      assert.match(skillGuidance, /a minimised case proves less/u, skillPath);
      assert.match(
        skillGuidance,
        /Do not close while any approved diagnostic mutation from D1 remains uncleaned/u,
        skillPath,
      );
      assert.match(
        skillGuidance,
        /user-owned diagnostics are never removed without permission/u,
        skillPath,
      );
    });
  });

  it("separates symptom reproduction from goat-debug causal confidence", () => {
    assertForEachTarget(installedSkillPaths("goat-debug"), (skillPath) => {
      const skillGuidance = readProjectFile(skillPath);

      assert.match(
        skillGuidance,
        /Symptom reproduction is not root-cause proof\./u,
        skillPath,
      );
      assert.match(
        skillGuidance,
        /HIGH requires a traced mechanism plus a distinguishing counterfactual or intervention, or deterministic proof that entails the symptom\./u,
        skillPath,
      );
      assert.match(skillGuidance, /Causation/u, skillPath);
      assert.match(skillGuidance, /Necessity/u, skillPath);
      assert.match(skillGuidance, /Sufficiency/u, skillPath);
      assert.doesNotMatch(skillGuidance, /HIGH = reproduced/u, skillPath);
    });
  });

  it("applies repository authority to goat-debug diagnostic mutations", () => {
    assertForEachTarget(installedSkillPaths("goat-debug"), (skillPath) => {
      const skillGuidance = readProjectFile(skillPath);

      assert.match(
        skillGuidance,
        /Read-only observation may proceed within repository rules/u,
        skillPath,
      );
      assert.match(
        skillGuidance,
        /source, configuration, local state, network, production, or sensitive data/u,
        skillPath,
      );
      assert.match(
        skillGuidance,
        /target, expected signal, affected state, rollback, and a cleanup marker/u,
        skillPath,
      );
      assert.match(
        skillGuidance,
        /wait for explicit current-session approval/u,
        skillPath,
      );
      assert.match(
        skillGuidance,
        /Incomplete cleanup blocks a fixed claim/u,
        skillPath,
      );
    });
  });

  it("keeps goat-debug evidence states honest without burdening Investigate", () => {
    assertForEachTarget(installedSkillPaths("goat-debug"), (skillPath) => {
      const skillGuidance = readProjectFile(skillPath);
      const investigateMode = readMarkdownSection(
        skillPath,
        "Investigate Mode",
      );

      // Debug guidance must distinguish observed facts, inferences, unverified claims, and evidence awaiting human action.
      for (const evidenceState of [
        "OBSERVED",
        "INFERRED",
        "UNVERIFIED",
        "HUMAN-PENDING",
      ]) {
        assert.match(skillGuidance, new RegExp(evidenceState), skillPath);
      }
      assert.match(
        skillGuidance,
        /Omit D3, D4, UI, and diagnostic-mutation fields when they are not applicable\./u,
        skillPath,
      );
      assert.match(
        investigateMode,
        /Investigate mode does not require reproduction, bug hypotheses, minimisation, or causal proof\./u,
        skillPath,
      );
    });
  });

  // A code tour can use Investigate without a bug report; diagnosis-only requirements must stay outside that path.
  it("scopes goat-debug diagnosis requirements away from Investigate mode", () => {
    assertForEachTarget(installedSkillPaths("goat-debug"), (skillPath) => {
      const boundaryCommands = readMarkdownSection(
        skillPath,
        "Boundary Commands",
      );
      const constraints = readMarkdownSection(skillPath, "Constraints");

      assert.match(
        boundaryCommands,
        /\*\*ALWAYS in Diagnose mode:\*\* Trace the live path, test competing hypothesis categories, and state the reproduction and evidence limits\./u,
        skillPath,
      );
      assert.match(
        constraints,
        /Diagnose mode MUST write hypotheses AFTER initial read of the primary file/u,
        skillPath,
      );
      assert.match(
        constraints,
        /Diagnose mode MUST include at least 2 hypothesis categories/u,
        skillPath,
      );
      assert.match(
        constraints,
        /Diagnose mode MUST run D1\.5 reduction before D2 or evidence a minimal, not-applicable, or unsafe disposition/u,
        skillPath,
      );
      assert.doesNotMatch(
        boundaryCommands,
        /\*\*ALWAYS:\*\* Trace the live path, test competing hypothesis categories/u,
        skillPath,
      );
      assert.doesNotMatch(
        constraints,
        /^- MUST (?:write hypotheses|include at least 2 hypothesis categories|run D1\.5 reduction)/mu,
        skillPath,
      );
    });
  });

  it("keeps goat-debug ADJUSTED disposition countable in its root output", () => {
    assertForEachTarget(installedSkillPaths("goat-debug"), (skillPath) => {
      const skillGuidance = readProjectFile(skillPath);
      assert.match(
        skillGuidance,
        /mark each: CONFIRMED \/ ADJUSTED \/ ELIMINATED \/ UNRESOLVED/u,
        skillPath,
      );
      assert.match(
        skillGuidance,
        /Hypotheses tested:\*\* count \(CONFIRMED \+ ADJUSTED \+ ELIMINATED \+ UNRESOLVED\)/u,
        skillPath,
      );
      assert.match(
        skillGuidance,
        /CONFIRMED: \[n\] \/ ADJUSTED: \[n\] \/ ELIMINATED: \[n\] \/ UNRESOLVED: \[n\]/u,
        skillPath,
      );
    });
  });

  it("loads one manifest-owned goat-debug diagnostic reference", () => {
    const manifest = JSON.parse(readProjectFile("workflow/manifest.json")) as {
      skills?: { references?: Record<string, string[]> };
    };
    assert.deepEqual(manifest.skills?.references?.["goat-debug"], [
      "references/diagnostic-techniques.md",
    ]);

    assertForEachTarget(installedSkillPaths("goat-debug"), (skillPath) => {
      assert.match(
        readProjectFile(skillPath),
        /`references\/diagnostic-techniques\.md`/u,
        skillPath,
      );
    });

    assertForEachTarget(
      installedSkillReferencePaths(
        "goat-debug",
        "references/diagnostic-techniques.md",
      ),
      (referencePath) => {
        const referenceGuidance = readProjectFile(referencePath);
        assert.match(
          referenceGuidance,
          /Illustrative scenario - input\/output shape only; never evidence/u,
          referencePath,
        );
        // Reference files carry `reference-version`; `skill-version` is the SKILL.md key.
        // Asserting the wrong one here is what let this file drift out of version parity.
        assert.match(
          referenceGuidance,
          /goat-flow-reference-version: "1\.17\.0"/u,
          referencePath,
        );
      },
    );
  });

  it("selects goat-debug reduction by failure shape instead of universal binary search", () => {
    assertForEachTarget(installedSkillPaths("goat-debug"), (skillPath) => {
      assert.doesNotMatch(
        readProjectFile(skillPath),
        /Binary-search each variable/u,
        skillPath,
      );
    });

    assertForEachTarget(
      installedSkillReferencePaths(
        "goat-debug",
        "references/diagnostic-techniques.md",
      ),
      (referencePath) => {
        const referenceGuidance = readProjectFile(referencePath);
        assert.match(
          referenceGuidance,
          /Choose the reduction method that preserves the property required for the failure\./u,
          referencePath,
        );
        assert.match(
          referenceGuidance,
          /Deterministic unordered input/u,
          referencePath,
        );
        assert.match(
          referenceGuidance,
          /Ordered or stateful sequence/u,
          referencePath,
        );
        assert.match(
          referenceGuidance,
          /Interacting conditions/u,
          referencePath,
        );
      },
    );
  });

  it("uses decision signal rather than a fixed goat-debug read count", () => {
    assertForEachTarget(installedSkillPaths("goat-debug"), (skillPath) => {
      const skillGuidance = readProjectFile(skillPath);
      assert.doesNotMatch(
        skillGuidance,
        /Can't reproduce after 5 file reads/u,
        skillPath,
      );
      assert.match(
        skillGuidance,
        /If repeated reads or experiments produce no new decision signal, checkpoint: state what was checked, which hypotheses remain, and the next distinguishing evidence needed\./u,
        skillPath,
      );
    });
  });

  it("does not eliminate intermittent goat-debug hypotheses after one pass", () => {
    assertForEachTarget(
      installedSkillReferencePaths(
        "goat-debug",
        "references/diagnostic-techniques.md",
      ),
      (referencePath) => {
        const referenceGuidance = readProjectFile(referencePath);
        assert.match(
          referenceGuidance,
          /A single passing run cannot eliminate an intermittent hypothesis\./u,
          referencePath,
        );
        assert.match(
          referenceGuidance,
          /Record runs and failures only when intermittency is decision-relevant/u,
          referencePath,
        );
      },
    );
  });

  it("preserves the triggering workload during goat-debug performance reduction", () => {
    assertForEachTarget(
      installedSkillReferencePaths(
        "goat-debug",
        "references/diagnostic-techniques.md",
      ),
      (referencePath) => {
        const referenceGuidance = readProjectFile(referencePath);
        assert.match(
          referenceGuidance,
          /preserve the triggering workload/iu,
          referencePath,
        );
        assert.match(
          referenceGuidance,
          /comparable environment and repeated measurements/u,
          referencePath,
        );
        assert.doesNotMatch(
          referenceGuidance,
          /always run exactly \d+|universal failure-rate threshold/iu,
          referencePath,
        );
      },
    );
  });

  it("requires goat-qa Standard-mode gap output to include Verification Integrity", () => {
    assertForEachTarget(installedSkillPaths("goat-qa"), (skillPath) => {
      const skillGuidance = readProjectFile(skillPath);
      assert.match(
        skillGuidance,
        /Run the Candidate Disproval Pass, then present gap analysis, Refuted Candidates, and Verification Integrity/u,
        skillPath,
      );
      assert.match(
        skillGuidance,
        /`confirm`[\s\S]+`kill as false positive`[\s\S]+`keep with named missing evidence`/u,
        skillPath,
      );
    });
    assertForEachTarget(
      installedSkillReferencePaths("goat-qa", "references/output-templates.md"),
      (referencePath) => {
        const outputTemplates = readProjectFile(referencePath);
        assert.match(
          outputTemplates,
          /Intent spec: \[PR\/issue\/test plan URL or `no-intent-spec`\]/,
          referencePath,
        );
        assert.equal(
          outputTemplates.match(/^## Refuted Candidates$/gmu)?.length,
          GOAT_QA_FINAL_OUTPUT_VARIANT_COUNT,
          referencePath,
        );
        assert.match(outputTemplates, /Evidence limit:/, referencePath);
      },
    );
  });

  it("loads goat-qa output templates progressively from mirrored references", () => {
    assertForEachTarget(INSTALLED_SKILL_ROOTS, (skillRoot) => {
      const skillPath = `${skillRoot}/goat-qa/SKILL.md`;
      const referencePath = `${skillRoot}/goat-qa/references/output-templates.md`;
      const outputTemplates = readProjectFile(referencePath);

      assert.match(
        readMarkdownSection(skillPath, "Output Format"),
        /After analysis, read `references\/output-templates\.md`/,
        skillPath,
      );
      assert.match(
        readMarkdownSection(skillPath, "Audit Mode"),
        /Audit post-gate template in `references\/output-templates\.md`/u,
        skillPath,
      );
      assert.match(
        outputTemplates,
        /### Standard mode - Phase 2 output/,
        referencePath,
      );
      assert.match(outputTemplates, /### Audit post-gate plan/, referencePath);
    });

    const manifest = JSON.parse(readProjectFile("workflow/manifest.json")) as {
      skills: { references: Record<string, string[]> };
    };
    assert.deepStrictEqual(manifest.skills.references["goat-qa"], [
      "references/output-templates.md",
    ]);
  });

  it("gives goat-qa Regression Guard users a mode-specific intake checkpoint", () => {
    assertForEachTarget(installedSkillPaths("goat-qa"), (skillPath) => {
      const intake = readMarkdownSection(skillPath, "Step 0 - Intake");
      assert.match(
        intake,
        /CHECKPOINT:[^\n]+Regression Guard:[^\n]+Mapping \[N\] invariants against \[prior fix evidence \/ unavailable evidence\]/u,
        skillPath,
      );
    });
  });

  it("keeps optional machine findings distinct from goat-qa Markdown output", () => {
    assertForEachTarget(
      [
        "workflow/skills/playbooks/skill-quality-testing/adversarial-framing.md",
        ".goat-flow/skill-docs/skill-quality-testing/adversarial-framing.md",
      ],
      (referencePath) => {
        const guidance = readProjectFile(referencePath);
        assert.match(
          guidance,
          /Use this optional schema only when a real downstream consumer requires machine-readable findings/,
          referencePath,
        );
        assert.match(
          guidance,
          /`\/goat-qa` skill \| Human-readable gap tables; not an implementation of the optional JSON schema/,
          referencePath,
        );
      },
    );
  });

  it("routes goat-qa by evidence scope before generic gap vocabulary", () => {
    assertForEachTarget(installedSkillPaths("goat-qa"), (skillPath) => {
      const intake = readMarkdownSection(skillPath, "Step 0 - Intake");
      const recentChangeRoute =
        /Explicit diff, PR, branch, changed-file, or recent-change scope[^\n]+Standard mode[^\n]+even when[^\n]+"audit", "coverage", or "gaps"/u;
      const areaAuditRoute =
        /Explicit codebase area, directory, module, or risk-class coverage audit with no recent-change scope[^\n]+Audit mode/u;

      assert.match(intake, recentChangeRoute, skillPath);
      assert.match(intake, areaAuditRoute, skillPath);
      assert.match(
        intake,
        /Bare "audit", "coverage", or "gaps" with no change or area scope[^\n]+ask whether the user means recent-change Standard or no-diff area Audit/u,
        skillPath,
      );
      assert.match(
        intake,
        /Scope semantics outrank dispatcher depth/u,
        skillPath,
      );
      assert.doesNotMatch(
        intake,
        /"audit"\/"coverage"\/"gaps" → Audit mode/u,
        skillPath,
      );
      assert.ok(
        intake.search(recentChangeRoute) < intake.search(areaAuditRoute),
        `${skillPath}: recent-change routing must precede no-diff area routing`,
      );
    });
  });
});
