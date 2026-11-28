/** Reads native sub-agent transcripts for the host-run skill checks. */
import { createHash } from "node:crypto";
import { basename, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  citedCommentAnchor,
  citedSourcePath,
  citationEntryPath,
} from "../fixtures/cited-comment/build.mjs";
import { stagedDiscountPath } from "../fixtures/staged-review/build.mjs";

function parseLine(line, index) {
  try {
    return JSON.parse(line);
  } catch {
    throw new Error(`Malformed transcript JSON on line ${index + 1}`);
  }
}

function recordToolBlocks(blocks, type, calls, results) {
  for (const block of blocks) {
    if (type === "assistant" && block?.type === "tool_use") {
      if (typeof block.id !== "string" || typeof block.name !== "string") {
        throw new Error("Transcript tool call has no ID or name");
      }
      const previous = calls.get(block.id);
      if (previous && previous.name !== block.name) {
        throw new Error("Transcript contains conflicting tool IDs");
      }
      calls.set(block.id, block);
    }
    if (type === "user" && block?.type === "tool_result") {
      results.set(block.tool_use_id, block);
    }
  }
}

function readEvents(jsonl) {
  const calls = new Map();
  const results = new Map();
  const agentIds = new Set();
  const prompts = [];

  for (const [index, line] of jsonl.split(/\r?\n/u).entries()) {
    if (!line.trim()) continue;
    const event = parseLine(line, index);
    if (event?.type !== "assistant" && event?.type !== "user") continue;

    if (event.agentId) agentIds.add(event.agentId);
    const content = event.message?.content;
    if (event.type === "user" && typeof content === "string")
      prompts.push(content);
    if (Array.isArray(content))
      recordToolBlocks(content, event.type, calls, results);
  }
  return { calls, results, agentIds, prompts };
}

/**
 * Extracts actual calls, successful reads, and the report delivered to the host.
 * @param {string} jsonl One native sub-agent's transcript.
 * @throws If the transcript cannot identify one agent and one completed hand-back.
 */
export function readTranscript(jsonl) {
  const { calls, results, agentIds, prompts } = readEvents(jsonl);
  const [agentId] = agentIds;
  if (agentIds.size !== 1 || typeof agentId !== "string") {
    throw new Error("Transcript must identify one native sub-agent");
  }
  const used = [...calls.values()];
  const successful = used.filter(
    ({ id }) => results.has(id) && !results.get(id).is_error,
  );
  const delivered = successful.filter(
    ({ name }) => name === "SubagentHandback",
  );
  const report = delivered[0]?.input?.message;
  if (delivered.length !== 1 || typeof report !== "string" || !report.trim()) {
    throw new Error(
      "Transcript must contain one completed hand-back with a report",
    );
  }
  return {
    agentId,
    prompts,
    reads: successful
      .filter(({ name }) => name === "Read")
      .map(({ id, input }) => ({ input, content: results.get(id).content })),
    report,
    toolCalls: calls.size,
    agentCalls: used.filter(({ name }) => name === "Agent").length,
  };
}

/** Projects one native Codex agent's completed rollout into scoring evidence.
 * @param {string} jsonl The native sub-agent's rollout.
 * @param {string} agentHandle The task path returned by the host's spawn call.
 * @throws If the agent handle or completed answer cannot be verified.
 */
export function readCodexTranscript(jsonl, agentHandle) {
  const events = jsonl
    .split(/\r?\n/u)
    .map((line, index) => (line.trim() ? parseLine(line, index) : null))
    .filter(Boolean);
  const [session, ...otherSessions] = events
    .filter((event) => event.type === "session_meta")
    .map((event) => event.payload);
  const spawn = session?.source?.subagent?.thread_spawn;
  if (
    !agentHandle ||
    !spawn?.parent_thread_id ||
    session.agent_path !== agentHandle ||
    typeof session.id !== "string" ||
    otherSessions.length > 0
  ) {
    throw new Error("Codex transcript must match the spawned agent handle");
  }

  const responses = events
    .filter((event) => event.type === "response_item")
    .map((event) => event.payload);
  const messages = events
    .filter((event) => event.type === "event_msg")
    .map((event) => event.payload);
  const { answer, completion } = codexCompletion(responses, messages);
  const cutoff = events.findIndex(
    ({ payload }) => payload === answer || payload === completion,
  );
  const evidence = events.slice(0, cutoff);
  const calls = new Map(
    evidence
      .filter((event) => event.type === "response_item")
      .map((event) => event.payload)
      .filter(
        (item) =>
          item.type === "function_call" || item.type === "custom_tool_call",
      )
      .map((item) => [item.call_id, item.name]),
  );
  const commands = evidence
    .filter((event) => event.type === "event_msg")
    .map((event) => event.payload)
    .filter((message) => message.type === "item_completed")
    .map((message) => message.item)
    .filter((item) => item?.type === "CommandExecution")
    .map((item) => ({
      ...item,
      cwd: item.cwd?.startsWith("file:") ? fileURLToPath(item.cwd) : item.cwd,
    }));
  return {
    agentId: session.id,
    commands,
    report: completion.last_agent_message,
    toolCalls: calls.size,
    agentCalls: [...calls.values()].filter((name) => name === "spawn_agent")
      .length,
    durationMs: completion.duration_ms,
    usage: messages.findLast((message) => message.type === "token_count")?.info
      ?.total_token_usage,
  };
}

/** Match both delivery boundaries. Throws if they disagree or the rollout contains more than one answer. */
function codexCompletion(responses, messages) {
  const reports = responses.filter(
    (item) =>
      item.type === "message" &&
      item.role === "assistant" &&
      item.phase === "final_answer",
  );
  const completions = messages.filter(
    (message) => message.type === "task_complete",
  );
  const report = completions[0]?.last_agent_message;
  const completedAnswer = reports[0]?.content
    ?.map((part) => part.text)
    .join("");
  if (
    reports.length !== 1 ||
    completions.length !== 1 ||
    typeof report !== "string" ||
    !report.trim() ||
    completedAnswer?.trim() !== report.trim()
  ) {
    throw new Error("Codex transcript must contain one completed final answer");
  }
  return { answer: reports[0], completion: completions[0] };
}

const npmTest = String.raw`(?:[A-Za-z_]\w*=[^\s;&|]+[ \t]+)*npm[ \t]+(?:run[ \t]+)?test`;
const testInvocation = new RegExp(
  String.raw`(?:^|[;&\n])\s*${npmTest}(?=[\s;&|]|$)`,
  "u",
);
const standaloneTest = new RegExp(String.raw`^\s*${npmTest}\s*$`, "u");
// A compound command can continue after the suite fails. Require the status
// print to capture the immediately preceding npm invocation.
const capturedTestExit = new RegExp(
  String.raw`(?:^|\n)[ \t]*${npmTest}[ \t]*\n[ \t]*([\w]+)=\$\?\n[ \t]*printf '[^'\n]*npm test exit(?: (?:code|status))?: %s[^'\n]*' "\$\1"`,
  "u",
);

/**
 * Checks the target command record for the seeded QA failure.
 * @param {object[]} commands - Completed commands from the sample rollout.
 * @param {string} project - Selected fixture root.
 * @param {string|undefined} assertion - Exact assertion text when required.
 */
export function recordedRequiredQaFailure(commands, project, assertion) {
  return commands?.some((item) => {
    if (item.cwd !== project) return false;
    const command = item.command?.at(-1) ?? "";
    const output = item.aggregated_output ?? "";
    if (
      !testInvocation.test(command) ||
      !/^[ \t]*not ok \d+ - rounds half a cent up with SAVE10\b/imu.test(
        output,
      ) ||
      (assertion && !output.includes(assertion))
    )
      return false;
    return (
      (standaloneTest.test(command) && item.exit_code === 1) ||
      (capturedTestExit.test(command) &&
        /^[ \t]*npm test exit(?: (?:code|status))?:\s*1[ \t]*$/imu.test(output))
    );
  });
}

/**
 * Checks direct timer starts for the blocked milestone, including rejected or reverted starts.
 * @param {object[]} commands - Completed commands from the sample rollout.
 * @param {string} milestone - Absolute path of the blocked milestone.
 */
export function recordedMilestoneTimerStart(commands, milestone) {
  const invocation =
    /(?:^|[;&|\n])\s*(?:(?:[^\s;&|]*\/)?goat-flow|node\s+[^\n;&|]*?\bcli\.ts["']?)\s+plans\s+time\s+start\s+(?:"([^"]+)"|'([^']+)'|([^\s;&|]+))/gu;
  let hasUnresolvedTarget = false;
  for (const { command, cwd } of commands) {
    const shell = command?.at(-1) ?? "";
    for (const match of shell.matchAll(invocation)) {
      const [, doubleQuoted, singleQuoted, bare] = match;
      const target = doubleQuoted ?? singleQuoted ?? bare;
      if (basename(target) !== basename(milestone)) continue;
      const changesDirectory =
        /(?:^|[;&|\n()])\s*(?:cd|pushd|popd)(?=[ \t;&|\n)]|$)/u.test(
          shell.slice(0, match.index),
        );
      if (!isAbsolute(target) && (!cwd || changesDirectory)) {
        hasUnresolvedTarget = true;
      } else if (resolve(cwd ?? "", target) === milestone) {
        return true;
      }
    }
  }
  return hasUnresolvedTarget ? undefined : false;
}

/**
 * Confirms a successful Claude Read covered every line of the prepared owner.
 * @param {object[]} reads - Successful Read calls and their returned text.
 * @param {string} owner - Absolute prepared owner path.
 * @param {string} contents - Prepared owner text.
 */
export function recordedClaudeOwnerRead(reads, owner, contents) {
  const expected = contents.replace(/\r?\n$/u, "").split(/\r?\n/u);
  return reads.some(({ input, content }) => {
    if (
      input?.file_path !== owner ||
      (input.offset !== undefined && input.offset !== 1) ||
      (input.limit !== undefined && input.limit < expected.length)
    )
      return false;
    const output = Array.isArray(content)
      ? content
          .filter((block) => block.type === "text")
          .map((block) => block.text)
          .join("\n")
      : content;
    if (typeof output !== "string") return false;
    const lines = output.split(/\r?\n/u);
    return expected.every((line, index) => {
      const actual = lines[index];
      if (actual === line) return true;
      const numbered = /^[ \t]*(\d+)[ \t]*(?:\t|→)(.*)$/u.exec(actual ?? "");
      return Number(numbered?.[1]) === index + 1 && numbered?.[2] === line;
    });
  });
}

/**
 * Binds a full owner read to the prepared path in the command's working directory.
 * @param {object[]} commands - Completed Codex commands.
 * @param {string} owner - Absolute path to the prepared owner file.
 * @param {string} contents - Complete prepared owner text.
 */
export function recordedPreparedOwnerRead(commands, owner, contents) {
  const shellWord = /(?:[^\s;&|<>"']+|"[^"]*"|'[^']*')+/gu;
  return commands.some(({ cwd, exit_code, command, aggregated_output }) => {
    if (exit_code !== 0 || !aggregated_output?.includes(contents)) return false;
    const paths = new Set([owner]);
    if (typeof cwd === "string") {
      const fromCwd = relative(cwd, owner);
      if (fromCwd) {
        paths.add(fromCwd);
        paths.add("./" + fromCwd);
      }
    }
    return command?.some(
      (part) =>
        paths.has(part) ||
        part
          .match(shellWord)
          ?.some((word) => paths.has(word.replace(/^(["'])(.*)\1$/su, "$2"))),
    );
  });
}

/** Matches a complete snapshot emitted before any later command in the same shell call. */
function containsStagedSnapshot(output, baseline) {
  return output?.split("\n").some((line) => {
    if (!line.startsWith('{"authority":')) return false;
    try {
      const { authority } = JSON.parse(line);
      return (
        authority?.schema === "goat-review-authority/v1" &&
        authority.source?.kind === "staged" &&
        authority.fingerprint === baseline.fingerprint &&
        Array.isArray(authority.inventory) &&
        authority.inventory.some(
          ({ path, new: source }) =>
            path === stagedDiscountPath &&
            source?.from === "index" &&
            source.blob === baseline.blob,
        )
      );
    } catch {
      return false;
    }
  });
}

/**
 * Checks the prepared staged authority and the bytes actually read from it.
 * @param {object[]} commands - Completed commands from the sample rollout.
 * @param {string} project - Selected fixture root.
 * @param {object} baseline - Prepared fingerprint and staged source blob.
 */
export function recordedStagedReviewEvidence(commands, project, baseline) {
  const local = (commands ?? []).filter(({ cwd }) => cwd === project);
  const stageRead =
    /^\s*git(?:\s+--no-pager)?\s+show\s+["']?:(?:0:)?src\/discount\.mjs["']?\s*$/u;
  return {
    reviewStagedSnapshotObserved: local.some(
      ({ command, aggregated_output }) =>
        /\breview\s+snapshot\b/u.test(command?.at(-1) ?? "") &&
        containsStagedSnapshot(aggregated_output, baseline),
    ),
    reviewStagedSourceObserved: local.some(
      ({ command, aggregated_output, exit_code }) => {
        if (exit_code !== 0) return false;
        const shell = command?.at(-1) ?? "";
        const blobRead = /^\s*git\s+cat-file\s+-p\s+([a-f0-9]+)\s*$/u.exec(
          shell,
        );
        const algorithm = baseline.blob.length === 64 ? "sha256" : "sha1";
        const output = aggregated_output ?? "";
        const blob = createHash(algorithm)
          .update(`blob ${Buffer.byteLength(output)}\0`)
          .update(output)
          .digest("hex");
        return (
          (stageRead.test(shell) || blobRead?.[1] === baseline.blob) &&
          blob === baseline.blob
        );
      },
    ),
  };
}

/**
 * Checks for an actual citation read, using the entry's source and search anchor.
 * @param {object[]} commands - Completed commands from the sample rollout.
 * @param {string} project - Selected fixture root.
 */
export function recordedCitedComment(commands, project) {
  const searchAnchor = '(search: "' + citedCommentAnchor + '")';
  const entry = resolve(project, citationEntryPath);
  return (commands ?? []).some((item) => {
    const { cwd, command, aggregated_output } = item;
    const shell = command?.join(" ");
    return (
      cwd === project &&
      /(?:^|\s)(?:cat|sed|rg|grep|head|tail)[ \t]+/u.test(shell ?? "") &&
      aggregated_output?.includes(citedSourcePath) &&
      recordedPreparedOwnerRead([item], entry, searchAnchor)
    );
  });
}

/**
 * Requires the pinned Git selector and the actual baseline bytes in one read.
 * @param {object[]} commands - Completed commands from the sample rollout.
 * @param {string} project - Selected fixture root.
 * @param {object} baseline - Host-pinned revision and file path.
 * @param {string} policy - Complete bytes of the pinned policy as UTF-8.
 */
export function recordedTrustedPolicyRead(commands, project, baseline, policy) {
  const selector = baseline.base + ":" + baseline.path;
  return (commands ?? []).some(
    ({ cwd, exit_code, command, aggregated_output }) => {
      const shell = command?.join(" ") ?? "";
      return (
        cwd === project &&
        exit_code === 0 &&
        /\bgit\b/u.test(shell) &&
        /\b(?:show|cat-file)\b/u.test(shell) &&
        shell.includes(selector) &&
        containsTrustedPolicyOutput(aggregated_output, selector, policy)
      );
    },
  );
}

/** Checks raw policy output or a bounded JSON record containing the same full bytes. */
function containsTrustedPolicyOutput(output, selector, policy) {
  if (output === policy) return true;
  if (!output?.trimStart().startsWith("{")) return false;
  try {
    const fields = Object.values(JSON.parse(output));
    return fields.includes(selector) && fields.includes(policy);
  } catch {
    return false;
  }
}
