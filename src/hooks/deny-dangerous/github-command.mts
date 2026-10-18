/** Classify GitHub CLI writes without executing gh, aliases, extensions or GraphQL subprocesses. */
import { createRequire } from "node:module";
import { asciiLowerCase } from "../policy-input.mjs";
import { splitPolicyTopLevelPipelineStages } from "../policy-segments.mjs";
import {
  isUnredirectedUnpipedPolicyReadOnly,
  stripPolicyShellRedirections,
  type PolicyReadOnlyContext,
} from "../policy-syntax.mjs";
import { splitPolicyShellWords } from "../policy-words.mjs";
import { normalizeGitPolicyCandidate } from "./git-command.mjs";
import { cobraBooleanFlagEnabled } from "./patterns-writes.mjs";

const graphql = createRequire(import.meta.url)("../gh-graphql-read.cjs") as {
  classify(rawStage: string, args: readonly string[]): number;
}; // -- The existing CommonJS classifier exports this synchronous contract.

const valueOptions = new Set(
  "--repo --hostname --cwd --config-dir --jq --template --cache --codespace --branch -R -H -q -c -b".split(
    " ",
  ),
);

/** Find a command level without mistaking a preceding option's value for its name. */
export function ghSkipOptionsIndex(
  words: readonly string[],
  start: number,
): number {
  let index = start;
  while (index < words.length) {
    const word = words[index] ?? "";
    if (word === "--") return index + 1;
    if (valueOptions.has(word)) index += 2;
    else if (word.startsWith("-")) index++;
    else break;
  }
  return index;
}

/** Decode one REST option while keeping its value out of the remaining flag scan. */
function restOption(
  word: string,
  next: string,
): { method?: string; body: boolean; consumed: number } {
  if (word === "-x" || word === "--method")
    return { method: asciiLowerCase(next), body: false, consumed: 1 };
  if (word.startsWith("-x"))
    return { method: word.slice(2), body: false, consumed: 0 };
  if (word.startsWith("--method="))
    return { method: word.slice(9), body: false, consumed: 0 };
  if (/^(?:-f|--field|--raw-field|--input)$/u.test(word))
    return { body: true, consumed: 1 };
  return {
    body: /^(?:-f.+|--(?:field|raw-field|input)=)/u.test(word),
    consumed: 0,
  };
}

/** Classify GraphQL before REST methods, because GET and body fields cannot prove a query safe. */
export function isGhApiWrite(
  words: readonly string[],
  start: number,
  rawStage: string,
): boolean {
  const classification = graphql.classify(rawStage, words.slice(start));
  if (classification !== 3) return classification !== 0;
  let method = "";
  let hasBody = false;
  for (let index = start; index < words.length; index++) {
    const option = restOption(
      asciiLowerCase(words[index] ?? ""),
      words[index + 1] ?? "",
    );
    if (option.method !== undefined) method = option.method;
    hasBody ||= option.body;
    index += option.consumed;
  }
  return method === "" ? hasBody : !["get", "head"].includes(method);
}

const booleanValues = new Map([
  ["", true],
  ["1", true],
  ["t", true],
  ["T", true],
  ["true", true],
  ["TRUE", true],
  ["True", true],
  ["0", false],
  ["f", false],
  ["F", false],
  ["false", false],
  ["FALSE", false],
  ["False", false],
]);
const publishValues = new Set(
  "--tag --repo --hostname --cwd --config-dir -R -H".split(" "),
);
const publishAttached =
  /^(?:--(?:tag|repo|hostname|cwd|config-dir)=|-[RH].+|--no-pager$)/su;

function publishBoolean(word: string): { name: string; value: boolean } | null {
  const match = /^(--dry-run|--fix)(?:=(.*))?$/su.exec(word);
  if (!match) return null;
  const value = booleanValues.get(match[2] ?? "");
  return value === undefined ? null : { name: match[1] ?? "", value };
}

/** Require the last dry-run value and no enabled fix flag across all command levels. */
export function ghSkillPublishIsDryRun(
  words: readonly string[],
  topicIndex: number,
  commandIndex: number,
): boolean {
  const flags = new Map([
    ["--dry-run", false],
    ["--fix", false],
  ]);
  for (let index = 1; index < words.length; index++) {
    if ([topicIndex, commandIndex].includes(index)) continue;
    const word = words[index] ?? "";
    if (word === "--") break;
    const flag = publishBoolean(word);
    if (flag) flags.set(flag.name, flag.value);
    else if (publishValues.has(word)) index++;
    else if (!publishAttached.test(word) && word.startsWith("-")) return false;
  }
  return flags.get("--dry-run") === true && flags.get("--fix") === false;
}

const sshValues = new Set(
  "-c --codespace -R --repo --repo-owner -p --profile --server-port".split(" "),
);
const sshAttached =
  /^(?:-[cRp].+|--(?:codespace|repo|repo-owner|profile|server-port)=)/su;

/** Only configuration output is a read; an interactive or command-bearing SSH session may write. */
export function ghCodespaceSshIsConfigOnly(
  words: readonly string[],
  start: number,
): boolean {
  let seenConfig = false;
  for (let index = start; index < words.length; index++) {
    const word = words[index] ?? "";
    if (word === "--config") seenConfig = true;
    else if (sshValues.has(word)) {
      if (++index >= words.length) return false;
    } else if (!sshAttached.test(word)) return false;
  }
  return seenConfig;
}

const builtinTopics = new Set(
  "agent-task alias api attestation auth browse cache codespace completion config copilot discussion extension gist gpg-key help issue label licenses org pr preview project release repo ruleset run search secret skill ssh-key status variable version workflow actions environment exit-codes formatting mintty reference".split(
    " ",
  ),
);
const topicAliases = new Map([
  ["cs", "codespace"],
  ["ext", "extension"],
  ["extensions", "extension"],
  ["agent", "agent-task"],
  ["agents", "agent-task"],
  ["agent-tasks", "agent-task"],
  ["skills", "skill"],
  ["at", "attestation"],
  ["rs", "ruleset"],
]);

export function isGhBuiltinTopic(topic: string): boolean {
  return builtinTopics.has(topic);
}

const writes = new Map(
  Object.entries({
    issue:
      "create new close reopen edit delete lock unlock pin unpin transfer develop",
    pr: "create new review merge close reopen edit ready update-branch lock unlock revert",
    release: "create new upload delete edit delete-asset",
    discussion: "create edit comment",
    "agent-task": "create",
    repo: "create new delete edit fork rename archive unarchive sync set-default",
    label: "create delete edit clone",
    workflow: "run disable enable",
    run: "rerun cancel delete",
    gist: "create new edit delete rename",
    secret: "set remove delete",
    variable: "set delete remove",
    "ssh-key": "add delete",
    "gpg-key": "add delete",
    auth: "login logout refresh setup-git switch",
    alias: "set import delete",
    config: "set",
    codespace: "create delete edit stop rebuild",
    extension: "install remove upgrade",
    project:
      "create delete edit close copy link unlink mark-template field-create field-delete field-update item-add item-archive item-create item-delete item-edit",
    cache: "delete",
  }).map(([topic, commands]) => [topic, new Set(commands.split(" "))]),
);
const nestedWrites = new Set([
  "repo:deploy-key:add",
  "repo:deploy-key:delete",
  "repo:autolink:create",
  "repo:autolink:delete",
  "codespace:ports:visibility",
]);

interface GhOperation {
  write: boolean;
  uninspectable: boolean;
}

function ghCheckoutWrites(words: readonly string[]): boolean {
  const enabled = (long: string, short: string) =>
    cobraBooleanFlagEnabled(
      words,
      long,
      short,
      "--branch --repo --hostname --cwd --config-dir",
      "bRH",
    );
  return (
    !enabled("help", "h") && !enabled("detach", "") && enabled("force", "f")
  );
}

function ghCodespaceWrites(
  key: string,
  words: readonly string[],
  commandIndex: number,
): boolean {
  if (words.length === commandIndex + 2 && words[commandIndex + 1] === "--help")
    return false;
  return (
    key === "codespace:cp" ||
    !ghCodespaceSshIsConfigOnly(words, commandIndex + 1)
  );
}

/** Preserve read exceptions for help, detached checkout and config-only SSH. */
function ghSpecialWrite(
  topic: string,
  subcommand: string,
  words: readonly string[],
  topicIndex: number,
  commandIndex: number,
): boolean | null {
  const key = topic + ":" + subcommand;
  switch (key) {
    case "pr:checkout":
    case "pr:co":
      return ghCheckoutWrites(words);
    case "codespace:cp":
    case "codespace:ssh":
      return ghCodespaceWrites(key, words, commandIndex);
    case "skill:publish":
      return !ghSkillPublishIsDryRun(words, topicIndex, commandIndex);
    case "extension:browse":
      return !cobraBooleanFlagEnabled(
        words,
        "help",
        "h",
        "--repo --hostname --cwd --config-dir",
        "RH",
      );
    case "extension:exec":
      return true;
    default:
      return null;
  }
}

function ghNamedWrite(
  topic: string,
  subcommand: string,
  nested: string,
): boolean {
  return (
    writes.get(topic)?.has(subcommand) === true ||
    nestedWrites.has(`${topic}:${subcommand}:${nested}`)
  );
}

/** Keep topic matching case-sensitive while subcommands retain the reference's ASCII folding. */
function classifyGhWords(
  words: readonly string[],
  rawStage: string,
): GhOperation {
  const topicIndex = ghSkipOptionsIndex(words, 1);
  const rawTopic = words[topicIndex] ?? "";
  if (/^(?:$|-)/u.test(rawTopic)) return { write: false, uninspectable: false };
  const topic = topicAliases.get(rawTopic) ?? rawTopic;
  if (!isGhBuiltinTopic(topic)) return { write: true, uninspectable: true };
  if (topic === "api")
    return {
      write: isGhApiWrite(words, topicIndex + 1, rawStage),
      uninspectable: false,
    };
  const commandIndex = ghSkipOptionsIndex(words, topicIndex + 1);
  const subcommand = asciiLowerCase(words[commandIndex] ?? "");
  const nestedIndex = ghSkipOptionsIndex(words, commandIndex + 1);
  const nested = asciiLowerCase(words[nestedIndex] ?? "");
  const special = ghSpecialWrite(
    topic,
    subcommand,
    words,
    topicIndex,
    commandIndex,
  );
  return {
    write: special ?? ghNamedWrite(topic, subcommand, nested),
    uninspectable: topic === "extension" && subcommand === "exec",
  };
}

/** Retain the refusal reason separately from the Boolean write decision. */
export function inspectGhWriteOperation(command: string): GhOperation {
  const normalized = normalizeGitPolicyCandidate(command);
  if (normalized === null) return { write: true, uninspectable: false };
  const initialWords = splitPolicyShellWords(normalized);
  const executable = initialWords[0] ?? "";
  if (executable.slice(executable.lastIndexOf("/") + 1) !== "gh")
    return { write: false, uninspectable: false };
  const stripped = stripPolicyShellRedirections(normalized);
  if (stripped === null) return { write: true, uninspectable: false };
  return classifyGhWords(splitPolicyShellWords(stripped), stripped);
}

export function isGhWriteOperation(command: string): boolean {
  return inspectGhWriteOperation(command).write;
}

/** Inspect every GitHub pipeline stage under the repository-write switch. */
export function checkRepositorySegment(
  command: string,
  context: PolicyReadOnlyContext,
): string | null {
  if (isUnredirectedUnpipedPolicyReadOnly(command, context)) return null;
  const stages = splitPolicyTopLevelPipelineStages(command);
  if (stages.kind === "unresolved") return stages.reason;
  for (const stage of stages.segments) {
    const operation = inspectGhWriteOperation(stage);
    if (!operation.write) continue;
    return operation.uninspectable
      ? "Cannot inspect a gh alias or extension. Run the built-in gh command instead, or ask the user to run it manually."
      : "GitHub write via gh is blocked by Deny Git and GitHub writes. Draft the change for the user to perform; conversational approval does not bypass this hook.";
  }
  return null;
}
