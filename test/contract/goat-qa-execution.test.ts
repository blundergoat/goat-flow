/**
 * Pin goat-qa's authority to run a target project's existing checks without writing tests or fixing code.
 *
 * Users rely on QA reports that carry real results, so these contracts cover the skill, its output reference, shared authority,
 * dispatcher routing, public descriptions and the skill-set decision record. Live behaviour is proven by registered skill trials,
 * not by these checks.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  assertForEachTarget,
  assertMatchesAll,
  readMarkdownSection,
  readProjectFile,
} from "./skill-hardening.helpers.js";

const QA_ROOTS = [
  "workflow/skills/goat-qa",
  ".agents/skills/goat-qa",
  ".claude/skills/goat-qa",
  ".github/skills/goat-qa",
] as const;

const DISPATCHER_PATHS = [
  "workflow/skills/goat/SKILL.md",
  ".agents/skills/goat/SKILL.md",
  ".claude/skills/goat/SKILL.md",
  ".github/skills/goat/SKILL.md",
] as const;

const PREAMBLE_PATHS = [
  "workflow/skills/reference/skill-preamble.md",
  ".goat-flow/skill-docs/skill-preamble.md",
] as const;

/**
 * Read one H3 template block from the QA output reference, up to the next named template.
 * The reference's fenced templates contain their own H3 headings, so a generic H3 splitter would stop too early.
 *
 * @param templatesPath - output reference to read
 * @param startHeading - start of the H3 heading that opens the wanted template
 * @param endHeading - start of the H3 heading that opens the following template
 * @returns the template text between the two headings; a missing heading fails the assertion
 */
function readTemplateBlock(
  templatesPath: string,
  startHeading: string,
  endHeading: string,
): string {
  const content = readProjectFile(templatesPath);
  const start = content.indexOf(startHeading);
  const end = content.indexOf(endHeading);
  assert.notEqual(start, -1, `${templatesPath}: missing ${startHeading}`);
  assert.ok(
    end > start,
    `${templatesPath}: missing ${endHeading} after ${startHeading}`,
  );
  return content.slice(start, end);
}

describe("goat-qa existing-test execution", () => {
  it("lets QA run existing checks while it still never writes tests or fixes code", () => {
    // Every installed copy is what a user's agent loads, so each must carry the execution boundary.
    assertForEachTarget(QA_ROOTS, (qaRoot) => {
      const skillPath = `${qaRoot}/SKILL.md`;
      const content = readProjectFile(skillPath);
      assert.doesNotMatch(content, /neither writes nor runs tests/u, skillPath);
      assert.doesNotMatch(
        content,
        /NEVER:[^\n]*Run or write tests/u,
        skillPath,
      );
      assertMatchesAll(
        content,
        [
          /In Standard mode it also runs the target project's existing checks and reports their real results\. It never writes tests\./u,
          /\*\*NEVER:\*\* Write or edit tests or application code, generate test code, review code, or certify merges\./u,
          /\*\*ALWAYS:\*\*[^\n]*report each check run with its actual result/u,
          /\*\*DEFER TO:\*\* `\/goat-debug` for new failures and their root cause/u,
        ],
        skillPath,
      );
    });
  });

  it("bounds what QA selects, where it runs and what it may write", () => {
    // The skill says when a run happens; the execution reference owns the steps, so a run reads them in one place.
    assertForEachTarget(QA_ROOTS, (qaRoot) => {
      const skillPath = `${qaRoot}/SKILL.md`;
      const section = readMarkdownSection(skillPath, "Existing-Test Execution");
      assertMatchesAll(
        section,
        [
          /Standard mode runs existing checks after gap analysis and before its Phase 2 gate/u,
          /Audit runs them only on request; Regression Guard never does/u,
          /Before the first command, read `references\/execution\.md` and follow its Existing Checks steps/u,
        ],
        skillPath,
      );
      const referencePath = `${qaRoot}/references/execution.md`;
      const steps = readMarkdownSection(referencePath, "Existing Checks");
      assertMatchesAll(
        steps,
        [
          /target project's instruction Essential Commands, `package\.json` scripts, or documented runner/u,
          /focused tests for the changed behaviour plus checks the project marks required/u,
          /Skip optional suites unless requested; ask before a required check that is slow, networked, or credentialed\. Name each check skipped/u,
          /from the target project root, never the harness repository/u,
          /never edit, add, skip, or delete tests or application code, or change configuration to pass/u,
          /Before the first check, record fingerprints for existing untracked files/u,
          /Before and after each check, compare tracked status and diff/u,
          /After each check, also compare the original untracked fingerprints/u,
          /Stop and report any tracked change or any file from the original untracked baseline that changed or disappeared/u,
          /command, directory, exit status, and unverified scope/u,
          /For tests, include runner pass\/fail\/skip counts/u,
          /A test run with zero tests or no counts is unverified\. For other checks, use exit status and output/u,
          /hand off to `\/goat-debug`/u,
          /Never fix, rerun until green, or hide skips/u,
        ],
        referencePath,
      );
    });
  });

  it("runs nothing when the request is analysis-only", () => {
    // An explicit no-run request must override the default run, and the report must say why nothing ran.
    assertForEachTarget(QA_ROOTS, (qaRoot) => {
      const skillPath = `${qaRoot}/SKILL.md`;
      const section = readMarkdownSection(skillPath, "Existing-Test Execution");
      assertMatchesAll(
        section,
        [
          /An explicit analysis-only, no-run, or assessment-only request runs nothing/u,
          /including browser checks and Fix Replay/u,
          /`Commands run: none \(analysis-only request\)`/u,
          /journeys as untested, and any claimed fix as unverified/u,
        ],
        skillPath,
      );
    });
  });

  it("shows real results at the Phase 2 gate and keeps Regression Guard report-only", () => {
    // The gate is where the user decides, so it must carry the run results; fix verification stays with goat-debug.
    assertForEachTarget(QA_ROOTS, (qaRoot) => {
      const skillPath = `${qaRoot}/SKILL.md`;
      const phase2 = readMarkdownSection(skillPath, "Phase 2 - Gap Analysis");
      assert.match(
        phase2,
        /Run Existing-Test Execution and the Candidate Disproval Pass, then present gap analysis, test results, Refuted Candidates, and Verification Integrity/u,
        skillPath,
      );
      const regressionGuard = readMarkdownSection(
        skillPath,
        "Regression Guard Mode",
      );
      assert.match(regressionGuard, /Do NOT verify the fix\./u, skillPath);
    });
  });

  it("reports each command's directory, exit status, counts and unverified scope", () => {
    // Standard output carries the results table; Audit names its default of running nothing.
    assertForEachTarget(QA_ROOTS, (qaRoot) => {
      const templatesPath = `${qaRoot}/references/output-templates.md`;
      const standard = readTemplateBlock(
        templatesPath,
        "### Standard mode - Phase 2 output",
        "### Standard mode - Phase 3 output",
      );
      assertMatchesAll(
        standard,
        [
          /## Existing-Test Results/u,
          /\| Command \| Directory \| Exit \| Pass \| Fail \| Skip \| Unverified scope \|/u,
          /- Commands run: \[each row in Existing-Test Results, or `none \(analysis-only request\)`\]/u,
          /- Checks not run: \[/u,
          /- New failures: \[[^\n]*`\/goat-debug`/u,
        ],
        templatesPath,
      );
      assert.doesNotMatch(
        standard,
        /goat-qa does not execute tests/u,
        templatesPath,
      );
      const audit = readTemplateBlock(
        templatesPath,
        "### Audit mode",
        "### Audit post-gate plan",
      );
      assertMatchesAll(
        audit,
        [
          /## Existing-Test Results {2}<!-- only when the user asked for a run/u,
          /- Commands run: \[each row in Existing-Test Results, or `none` when no run was requested\]/u,
        ],
        templatesPath,
      );
      assert.doesNotMatch(
        audit,
        /goat-qa does not execute tests/u,
        templatesPath,
      );
    });
  });
});

describe("goat-qa execution authority outside the skill", () => {
  it("keeps QA report-only for files while it runs existing checks", () => {
    // The shared contract is loaded by every report-only skill, so the QA exception must be named there.
    assertForEachTarget(PREAMBLE_PATHS, (preamblePath) => {
      const section = readMarkdownSection(
        preamblePath,
        "Report-Only Skill Contract",
      );
      assertMatchesAll(
        section,
        [
          /are report-only by default/u,
          /`\/goat-qa` may also run the target project's existing checks; they may create their usual untracked outputs/u,
          /Stop and report changes to tracked files or to any untracked file that existed before the first check/u,
        ],
        preamblePath,
      );
    });
  });

  it("routes existing-test runs and fix verification to QA and failures to goat-debug", () => {
    // QA's row owns running existing tests and verifying a claimed fix; goat-debug keeps bugs and failures.
    assertForEachTarget(DISPATCHER_PATHS, (dispatcherPath) => {
      const routeMap = readMarkdownSection(dispatcherPath, "Route Map");
      assertMatchesAll(
        routeMap,
        [
          /\| Testing gaps, coverage, verification planning, existing-test runs, verify a fix \| `\/goat-qa` \|/u,
          /\| Bug, failure, unexpected behaviour \| `\/goat-debug` \|/u,
        ],
        dispatcherPath,
      );
    });
  });

  it("describes QA's runs in the public skill guide", () => {
    const docsPath = "docs/skills.md";
    const docs = readProjectFile(docsPath);
    assert.doesNotMatch(docs, /Does not run or write tests/u, docsPath);
    assert.doesNotMatch(docs, /planning, not execution/u, docsPath);
    const qaSection = readMarkdownSection(docsPath, "/goat-qa");
    assertMatchesAll(
      qaSection,
      [
        /runs the target project's existing checks before its Phase 2 gate/u,
        /never writes or edits tests or application code/u,
        /An explicit analysis-only request runs nothing/u,
      ],
      docsPath,
    );
  });

  it("records the narrowed QA boundary in the skill-set decision", () => {
    const adrPath =
      ".goat-flow/learning-loop/decisions/ADR-009-skill-consolidation.md";
    const adr = readProjectFile(adrPath);
    // Match the obligation sentence, not the dated Updated line: later amendments prepend newer dates there.
    assert.match(
      adr,
      /`goat-qa` declares `\*\*NEVER:\*\* Write or edit tests or application code, generate test code, review code, or certify merges`/u,
      adrPath,
    );
    assert.doesNotMatch(
      adr,
      /the skill neither writes nor runs tests/u,
      adrPath,
    );
  });
});

const PLAYBOOK_ROOTS = [
  "workflow/skills/playbooks",
  ".goat-flow/skill-docs/playbooks",
] as const;

describe("goat-qa browser checks, fix replay and screenshots", () => {
  it("routes browser checks, screenshots and fix replay from the skill to its execution reference", () => {
    // The skill body has a word cap, so each new path is a pointer the run follows into the reference.
    assertForEachTarget(QA_ROOTS, (qaRoot) => {
      const skillPath = `${qaRoot}/SKILL.md`;
      const content = readProjectFile(skillPath);
      assertMatchesAll(
        content,
        [
          /When execution is authorized and the change alters a page or other browser-visible behaviour, also follow its Browser Checks; capture screenshots only under its Screenshot Evidence rules\./u,
          /Explicit request to verify a claimed fix → Fix Replay mode: apply the analysis-only rule above, then follow `references\/execution\.md` when execution is authorized/u,
        ],
        skillPath,
      );
    });
  });

  it("exercises affected journeys in an approved browser and names unobserved ones", () => {
    assertForEachTarget(QA_ROOTS, (qaRoot) => {
      const referencePath = `${qaRoot}/references/execution.md`;
      assertMatchesAll(
        readMarkdownSection(referencePath, "Browser Checks"),
        [
          /exercise each affected journey there as well as running the existing checks/u,
          /Prepare\*\* with `references\/manual-testing\.md`: prove the environment, account and served code before the first step/u,
          /status `verified`, `failed`, `blocked`, or `untested`/u,
          /a journey with no approved browser or target is `blocked` or `untested`, with the reason/u,
          /A passing test suite never stands in for an unobserved journey/u,
        ],
        referencePath,
      );
    });
  });

  it("verifies a claimed fix only by replaying its recorded failure and running its regressions", () => {
    assertForEachTarget(QA_ROOTS, (qaRoot) => {
      const referencePath = `${qaRoot}/references/execution.md`;
      assertMatchesAll(
        readMarkdownSection(referencePath, "Fix Replay"),
        [
          /Replay\*\* those steps on the current code, following Browser Checks when the original failure was browser-visible/u,
          /record what you observe against the recorded original failure/u,
          /`verified` only when the replay shows the expected result and those checks pass/u,
          /No recorded reproduction:\*\* report the claim `unverified` and ask for the steps/u,
          /Never write a reproduction and present it as the original/u,
        ],
        referencePath,
      );
    });
  });

  it("captures reviewed screenshots only when a claim needs them, at self-documenting plan paths", () => {
    assertForEachTarget(QA_ROOTS, (qaRoot) => {
      const referencePath = `${qaRoot}/references/execution.md`;
      assertMatchesAll(
        readMarkdownSection(referencePath, "Screenshot Evidence"),
        [
          /A value or text claim needs no screenshot/u,
          /`evidence\/<milestone>-<scenario-slug>-<YYYYMMDDTHHMMZ>\/screenshots\/<step>-<page-or-flow>-<observed-state>-<width>x<height>\.png`/u,
          /add a collision suffix rather than replace a file/u,
          /Never infer or change `\.active`/u,
          /keep only a reviewed capture at its final path/u,
          /a `meta\.json` in the run folder/u,
          /never overwrite or delete an existing capture/u,
        ],
        referencePath,
      );
    });
  });

  it("ships the manual-testing rules every installed agent reads before a browser check", () => {
    // These rules come from real local-testing failures where setup or driver faults looked like product defects.
    const canonical = readProjectFile(
      "workflow/skills/goat-qa/references/manual-testing.md",
    );
    assertForEachTarget(QA_ROOTS, (qaRoot) => {
      const referencePath = `${qaRoot}/references/manual-testing.md`;
      const content = readProjectFile(referencePath);
      assert.equal(
        content,
        canonical,
        `${referencePath} drifted from the canonical reference`,
      );
      assertMatchesAll(
        content,
        [
          /## Prove the Environment First/u,
          /prove the running app serves the changed code/u,
          /confirm the workspace, tenant, and role the app actually landed on/u,
          /start in a fresh browser context and go straight there/u,
          /Confirm an action was accepted/u,
          /verify a build ID, served asset hash, or observable behaviour that distinguishes the builds/u,
          /Verify rendered visibility, including the element’s computed visibility and any hiding, clipping, or opacity from ancestors/u,
          /Give every step the page \(URL\) and account it runs on/u,
          /Never print personal data, credentials, or one-time codes/u,
          /Ask before a step that really sends, publishes, or pays/u,
        ],
        referencePath,
      );
    });
  });

  it("registers both new references and installs them byte-identical", () => {
    const manifest = JSON.parse(readProjectFile("workflow/manifest.json")) as {
      skills: { references: Record<string, string[]> };
    };
    const qaReferences = manifest.skills.references["goat-qa"];
    assert.ok(
      qaReferences.includes("references/execution.md"),
      "manifest misses references/execution.md",
    );
    assert.ok(
      qaReferences.includes("references/manual-testing.md"),
      "manifest misses references/manual-testing.md",
    );
    const canonical = readProjectFile(
      "workflow/skills/goat-qa/references/execution.md",
    );
    assertForEachTarget(QA_ROOTS, (qaRoot) => {
      const referencePath = `${qaRoot}/references/execution.md`;
      assert.equal(
        readProjectFile(referencePath),
        canonical,
        `${referencePath} drifted from the canonical reference`,
      );
    });
  });

  it("gives browser journeys and fix replays their own output slots", () => {
    assertForEachTarget(QA_ROOTS, (qaRoot) => {
      const templatesPath = `${qaRoot}/references/output-templates.md`;
      const standard = readTemplateBlock(
        templatesPath,
        "### Standard mode - Phase 2 output",
        "### Standard mode - Phase 3 output",
      );
      assertMatchesAll(
        standard,
        [
          /## Browser Checks/u,
          /\| Journey \| Page \| Steps \| Expected \| Observed \| Evidence \| Status \|/u,
          /- Screenshots: \[each kept capture's path, with its `meta\.json`, or `none needed`\]/u,
        ],
        templatesPath,
      );
      const fixReplay = readTemplateBlock(
        templatesPath,
        "### Fix Replay mode",
        "### Standard mode - Phase 2 output",
      );
      assertMatchesAll(
        fixReplay,
        [
          /- Recorded reproduction: \[source and steps, or `none recorded`\]/u,
          /\| Step \| Expected \| Recorded original \| Observed now \| Evidence \|/u,
          /\[verified \| failed \| unverified\]/u,
          /## Refuted Candidates/u,
        ],
        templatesPath,
      );
    });
  });

  it("documents an owned headless browser and plan-evidence screenshots in the playbooks", () => {
    // Both the source playbooks and the installed copies are what agents read.
    assertForEachTarget(PLAYBOOK_ROOTS, (playbookRoot) => {
      const browserPath = `${playbookRoot}/browser-use.md`;
      assertMatchesAll(
        readProjectFile(browserPath),
        [
          /### Owned headless browser/u,
          /No running browser is not a blocker when a Chrome or Chromium binary exists and the task approves browser control/u,
          /Pair each newly launched instance with its own session or daemon name; this is not a way around a timeout on the same browser/u,
          /Record the instance.s PID when you launch it and stop it by that PID when done/u,
          /run the stop as its own command, apart from the launch, and bracket one character/u,
          /read element text with `textContent`/u,
          /stub it so any handler error aborts the request/u,
        ],
        browserPath,
      );
      const capturePath = `${playbookRoot}/page-capture.md`;
      assert.match(
        readProjectFile(capturePath),
        /When goat-qa names a plan, use the Screenshot Evidence path under the plan's gitignored `evidence\/` folder/u,
        capturePath,
      );
      assert.match(
        readProjectFile(capturePath),
        /keep records and the index in `<output_dir>`/u,
        capturePath,
      );
    });
  });

  it("describes browser checks and fix replay in the public skill guide", () => {
    const docsPath = "docs/skills.md";
    assertMatchesAll(
      readMarkdownSection(docsPath, "/goat-qa"),
      [
        /\*\*Fix Replay\*\*/u,
        /exercises each affected page in a browser/u,
        /replays the fix's recorded failure/u,
      ],
      docsPath,
    );
  });
});
