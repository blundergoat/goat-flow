/** Checks the saved skill evaluation against M03 evidence and invalid inputs. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { scoreSample, validateCase } from "../../evals/lib/case.mjs";
import {
  readCodexTranscript,
  readTranscript,
} from "../../evals/lib/transcript.mjs";

// Minimal projections of M03's critique-4a pass and critique failure
// (search: "All critique-request runs" in run-critique-4-score.md).
// Identifiers and tool parameters were removed or replaced.
const metadata = '{"type":"api-request-shape","tools":[{"name":"Agent"}]}';
const passedReport =
  "## goat-critique stopped after Step 0: control goes back to the host before Phase 1";
const failedReport =
  "I ran `/goat-critique` on `docs/briefs/loyalty-points.md` through Phases 1-3 and stopped at the Phase 4 blocking gate.";

function tool(id: string, name: string, input = {}) {
  return JSON.stringify({
    type: "assistant",
    agentId: "m03-excerpt",
    message: { content: [{ type: "tool_use", id, name, input }] },
  });
}

const acknowledgement = JSON.stringify({
  type: "user",
  agentId: "m03-excerpt",
  message: { content: [{ type: "tool_result", tool_use_id: "handback" }] },
});
const passed = [
  metadata,
  tool("handback", "SubagentHandback", { message: passedReport }),
  acknowledgement,
];
const failed = [
  metadata,
  tool("critic-a", "Agent"),
  tool("critic-b", "Agent"),
  tool("critic-c", "Agent"),
  tool("handback", "SubagentHandback", { message: failedReport }),
  acknowledgement,
];

test("M03 transcript excerpts distinguish hand-back from spawning critics", () => {
  const pass = readTranscript(passed.join("\n"));
  assert.equal(pass.agentCalls, 0);
  assert.equal(pass.report, passedReport);

  const fail = readTranscript(failed.join("\n"));
  assert.equal(fail.agentCalls, 3);
  assert.equal(fail.report, failedReport);
  assert.equal(fail.toolCalls, fail.agentCalls + 1); // The report delivery is also a tool call.
});

const caseId = "critique-handback";

test("Codex evidence binds the agent handle and decodes the recorded command cwd", () => {
  // Minimal projection of M11's first native Codex sample, with IDs and paths replaced.
  const handle = "/root/m11_sample_1";
  const project = join(tmpdir(), "eval sample", "project");
  const report =
    "I completed Step 0 and returned control to the host before Phase 1.";
  const transcript = [
    {
      type: "session_meta",
      payload: {
        id: "sample-1",
        agent_path: handle,
        source: { subagent: { thread_spawn: { parent_thread_id: "host" } } },
      },
    },
    {
      type: "response_item",
      payload: { type: "custom_tool_call", name: "exec", call_id: "read" },
    },
    {
      type: "event_msg",
      payload: {
        type: "item_completed",
        item: {
          type: "CommandExecution",
          exit_code: 0,
          cwd: pathToFileURL(project).href,
        },
      },
    },
    {
      type: "response_item",
      payload: {
        type: "message",
        role: "assistant",
        phase: "final_answer",
        content: [{ text: report }],
      },
    },
    {
      type: "event_msg",
      payload: { type: "task_complete", last_agent_message: report },
    },
  ];
  const jsonl = transcript.map((event) => JSON.stringify(event)).join("\n");
  const sample = readCodexTranscript(jsonl, handle);
  assert.equal(sample.agentCalls, 0);
  assert.equal(sample.report, report);
  assert.equal(sample.commands[0].cwd, project);
  assert.throws(
    () => readCodexTranscript(jsonl, "/root/m11_sample_2"),
    /agent handle/,
  );
  assert.throws(
    () =>
      readCodexTranscript(
        transcript
          .slice(0, -1)
          .map((event) => JSON.stringify(event))
          .join("\n"),
        handle,
      ),
    /completed final answer/,
  );
});
const caseFile = new URL(
  "../../evals/cases/critique-handback/case.json",
  import.meta.url,
);
const definition = validateCase(
  JSON.parse(readFileSync(caseFile, "utf8")),
  caseId,
);

test("invalid case paths and unverifiable rows fail validation", () => {
  assert.throws(
    () => validateCase(definition, "../critique-handback"),
    /Invalid case/,
  );
  assert.throws(
    () =>
      validateCase(
        { ...definition, owners: ["workflow/skills/../secrets.md"] },
        caseId,
      ),
    /owner paths/,
  );
  assert.throws(
    () =>
      validateCase(
        {
          ...definition,
          rows: [
            {
              id: "report-says-it-passed",
              kind: "mechanical",
              label: "Result",
            },
          ],
        },
        caseId,
      ),
    /Unknown mechanical check/,
  );
});

test("a claimed hand-back fails when the transcript records a spawn", () => {
  const sample = {
    projectUnchanged: true,
    harnessStatusUnchanged: true,
    report: passedReport,
  };
  assert.equal(
    scoreSample(definition, { ...sample, agentCalls: 0 }).status,
    "pass",
  );
  const failure = scoreSample(definition, { ...sample, agentCalls: 3 });
  assert.equal(failure.status, "fail");
  assert.deepEqual(
    failure.rows.filter((row) => !row.passed).map((row) => row.id),
    ["no-agent-calls"],
  );
  assert.equal(scoreSample(definition, null).status, "missing");
  assert.equal(scoreSample(definition, { invalid: true }).status, "invalid");
  assert.equal(
    scoreSample(definition, { ...sample, inconclusive: true }).status,
    "inconclusive",
  );
});

test("quoted hand-back wording and the trial appendix provide no hand-back evidence", () => {
  const sample = {
    projectUnchanged: true,
    harnessStatusUnchanged: true,
    agentCalls: 0,
  };
  for (const report of [
    `The skill says "${passedReport}" but I proceeded to critique.`,
    `The report is incomplete.\n\n## Trial appendix\n\n${passedReport}`,
  ]) {
    const result = scoreSample(definition, { ...sample, report });
    assert.deepEqual(
      result.rows.filter((row) => !row.passed).map((row) => row.id),
      ["host-hand-back"],
    );
  }
});

test("repeated events count once and missing hand-back confirmation is invalid", () => {
  const repeated = [...failed, tool("critic-a", "Agent")];
  assert.equal(readTranscript(repeated.join("\n")).agentCalls, 3);
  assert.throws(
    () => readTranscript(passed.slice(0, -1).join("\n")),
    /completed hand-back/,
  );
  assert.throws(() => readTranscript("broken"), /line 1/);
});
