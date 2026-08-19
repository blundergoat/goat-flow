/**
 * Contracts for guidance every skill inherits: the preamble, conventions, playbook wiring,
 * and the mirror parity that keeps all four install roots saying the same thing.
 *
 * Reads the installed copies rather than sources, so a contract fails when the guidance a user
 * actually receives drifts - not merely when the template does.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  assertForEachTarget,
  installedSkillPaths,
  installedSkillReferencePaths,
  readMarkdownSection,
  readProjectFile,
} from "./skill-hardening.helpers.js";

describe("skill hardening contracts: shared surfaces (1/3)", () => {
  it("keeps canonical skill boundaries explicit and route-focused", () => {
    const canonicalSkills = [
      "goat",
      "goat-debug",
      "goat-plan",
      "goat-review",
      "goat-critique",
      "goat-security",
      "goat-qa",
      "goat-clarity",
    ];

    assertForEachTarget(canonicalSkills, (skillName) => {
      assertForEachTarget(installedSkillPaths(skillName), (skillPath) => {
        const boundaryCommands = readMarkdownSection(
          skillPath,
          "Boundary Commands",
        );
        assert.match(boundaryCommands, /\*\*NEVER:\*\*/, skillPath);
        assert.match(
          boundaryCommands,
          /\*\*ALWAYS(?: in Diagnose mode)?:\*\*/u,
          skillPath,
        );
        assert.match(boundaryCommands, /\*\*DEFER TO:\*\*/, skillPath);
      });
    });
  });

  it("enrolls goat-clarity in canonical registry and release owners", () => {
    for (const ownerPath of [
      "workflow/manifest.json",
      ".goat-flow/config.yaml",
      "scripts/check-versions.mjs",
      ".github/workflows/context-validation.yml",
    ]) {
      assert.match(readProjectFile(ownerPath), /goat-clarity/u, ownerPath);
    }
  });

  it("keeps the shared skill-document index identical after installation", () => {
    assert.equal(
      readProjectFile(".goat-flow/skill-docs/README.md"),
      readProjectFile("workflow/skills/reference/README.md"),
    );
  });

  it("includes goat-clarity in every setup inventory", () => {
    for (const ownerPath of [
      "workflow/setup/01-system-overview.md",
      "workflow/setup/03-install-skills.md",
      "src/dashboard/views/setup.html",
    ]) {
      assert.match(readProjectFile(ownerPath), /goat-clarity/u, ownerPath);
    }
  });

  it("carries explicit build intent through planning into ordinary ACT", () => {
    assertForEachTarget(installedSkillPaths("goat"), (skillPath) => {
      const routeMap = readMarkdownSection(skillPath, "Route Map");
      const constraints = readMarkdownSection(skillPath, "Constraints");

      assert.match(
        routeMap,
        /Plan\/design or non-trivial build\/change[^\n]+return-to-implement[^\n]+plan\/design stops after planning/u,
        skillPath,
      );
      assert.match(
        constraints,
        /return-to-implement` preserves build authorization, but Ask First boundaries still gate/u,
        skillPath,
      );
    });

    assertForEachTarget(installedSkillPaths("goat-plan"), (skillPath) => {
      const delivery = readMarkdownSection(
        skillPath,
        "Phase 2 - Deliver Milestones",
      );

      assert.match(delivery, /\*\*Post-plan return:\*\*/u, skillPath);
      assert.match(delivery, /After Phase 2 finishes/u, skillPath);
      assert.match(delivery, /return-to-implement/u, skillPath);
      assert.match(
        delivery,
        /hands ordinary ACT the existing build authorization/u,
        skillPath,
      );
      assert.match(delivery, /new Ask First boundaries still gate/u, skillPath);
      assert.match(delivery, /Plan-only stops/u, skillPath);
    });

    const publicGuidance = readProjectFile("docs/skills.md");
    assert.match(publicGuidance, /return-to-implement/u);
    assert.match(publicGuidance, /ordinary ACT implementation/u);
    assert.match(publicGuidance, /new Ask First boundaries still gate/u);

    const implementationDecision = readProjectFile(
      ".goat-flow/learning-loop/decisions/ADR-005-no-implementation-skill.md",
    );
    assert.match(implementationDecision, /return-to-implement/u);
    assert.match(
      implementationDecision,
      /authorized build\/change work to ordinary ACT/u,
    );
    assert.match(implementationDecision, /Ask First boundaries still gate/u);
    assert.doesNotMatch(
      implementationDecision,
      /invoke the implementation directly after planning/u,
    );
  });

  /*
   * Timing evidence is only trustworthy if every harness records it the same way.
   * A harness that learned a weaker contract would emit Actuals that look
   * identical to measured ones while resting on nothing.
   */

  it("forces Full depth for one material-risk class regardless of size", () => {
    assertForEachTarget(installedSkillPaths("goat-review"), (skillPath) => {
      const scope = readMarkdownSection(
        skillPath,
        "Step 0 - Scope, Size, Spec",
      );
      assert.match(scope, /material-risk override[^\n]+Full/iu, skillPath);
      assert.match(scope, /risk-depth-declined[^\n]+PARTIAL/u, skillPath);
    });

    assertForEachTarget(
      installedSkillReferencePaths("goat-review", "references/examples.md"),
      (referencePath) => {
        const reference = readMarkdownSection(
          referencePath,
          "Scope, Gates, and Frozen Bundle Procedure",
        );
        assert.match(reference, /### Material-Risk Override/u, referencePath);
        assert.match(
          reference,
          /One matching class selects Full regardless of size/u,
          referencePath,
        );
        for (const riskClass of [
          "Security or trust boundary",
          "Migration or persistence",
          "Public contract",
          "Concurrency or state transition",
          "Hook, CI, or verification",
        ]) {
          assert.match(reference, new RegExp(riskClass, "u"), referencePath);
        }
        assert.match(
          reference,
          /Quick request[\s\S]{0,180}risk-depth-declined[\s\S]{0,120}PARTIAL/u,
          referencePath,
        );
      },
    );
  });

  it("classifies gate evidence without inventing changed-code causality", () => {
    assertForEachTarget(installedSkillPaths("goat-review"), (skillPath) => {
      const scope = readMarkdownSection(
        skillPath,
        "Step 0 - Scope, Size, Spec",
      );
      const integrity = readMarkdownSection(
        skillPath,
        "Review Integrity (confidence signal)",
      );
      const output = readMarkdownSection(skillPath, "Output Format");
      assert.match(
        scope,
        /changed-code[^\n]+pre-existing[^\n]+infrastructure[^\n]+unresolved/u,
        skillPath,
      );
      assert.match(scope, /only host-proven changed-code/iu, skillPath);
      assert.match(integrity, /\*\*Gate evidence:\*\*/u, skillPath);
      assert.match(integrity, /gate-evidence-incomplete/u, skillPath);
      assert.match(output, /Gate evidence:/u, skillPath);
    });

    assertForEachTarget(
      installedSkillReferencePaths("goat-review", "references/examples.md"),
      (referencePath) => {
        const reference = readMarkdownSection(
          referencePath,
          "Scope, Gates, and Frozen Bundle Procedure",
        );
        assert.match(
          reference,
          /### Gate Evidence Classification/u,
          referencePath,
        );
        assert.match(
          reference,
          /Passing tests and checks are positive evidence/u,
          referencePath,
        );
        assert.match(
          reference,
          /changed-code[^\n]+host[^\n]+changed anchor/iu,
          referencePath,
        );
        assert.match(
          reference,
          /pre-existing[^\n]+base or unchanged authority/iu,
          referencePath,
        );
        assert.match(
          reference,
          /infrastructure[^\n]+never a code finding/iu,
          referencePath,
        );
        assert.match(
          reference,
          /unresolved[^\n]+causality remains unproven/iu,
          referencePath,
        );
      },
    );
  });

  it("teaches compact clean output and provenance without real-incident claims", () => {
    assertForEachTarget(
      installedSkillReferencePaths("goat-review", "references/examples.md"),
      (referencePath) => {
        const examples = readMarkdownSection(
          referencePath,
          "Conditional Output and Provenance Shapes",
        );
        assert.match(
          examples,
          /Illustrative scenario[^\n]+never evidence/iu,
          referencePath,
        );
        assert.match(examples, /Clean review compact surface/u, referencePath);
        assert.match(
          examples,
          /More than five surfaced findings/u,
          referencePath,
        );
        assert.match(
          examples,
          /Automated findings the local review missed/u,
          referencePath,
        );
        assert.match(
          examples,
          /Local findings every bot missed/u,
          referencePath,
        );
        assert.match(examples, /bot-only-locally-verified/u, referencePath);
        assert.match(examples, /disputed-match/u, referencePath);
      },
    );
  });

  it("defines two evidence-producing area audit passes", () => {
    assertForEachTarget(installedSkillPaths("goat-review"), (skillPath) => {
      const areaAudit = readMarkdownSection(skillPath, "Area Audit (Full)");
      const passOneIndex = areaAudit.indexOf(
        "### Area Pass 1 - Inventory and Risk Hypotheses",
      );
      const passTwoIndex = areaAudit.indexOf(
        "### Area Pass 2 - Implementation and Consumer Verification",
      );

      assert.ok(passOneIndex >= 0, `${skillPath}: missing Area Pass 1`);
      assert.ok(
        passTwoIndex > passOneIndex,
        `${skillPath}: Area Pass 2 must follow Area Pass 1`,
      );
      assert.match(
        areaAudit,
        /inventory responsibilities, interfaces, trust\/state boundaries, and critical paths without using recent diff as scope/u,
        skillPath,
      );
      assert.match(
        areaAudit,
        /Record raw suspicions with `file \+ semantic anchor`; do not resolve them/u,
        skillPath,
      );
      assert.match(
        areaAudit,
        /Open implementation, tests, and consumers/u,
        skillPath,
      );
      assert.match(
        areaAudit,
        /Mark each suspicion `CONFIRMED`, `ADJUSTED`, `REFUTED`, or `UNRESOLVED` and retain the Refutation Ledger/u,
        skillPath,
      );
    });
  });

  it("requires host re-derivation for absence-based findings", () => {
    for (const preamblePath of [
      "workflow/skills/reference/skill-preamble.md",
      ".goat-flow/skill-docs/skill-preamble.md",
    ]) {
      const preamble = readMarkdownSection(preamblePath, "Evidence Standard");
      assert.match(preamble, /load-bearing claim is an absence/u, preamblePath);
      assert.match(
        preamble,
        /search the exact symbol expecting zero lines/u,
        preamblePath,
      );
      assert.match(
        preamble,
        /subagent negatives and broad-pattern hits are not evidence/u,
        preamblePath,
      );
    }
  });

  it("records the current ceremony contract in ADR-006", () => {
    const decision = readProjectFile(
      ".goat-flow/learning-loop/decisions/ADR-006-autonomous-skill-mode.md",
    );

    assert.match(decision, /\*\*Status:\*\* Accepted\n/u);
    assert.doesNotMatch(decision, /\*\*Status:\*\* Accepted \(partial\)/u);
    assert.match(decision, /Complexity controls pre-invocation routing/u);
    assert.match(
      decision,
      /Once a skill is invoked, complexity MUST NOT skip that skill's required phases or verification gates/u,
    );
    assert.match(decision, /Sub-agent gate conversion remains accepted/u);
    assert.match(decision, /## Superseded Portion/u);
  });

  it("names only real safety-critical sub-agent gates", () => {
    for (const conventionsPath of [
      "workflow/skills/reference/skill-conventions.md",
      ".goat-flow/skill-docs/skill-conventions.md",
    ]) {
      const conventions = readProjectFile(conventionsPath);
      assert.match(
        conventions,
        /goat-debug D2→D3 "human decides before fixing"/,
        conventionsPath,
      );
      assert.match(
        conventions,
        /goat-clarity Scope v2 approval gate MUST remain blocking even in sub-agent mode/u,
        conventionsPath,
      );
      assert.doesNotMatch(
        conventions,
        /goat-security final report/,
        conventionsPath,
      );
    }
  });

  it("assigns learning-loop retrieval to exactly one route owner", () => {
    assertForEachTarget(installedSkillPaths("goat"), (skillPath) => {
      const routingFlow = readMarkdownSection(skillPath, "How It Works");
      assert.match(
        routingFlow,
        /Routed skills own learning-loop retrieval; do not pre-read their learning-loop indexes in the dispatcher/u,
        skillPath,
      );
      assert.match(
        routingFlow,
        /Direct execution only: run the shared preamble's INDEX-first retrieval before emitting the Route Snapshot/u,
        skillPath,
      );
      assert.doesNotMatch(
        routingFlow,
        /Footgun matches: grep/u,
        `${skillPath}: dispatcher must not duplicate the routed skill's Step 0 retrieval`,
      );
    });
  });

  it("records routing depth and direct-execution learnings in the Route Snapshot", () => {
    assertForEachTarget(installedSkillPaths("goat"), (skillPath) => {
      const routingFlow = readMarkdownSection(skillPath, "How It Works");
      assert.match(routingFlow, /Depth: <routing depth>/u, skillPath);
      assert.match(
        routingFlow,
        /Relevant prior learnings: <direct route: matches \| none \| retrieval miss; routed skill: omit>/u,
        skillPath,
      );
      assert.match(
        routingFlow,
        /Only direct-execution snapshots include the retrieval result/u,
        skillPath,
      );
    });
  });

  it("keeps public skill workflows aligned with the installed control flow", () => {
    const debugDocumentation = readMarkdownSection(
      "docs/skills.md",
      "/goat-debug",
    );
    assert.match(
      debugDocumentation,
      /I1 -->\|"CHECKPOINT"\| I2/u,
      "explicitly scoped investigation must not be documented as a blocking gate",
    );
    assert.match(
      debugDocumentation,
      /explicit goal and scope continue without waiting/u,
    );
    assert.doesNotMatch(debugDocumentation, /I1 -->\|"BLOCKING GATE"\| I2/u);

    const reviewDocumentation = readMarkdownSection(
      "docs/skills.md",
      "/goat-review",
    );
    assert.match(reviewDocumentation, /Pass 1: Blind Suspicion/u);
    assert.match(reviewDocumentation, /Pass 2: Grounded Verification/u);
    assert.match(
      reviewDocumentation,
      /Confirm \/ Adjust \/ Refute \/ Unresolve/u,
    );
    assert.match(
      reviewDocumentation,
      /Automated-review conclusions stay unread until both local passes finish/u,
    );
    assert.match(reviewDocumentation, /R-NNN \[SEVERITY:ACTION\]/u);
    assert.match(
      reviewDocumentation,
      /version-matched CLI[^\n]+goat-flow review validate[^\n]+does not block/iu,
    );
    assert.match(
      reviewDocumentation,
      /MUST[^\n]+host verifies[^\n]+citation/iu,
    );
    assert.doesNotMatch(reviewDocumentation, /Severity-Ordered Scan/u);

    const securityDocumentation = readMarkdownSection(
      "docs/skills.md",
      "/goat-security",
    );
    assert.match(securityDocumentation, /\*\*Quick Scan\*\*/u);
    assert.match(securityDocumentation, /\*\*Full Assessment\*\*/u);
    assert.doesNotMatch(securityDocumentation, /\*\*Threat model mode:\*\*/u);
    assert.doesNotMatch(securityDocumentation, /\*\*Dependency audit\*\*/u);
    assert.doesNotMatch(securityDocumentation, /\*\*Compliance\*\*/u);

    const qaDocumentation = readMarkdownSection("docs/skills.md", "/goat-qa");
    assert.match(
      qaDocumentation,
      /BLOCKING GATE unless test-plan intent is explicit/u,
    );
    assert.match(
      qaDocumentation,
      /explicit "what should I test" or "test plan" intent auto-releases the gate/u,
    );
  });

  it("defers stale-index regeneration when committed writes are forbidden", () => {
    for (const preamblePath of [
      "workflow/skills/reference/skill-preamble.md",
      ".goat-flow/skill-docs/skill-preamble.md",
    ]) {
      const retrievalContract = readMarkdownSection(
        preamblePath,
        "Learning-Loop Retrieval",
      );
      assert.match(
        retrievalContract,
        /reporting-only\/read-only\/no-write\/no-implementation modes defer regeneration/u,
        preamblePath,
      );
      assert.match(
        retrievalContract,
        /Otherwise run `goat-flow index` only with user authorization/u,
        preamblePath,
      );
    }
  });
});
