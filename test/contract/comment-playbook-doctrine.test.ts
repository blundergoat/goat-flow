/**
 * Locks the verification-led comment doctrine across canonical and installed playbooks.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const PLAYBOOK_ROOTS = [
  "workflow/skills/playbooks",
  ".goat-flow/skill-docs/playbooks",
] as const;

/** Applies one doctrine assertion to the canonical and installed copies. */
function assertForPlaybook(
  playbookName: string,
  assertion: (content: string, playbookPath: string) => void,
): void {
  for (const playbookRoot of PLAYBOOK_ROOTS) {
    const playbookPath = `${playbookRoot}/${playbookName}`;
    assertion(readFileSync(playbookPath, "utf8"), playbookPath);
  }
}

describe("comment playbook verification doctrine", () => {
  it("treats 150 as a ceiling instead of a width target, using formatter width first", () => {
    assertForPlaybook("code-comments.md", (content, playbookPath) => {
      assert.doesNotMatch(
        content,
        /~110|hard max 120|around 110|past 120/u,
        playbookPath,
      );
      assert.doesNotMatch(
        content,
        /The 150-character limit is mechanical|The 150-character ceiling|150 is a hard ceiling|hard maximum of 150 characters/u,
        playbookPath,
      );
      assert.match(
        content,
        /project or language\s+formatter's enforced width governs/u,
        playbookPath,
      );
      assert.match(
        content,
        /When neither defines a width, 150 characters is the fallback ceiling/u,
        playbookPath,
      );
      assert.match(
        content,
        /shortest complete useful comment wins/u,
        playbookPath,
      );
      assert.match(
        content,
        /never split one point across lines merely to stay short/u,
        playbookPath,
      );
      assert.doesNotMatch(
        content,
        /use the available width|run it toward 150/iu,
        playbookPath,
      );
      assert.match(
        content,
        /measure the longest existing comment line/u,
        playbookPath,
      );
    });
  });

  it("documents only admitted edge states and hidden arrival context", () => {
    assertForPlaybook("code-comments.md", (content, playbookPath) => {
      assert.doesNotMatch(
        content,
        /Null\/empty meaning on every|Every `@param` \/ `@returns` carries[\s\S]+null\/empty\/absent consequence/u,
        playbookPath,
      );
      assert.match(content, /admitted and semantically visible/u, playbookPath);
      assert.match(
        content,
        /Never document a null, empty, or absent state the interface cannot produce/u,
        playbookPath,
      );
      assert.doesNotMatch(
        content,
        /A user-journey anchor at flow entry points|Flow entry points carry a user-journey anchor/u,
        playbookPath,
      );
      assert.match(content, /verified arrival context/u, playbookPath);
      assert.match(
        content,
        /changes the\s+reader's interpretation[\s\S]+hidden from the code/u,
        playbookPath,
      );
    });
  });

  it("defers out-of-scope staleness and keeps load-bearing history", () => {
    assertForPlaybook("code-comments.md", (content, playbookPath) => {
      assert.doesNotMatch(
        content,
        /delete stale comments on sight/u,
        playbookPath,
      );
      assert.match(
        content,
        /outside the authori[sz]ed scope[\s\S]+report or defer it[\s\S]+do not delete it/u,
        playbookPath,
      );
      assert.match(
        content,
        /current compatibility obligation or a checkable removal trigger/u,
        playbookPath,
      );
      assert.doesNotMatch(content, /2026-08-01/u, playbookPath);
      assert.match(
        content,
        /Illustrative marker shape \(not incident evidence\)/u,
        playbookPath,
      );
    });
  });

  it("names acting components conditionally and governs em dashes", () => {
    assertForPlaybook("code-comments.md", (content, playbookPath) => {
      assert.match(
        content,
        /Name the acting component only when ownership or sequence changes how the reader interprets the consequence/u,
        playbookPath,
      );
      assert.match(
        content,
        /New or edited comments do not use em dashes as sentence punctuation/u,
        playbookPath,
      );
      assert.match(
        content,
        /exact\s+quoted or code material[\s\S]+untouched legacy comments/u,
        playbookPath,
      );
    });
  });

  it("removes syntax quotas without weakening consequential branches", () => {
    assertForPlaybook("code-comments.md", (content, playbookPath) => {
      assert.doesNotMatch(
        content,
        /not subject to any "omit by default"|A context line above every|Every function\/method[\s\S]+including trivial and private|Even private one-liners need this/iu,
        playbookPath,
      );
      assert.match(content, /trigger plus consequence/u, playbookPath);
      assert.match(
        content,
        /only honest line restates code[\s\S]+gets none/u,
        playbookPath,
      );
      assert.match(
        content,
        /Start naming and placement work in/u,
        playbookPath,
      );
      assert.match(
        content,
        /\[`naming-and-placement\.md`\]\(\.\/naming-and-placement\.md\)/u,
        playbookPath,
      );
      assert.match(
        content,
        /does not authorize a move,\s+guard removal, extraction, public rename, or behaviour change/u,
        playbookPath,
      );
      assert.match(
        content,
        /for public\/exported APIs, and for\s+file\/module\/class boundaries with a non-obvious contract/u,
        playbookPath,
      );
      assert.match(
        content,
        /self-explanatory private\/local units need none/u,
        playbookPath,
      );
    });
  });

  it("separates interface-reader selection from the code-layer lens", () => {
    assertForPlaybook("code-comments.md", (content, playbookPath) => {
      assert.match(content, /interface reader/u, playbookPath);
      assert.match(content, /separate layer lens/u, playbookPath);
      assert.match(
        content,
        /Product code behind a UI[\s\S]+person using the screen/u,
        playbookPath,
      );
      assert.match(
        content,
        /CLI, library, SDK, framework[\s\S]+developer calling it/u,
        playbookPath,
      );
      assert.match(
        content,
        /Daemon, job, migration, infrastructure[\s\S]+operator reading the log/u,
        playbookPath,
      );
      assert.match(
        content,
        /domain\/service[\s\S]+invariant or business consequence/u,
        playbookPath,
      );
      assert.match(
        content,
        /repository\/query[\s\S]+result-set contract or exceptional join rationale/u,
        playbookPath,
      );
      assert.match(
        content,
        /infrastructure[\s\S]+operator consequence and mechanism/u,
        playbookPath,
      );
    });
  });

  it("keeps defect codes report-only and rejects compensating prose", () => {
    assertForPlaybook("code-comments.md", (content, playbookPath) => {
      for (const defectCode of [
        "STALE",
        "FALSE",
        "RESTATES",
        "TERM",
        "METAPHOR",
        "HISTORY",
        "REMOTE",
        "VERBOSE",
        "MISSING-CONSEQUENCE",
      ]) {
        assert.match(
          content,
          new RegExp(`\\b${defectCode}\\b`, "u"),
          playbookPath,
        );
      }
      assert.match(content, /one primary code/u, playbookPath);
      assert.match(content, /optional secondary codes/u, playbookPath);
      assert.match(content, /ledger or report/u, playbookPath);
      assert.match(content, /never in source comments/u, playbookPath);
      assert.match(content, /report-only/u, playbookPath);
      assert.match(content, /compensating prose/u, playbookPath);
      assert.match(content, /better name, type, or structure/u, playbookPath);
      assert.match(
        content,
        /already-authorised code change[\s\S]+report or defer/u,
        playbookPath,
      );
      assert.match(
        content,
        /comment pass grants no structural authority/u,
        playbookPath,
      );
    });
  });

  it("bounds tag continuations and description blocks without deleting meaning", () => {
    assertForPlaybook("code-comments.md", (content, playbookPath) => {
      assert.match(content, /one physical line per tag/u, playbookPath);
      assert.match(content, /prefix passes column 100/u, playbookPath);
      assert.match(content, /one aligned continuation line/u, playbookPath);
      assert.match(content, /10 physical lines for a class/u, playbookPath);
      assert.match(content, /4 physical lines for a method/u, playbookPath);
      assert.match(content, /Bullets count as content/u, playbookPath);
      assert.match(content, /three consecutive prose lines/u, playbookPath);
      assert.match(content, /genuinely enumerable/u, playbookPath);
      assert.match(content, /never cut a qualifier/u, playbookPath);
    });
  });

  it("requires traceable catches and source-backed assertions", () => {
    assertForPlaybook("code-comments.md", (content, playbookPath) => {
      assert.match(content, /## Catch Comments/u, playbookPath);
      assert.match(
        content,
        /nullable getter[\s\S]+throwing dependency[\s\S]+missing configuration[\s\S]+vendor failure/u,
        playbookPath,
      );
      assert.match(content, /another local log adds no signal/u, playbookPath);
      assert.match(content, /## Verify Before You Assert/u, playbookPath);
      assert.match(content, /query's predicate/u, playbookPath);
      assert.match(
        content,
        /native type[\s\S]+doc comment[\s\S]+property or setter/u,
        playbookPath,
      );
      assert.match(content, /walk the branch[\s\S]+return/u, playbookPath);
      assert.match(content, /Tightening inherited prose/u, playbookPath);
    });
  });

  it("keeps count, branch-density, DI, and suppression heuristics narrow", () => {
    assertForPlaybook("code-comments.md", (content, playbookPath) => {
      assert.match(
        content,
        /Counts of adjacent mutable collections/u,
        playbookPath,
      );
      assert.match(content, /schema- or test-enforced count/u, playbookPath);
      assert.match(
        content,
        /compound conditions[\s\S]+default[\s\S]+fail-closed/u,
        playbookPath,
      );
      assert.match(
        content,
        /Pure dependency-injection constructors[\s\S]+obvious non-null services/u,
        playbookPath,
      );
      assert.match(
        content,
        /scalar, optional, configured, or side-effectful/u,
        playbookPath,
      );
      assert.match(
        content,
        /Prefer the language's or project's native syntax/u,
        playbookPath,
      );
    });
  });
});

describe("Gruff documentation-pass doctrine", () => {
  it("discovers checkout-local binaries before package candidates", () => {
    assertForPlaybook("gruff-code-quality.md", (content, playbookPath) => {
      const wrapperOffset = content.indexOf("Look for a project wrapper first");
      const releaseCandidateOffset = content.indexOf(
        '"target/release/$target"',
      );
      const binCandidateOffset = content.indexOf('"bin/$target"');
      const packageCandidateOffset = content.indexOf('"vendor/bin/$target"');
      assert.ok(wrapperOffset >= 0, playbookPath);
      assert.ok(releaseCandidateOffset >= 0, playbookPath);
      assert.ok(binCandidateOffset >= 0, playbookPath);
      assert.ok(packageCandidateOffset >= 0, playbookPath);
      assert.ok(wrapperOffset < releaseCandidateOffset, playbookPath);
      assert.ok(releaseCandidateOffset < binCandidateOffset, playbookPath);
      assert.ok(binCandidateOffset < packageCandidateOffset, playbookPath);
    });
  });

  it("derives threshold flags from the installed binary's help", () => {
    assertForPlaybook("gruff-code-quality.md", (content, playbookPath) => {
      assert.match(
        content,
        /Confirm the threshold flag against `analyse --help`/u,
        playbookPath,
      );
      assert.doesNotMatch(
        content,
        /gruff-go\/gruff-rs may spell the threshold `--min-severity`/u,
        playbookPath,
      );
    });
  });

  it("adds a stableIdentity documentation regression workflow", () => {
    assertForPlaybook("gruff-code-quality.md", (content, playbookPath) => {
      assert.match(
        content,
        /## Comment and Documentation Passes/u,
        playbookPath,
      );
      assert.match(content, /keep the before-edit JSON/u, playbookPath);
      assert.match(
        content,
        /introduced, removed, and unchanged `stableIdentity` values/u,
        playbookPath,
      );
      assert.match(content, /Aggregate equality is not proof/u, playbookPath);
      assert.match(
        content,
        /clean Gruff run does not prove comment meaning/u,
        playbookPath,
      );
    });
  });

  it("routes size, shape, and pure-DI findings without widening scope", () => {
    assertForPlaybook("gruff-code-quality.md", (content, playbookPath) => {
      assert.match(content, /documentation-caused size finding/u, playbookPath);
      assert.match(content, /do not trim requested meaning/u, playbookPath);
      assert.match(content, /do not smuggle in a file split/u, playbookPath);
      assert.match(
        content,
        /when the symbol is a public\/exported API/u,
        playbookPath,
      );
      assert.match(
        content,
        /file\/module\/class boundary has a non-obvious\s+contract/u,
        playbookPath,
      );
      assert.match(
        content,
        /block shape and the applicable formatter or fallback ceiling/u,
        playbookPath,
      );
      assert.match(
        content,
        /obvious non-null service-only constructor/u,
        playbookPath,
      );
      assert.match(
        content,
        /scalar, optional, configured, or side-effectful/u,
        playbookPath,
      );
    });
  });
});

describe("writing-style code-prose boundary", () => {
  it("separates code comments from replies to people", () => {
    assertForPlaybook("writing-style.md", (content, playbookPath) => {
      assert.doesNotMatch(
        content,
        /Comments and replies addressed to a person/u,
        playbookPath,
      );
      assert.match(
        content,
        /Review comments and replies to a person\s*\|\s*Correctness and residue only/u,
        playbookPath,
      );
      assert.match(
        content,
        /Code comments and docstrings\s*\|\s*No - see `code-comments\.md`/u,
        playbookPath,
      );
    });
  });

  it("treats code prose as a citation and substitution as suspicion only", () => {
    assertForPlaybook("writing-style.md", (content, playbookPath) => {
      assert.match(
        content,
        /prose describes code behaviour[\s\S]+function, query, or getter/u,
        playbookPath,
      );
      assert.match(content, /## Quick Tests/u, playbookPath);
      assert.match(content, /\*\*Substitution test\./u, playbookPath);
      assert.match(content, /raises suspicion, not proof/u, playbookPath);
    });
  });

  it("keeps examples correct and links the code-comment owner", () => {
    assertForPlaybook("writing-style.md", (content, playbookPath) => {
      assert.match(
        content,
        /exempt from stylistic rewriting, not correctness, syntax, or security/u,
        playbookPath,
      );
      assert.match(
        content,
        /`code-comments\.md` - code comments and docstrings/u,
        playbookPath,
      );
    });
  });
});

describe("shipped playbook portability", () => {
  it("excludes consumer-specific and ignored-feedback residue", () => {
    for (const playbookName of [
      "code-comments.md",
      "gruff-code-quality.md",
      "naming-and-placement.md",
      "writing-style.md",
    ]) {
      assertForPlaybook(playbookName, (content, playbookPath) => {
        assert.doesNotMatch(
          content,
          /https?:\/\/|#[0-9]{3,}|\/home\/|\.goat-flow\/(?:plans|scratchpad)\//u,
          playbookPath,
        );
      });
    }
  });
});
