/** Prepares, collects and scores skill samples launched by a maintainer. */
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual, parseArgs } from "node:util";
import { buildCheckout, hashProject } from "./fixtures/checkout/build.mjs";
import {
  buildCitedComment,
  citedSourcePath,
  compareCitedComment,
} from "./fixtures/cited-comment/build.mjs";
import {
  blockedMilestonePath,
  buildMilestoneOrder,
} from "./fixtures/milestone-order/build.mjs";
import {
  buildPolicyAuthority,
  readTrustedPolicy,
  trustedPolicyBase,
  trustedPolicyPath,
} from "./fixtures/policy-authority/build.mjs";
import { applyQaChange, buildQaProject } from "./fixtures/qa-project/build.mjs";
import {
  buildStagedReview,
  correctUnstagedDiscount,
  stagedDiscountPath,
} from "./fixtures/staged-review/build.mjs";
import { isId, scoreSamples, validateCase } from "./lib/case.mjs";
import {
  readCodexTranscript,
  readTranscript,
  recordedCitedComment,
  recordedMilestoneTimerStart,
  recordedPreparedOwnerRead,
  recordedRequiredQaFailure,
  recordedStagedReviewEvidence,
  recordedTrustedPolicyRead,
} from "./lib/transcript.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const resultsRoot = join(root, ".goat-flow/logs/evals");
const sampleCount = 3;
const sourceCli = join(root, "src/cli/cli.ts");
// The selected repository and its index come from cwd or --project.
const gitEnv = Object.fromEntries(
  Object.entries(process.env).filter(([name]) => !/^GIT_/iu.test(name)),
);

function git(cwd, ...args) {
  return execFileSync("git", args, {
    cwd,
    env: gitEnv,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function gitStatus() {
  return git(root, "status", "--short", "--untracked-files=all");
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function writeJson(path, record) {
  writeFileSync(path, JSON.stringify(record, null, 2) + "\n", { flag: "wx" });
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function makePrompt(runId, sample, project, owners, definition, harness) {
  const [skill, preamble] = definition.owners;
  return [
    `Eval sample: ${runId}/${sample}`,
    "",
    "You are a native sub-agent of this session's host. Do the requested work.",
    `Read ${join(owners, skill)} and ${join(owners, preamble)} in full before acting.`,
    `For referenced owner files use the same repository paths under ${owners}.`,
    harness === "codex"
      ? "Use a read-only shell command to read the supplied copies directly. Use at most five tool calls. Return the final report to the host."
      : "Load the supplied copies directly with Read. Do not invoke Skill to load the live copy.",
    `The selected synthetic project is ${project}. Work from that project root.`,
    ...(definition.fixture === "milestone-order"
      ? [
          `The matching source CLI is ${sourceCli}. Invoke it with node --import tsx from the selected project.`,
        ]
      : []),
    ...(definition.fixture === "staged-review"
      ? [
          `The matching source CLI is ${sourceCli}. From the selected project, use node --import tsx with that entry point and --expected-version ${readJson(join(root, "package.json")).version}.`,
          "A staged snapshot request is available at ../staged-request.json. Keep the snapshot in command output and put generated review evidence outside the project in the sample directory.",
        ]
      : []),
    ...(definition.fixture === "cited-comment"
      ? [
          "The matching source CLI is " +
            sourceCli +
            ". Invoke it with node --import tsx from the selected project for version-matched commands, including redact.",
        ]
      : []),
    ...(definition.fixture === "policy-authority"
      ? [
          "The host pinned trusted base " +
            trustedPolicyBase +
            " for this local fixture before preparing the candidate. HEAD is unborn. The independent base is the supplied OID. The index holds the base policy and the worktree holds the proposed change.",
          "This fixture uses a new Git directory with no remotes, includes, or alternates. For your trusted policy read, use the literal selector " +
            trustedPolicyBase +
            ":" +
            trustedPolicyPath +
            " and leave the policy bytes visible in command output. Scope Git and filesystem inventory to that single policy path. Other directory entries in the base's tree metadata are outside the fixture review.",
        ]
      : []),
    definition.fixture === "cited-comment"
      ? "The fixture has a local learning loop. Use the selected project's own indexes and entries. Do not search the harness's records."
      : "The fixture has no learning loop. Record a retrieval miss if required. Do not search the harness's records.",
    "No human answers are available. If you reach questions or a gate, return them as your answer.",
    ...(definition.stopAfterRouting
      ? [
          "Return the dispatcher's Route Snapshot and stop before loading or running a destination skill.",
        ]
      : []),
    "",
    "User request",
    "",
    definition.request,
    "",
    "Return your answer to the host. Describe what you did and where you stopped.",
    "",
  ].join("\n");
}

/**
 * Writes the corrected working-tree copy and records the distinct staged authority.
 * Stops preparation if the snapshot cannot bind the staged discount blob.
 */
function prepareStagedReviewEvidence(sampleDir, project) {
  correctUnstagedDiscount(project);
  const index = git(project, "ls-files", "--stage", "-z");
  const snapshot = execFileSync(
    process.execPath,
    [
      "--import",
      "tsx",
      sourceCli,
      "review",
      "snapshot",
      join(sampleDir, "staged-request.json"),
      "--project",
      project,
      "--expected-version",
      readJson(join(root, "package.json")).version,
    ],
    { cwd: root, env: gitEnv, encoding: "utf8" },
  );
  const authority = JSON.parse(snapshot).authority;
  const blob = git(project, "rev-parse", ":" + stagedDiscountPath).trim();
  if (
    authority.source.kind !== "staged" ||
    !authority.inventory.some(
      ({ path, new: file }) =>
        path === stagedDiscountPath &&
        file.from === "index" &&
        file.blob === blob,
    )
  )
    throw new Error(
      "Prepared review authority does not bind the staged discount",
    );
  writeJson(join(sampleDir, "staged-before.json"), {
    index,
    blob,
    fingerprint: authority.fingerprint,
  });
}

function prepareSample(
  runId,
  directory,
  sample,
  definition,
  ownerBytes,
  harness,
) {
  const sampleDir = join(directory, `sample-${sample}`);
  const project = join(sampleDir, "project");
  const owners = join(sampleDir, "owners");
  let preparedPolicy;
  if (definition.fixture === "qa-project") {
    buildQaProject(project, {
      shouldRecordTestLoads: definition.id !== "debug-rounding-gate",
    });
  } else if (definition.fixture === "milestone-order") {
    buildMilestoneOrder(project);
  } else if (definition.fixture === "staged-review") {
    buildStagedReview(project);
  } else if (definition.fixture === "cited-comment") {
    buildCitedComment(project);
    writeJson(
      join(sampleDir, "cited-source-before.json"),
      readFileSync(join(project, citedSourcePath), "utf8"),
    );
  } else if (definition.fixture === "policy-authority") {
    preparedPolicy = buildPolicyAuthority(project, root);
  } else {
    buildCheckout(project);
  }
  if (preparedPolicy) {
    writeJson(join(sampleDir, "policy-before.json"), preparedPolicy);
  } else {
    git(project, "init", "-q");
    git(project, "add", "--all");
  }
  if (definition.fixture === "qa-project")
    applyQaChange(project, definition.variant);
  if (definition.fixture === "staged-review")
    prepareStagedReviewEvidence(sampleDir, project);
  for (const [path, bytes] of ownerBytes) {
    const destination = join(owners, path);
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, bytes, { flag: "wx" });
  }
  writeJson(join(sampleDir, "project-before.json"), hashProject(project));
  const prompt = join(sampleDir, "prompt.md");
  writeFileSync(
    prompt,
    makePrompt(runId, sample, project, owners, definition, harness),
    { flag: "wx" },
  );
  return prompt;
}

function frozenOwnerPath(owners, path) {
  const relativePath = path.replace(
    /^(?:workflow\/skills|\.goat-flow\/skill-docs)\//u,
    "",
  );
  return join(owners, relativePath);
}

function readOwners(definition, frozenOwners) {
  if (!frozenOwners) {
    return definition.owners.map((path) => [
      path,
      readFileSync(join(root, path)),
    ]);
  }
  // The historical packet predates interactive-intake.md. Its other bound
  // owners must come from the packet, even if a fresh copy exists in the repo.
  return definition.owners
    .filter(
      (path) =>
        !path.endsWith("/references/interactive-intake.md") ||
        existsSync(frozenOwnerPath(frozenOwners, path)),
    )
    .map((path) => [path, readFileSync(frozenOwnerPath(frozenOwners, path))]);
}

function prep(caseId, harness = "claude", samples, frozenOwners) {
  if (!isId(caseId)) throw new Error("Supply a valid --case ID");
  if (harness !== "claude" && harness !== "codex") {
    throw new Error("Choose --harness claude or codex");
  }
  const frozen = samples === "1" && Boolean(frozenOwners);
  if (
    (samples !== undefined || frozenOwners !== undefined) &&
    (!frozen || caseId !== "intake-question-shape")
  ) {
    throw new Error(
      "The intake diagnostic needs both --samples 1 and --owners <dir>",
    );
  }
  const definition = validateCase(
    readJson(join(root, "evals/cases", caseId, "case.json")),
    caseId,
  );
  if (definition.harness && definition.harness !== harness) {
    throw new Error(`Case ${caseId} requires --harness ${definition.harness}`);
  }
  git(
    root,
    "check-ignore",
    "-q",
    "--",
    relative(root, join(resultsRoot, "probe/score.md")),
  );

  const ownerBytes = readOwners(definition, frozenOwners);
  const count = frozen ? 1 : sampleCount;
  const runId = randomUUID();
  const directory = join(resultsRoot, runId);
  mkdirSync(resultsRoot, { recursive: true });
  mkdirSync(directory);
  const revision = git(root, "rev-parse", "HEAD").trim();
  const harnessStatus = gitStatus();
  const prompts = [];
  for (let sample = 1; sample <= count; sample += 1) {
    prompts.push(
      prepareSample(runId, directory, sample, definition, ownerBytes, harness),
    );
  }
  writeJson(join(directory, "run.json"), {
    definition,
    revision,
    harness,
    ...(frozen ? { control: "frozen-owners" } : {}),
    sampleCount: count,
    ownerHashes: Object.fromEntries(
      ownerBytes.map(([path, bytes]) => [path, sha256(bytes)]),
    ),
    harnessStatus,
  });
  console.log(`Run: ${runId}`);
  prompts.forEach((path, index) => console.log(`Sample ${index + 1}: ${path}`));
}

function openRun(runId) {
  if (!isId(runId)) throw new Error("Supply the --run ID printed by prep");
  const directory = join(resultsRoot, runId);
  const run = readJson(join(directory, "run.json"));
  const count = run.control === "frozen-owners" ? 1 : sampleCount;
  if (run.sampleCount !== count)
    throw new Error(`Run lacks its ${count} planned sample(s)`);
  validateCase(run.definition, run.definition?.id);
  return { directory, run };
}

// Codex encrypts the launch prompt. Its host-issued handle and completed
// command output bind the sample to the prepared owner bytes.
function verifySampleIdentity(transcript, sampleDir, run) {
  const owners = join(sampleDir, "owners");
  const required = run.definition.owners
    .slice(0, 2)
    .map((path) => join(owners, path));
  if (run.harness === "codex") {
    for (const path of required) {
      const ownerText = readFileSync(path, "utf8");
      const read = recordedPreparedOwnerRead(
        transcript.commands,
        path,
        ownerText,
      );
      if (!read)
        throw new Error(
          "Codex transcript lacks a complete read of a prepared owner",
        );
    }
  } else {
    const prompt = readFileSync(join(sampleDir, "prompt.md"), "utf8").trim();
    if (!transcript.prompts.some((entry) => entry.trim() === prompt)) {
      throw new Error("Transcript prompt does not match this prepared sample");
    }
    if (!required.every((path) => transcript.readPaths.includes(path))) {
      throw new Error(
        "Transcript lacks a successful Read of the prepared skill or preamble",
      );
    }
  }
  for (const [path, digest] of Object.entries(run.ownerHashes)) {
    if (sha256(readFileSync(join(owners, path))) !== digest) {
      throw new Error(`Prepared owner file changed: ${path}`);
    }
  }
}

/** Reads the trial ledger and matches the case's expected test failure to the prepared project. */
function collectQaEvidence(sampleDir, transcript, caseId) {
  const project = join(sampleDir, "project");
  const ledger = readFileSync(join(sampleDir, "ledger/runs.log"), "utf8")
    .split(/\r?\n/u)
    .filter((line) => line.trim());
  const entries = ledger.map((line) => /\bfile=(.+?) cwd=(.+)$/u.exec(line));
  return {
    qaLedgerEntries: ledger.length,
    qaTargetTests: entries
      .filter((entry) => entry?.[2] === project)
      .map((entry) => entry[1]),
    qaOptionalRan: entries.some(
      (entry) => entry?.[1] === "e2e/checkout.e2e.mjs",
    ),
    qaRequiredFailure: recordedRequiredQaFailure(
      transcript.commands,
      project,
      caseId === "debug-rounding-gate" ? "904 !== 905" : undefined,
    ),
  };
}

/** Compares stage entries and binds recorded reads to the prepared review. */
function collectStagedReviewEvidence(sampleDir, commands) {
  const project = join(sampleDir, "project");
  const baseline = readJson(join(sampleDir, "staged-before.json"));
  return {
    reviewIndexUnchanged:
      git(project, "ls-files", "--stage", "-z") === baseline.index,
    ...recordedStagedReviewEvidence(commands, project, baseline),
  };
}

/** Reads the selected source and compares all bytes outside its leading comment. */
function collectCitedCommentEvidence(sampleDir, commands, before, after) {
  const project = join(sampleDir, "project");
  const currentSource =
    typeof after[citedSourcePath] === "string"
      ? readFileSync(join(project, citedSourcePath), "utf8")
      : "";
  const originalSource = readJson(join(sampleDir, "cited-source-before.json"));
  return {
    clarityCitationObserved: recordedCitedComment(commands, project),
    ...compareCitedComment(before, after, originalSource, currentSource),
  };
}

/** Checks the pinned policy and index before scoring the sample's authority lookup. */
function collectPolicyEvidence(sampleDir, commands) {
  const project = join(sampleDir, "project");
  const baseline = readJson(join(sampleDir, "policy-before.json"));
  const policy = readTrustedPolicy(project);
  const matchesBase =
    baseline.base === trustedPolicyBase &&
    baseline.path === trustedPolicyPath &&
    sha256(policy) === baseline.sha256;
  return {
    securityPolicySourceIntact:
      matchesBase &&
      git(project, "ls-files", "--stage", "-z") === baseline.index,
    securityTrustedPolicyRead:
      matchesBase &&
      recordedTrustedPolicyRead(commands, project, baseline, policy.toString()),
  };
}

function collect(runId, sample, filename, agentHandle) {
  if (!/^[1-9]\d*$/u.test(sample ?? "") || !filename) {
    throw new Error("Supply --sample and --transcript");
  }
  const { directory, run } = openRun(runId);
  if (Number(sample) > run.sampleCount)
    throw new Error("Sample is outside the prepared run");
  const sampleDir = join(directory, `sample-${sample}`);
  const jsonl = readFileSync(filename, "utf8");
  const transcript =
    run.harness === "codex"
      ? readCodexTranscript(jsonl, agentHandle)
      : readTranscript(jsonl);
  verifySampleIdentity(transcript, sampleDir, run);

  const before = readJson(join(sampleDir, "project-before.json"));
  const after = hashProject(join(sampleDir, "project"));
  const qaEvidence =
    run.definition.fixture === "qa-project"
      ? collectQaEvidence(sampleDir, transcript, run.definition.id)
      : {};
  const planEvidence =
    run.definition.fixture === "milestone-order"
      ? {
          blockedStartAttempted: recordedMilestoneTimerStart(
            transcript.commands,
            join(sampleDir, "project", blockedMilestonePath),
          ),
        }
      : {};
  const reviewEvidence =
    run.definition.fixture === "staged-review"
      ? collectStagedReviewEvidence(sampleDir, transcript.commands)
      : {};
  const clarityEvidence =
    run.definition.fixture === "cited-comment"
      ? collectCitedCommentEvidence(
          sampleDir,
          transcript.commands,
          before,
          after,
        )
      : {};
  const policyEvidence =
    run.definition.fixture === "policy-authority"
      ? collectPolicyEvidence(sampleDir, transcript.commands)
      : {};
  const harnessStatus = gitStatus();
  const report = execFileSync(
    process.execPath,
    ["--import", "tsx", "src/cli/cli.ts", "redact"],
    {
      cwd: root,
      encoding: "utf8",
      input: transcript.report,
      stdio: ["pipe", "pipe", "pipe"],
    },
  );
  const harnessStatusUnchanged = harnessStatus === run.harnessStatus;
  writeJson(join(sampleDir, "collected.json"), {
    agentId: transcript.agentId,
    agentHandle,
    toolCalls: transcript.toolCalls,
    agentCalls: transcript.agentCalls,
    durationMs: transcript.durationMs,
    usage: transcript.usage,
    ...qaEvidence,
    ...planEvidence,
    ...reviewEvidence,
    ...clarityEvidence,
    ...policyEvidence,
    projectUnchanged: isDeepStrictEqual(before, after),
    projectAfter: after,
    harnessStatusUnchanged,
    harnessStatusAfter: harnessStatus,
    inconclusive: !harnessStatusUnchanged,
    report,
  });
  console.log(
    `Collected sample ${sample} (${transcript.agentCalls} sub-agent spawn calls)`,
  );
}

function readSample(directory, index) {
  try {
    return readJson(join(directory, `sample-${index + 1}`, "collected.json"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

function score(runId) {
  const { directory, run } = openRun(runId);
  const samples = Array.from({ length: run.sampleCount }, (_, index) =>
    readSample(directory, index),
  );
  const report = [
    `# ${run.definition.id}`,
    "",
    `Harness: ${run.harness ?? "claude"}`,
    ...(run.control ? ["Control: frozen owners"] : []),
    `Revision: ${run.revision}`,
    "",
  ];
  const { outcomes, passes } = scoreSamples(
    run.definition,
    run.sampleCount,
    samples,
  );
  for (const [index, result] of outcomes.entries()) {
    report.push(
      `Sample ${index + 1}: ${result.status}${result.duplicate ? " (duplicate agent)" : ""}`,
    );
    for (const row of result.rows) {
      const evidence = row.evidence ? ` (${row.evidence})` : "";
      report.push(
        `- ${row.id}: ${row.passed ? "pass" : "fail"} — ${row.label}${evidence}`,
      );
    }
  }
  report.push("", `Mechanical score: ${passes}/${run.sampleCount}`);
  for (const row of run.definition.rows.filter(
    (entry) => entry.kind === "judgement",
  )) {
    report.push(`- Maintainer review (${row.id}): ${row.label}`);
  }
  const output = report.join("\n") + "\n";
  writeFileSync(join(directory, "score.md"), output);
  process.stdout.write(output);
  if (passes !== run.sampleCount) process.exitCode = 1;
}

const usage = `Usage:
  node evals/run.mjs prep --case <id> [--harness claude|codex]
  node evals/run.mjs prep --case intake-question-shape --samples 1 --owners <dir> [--harness claude|codex]
  node evals/run.mjs collect --run <id> --sample <n> --transcript <file> [--agent <handle>]
  node evals/run.mjs score --run <id>`;

function main([command, ...args]) {
  const flags = {
    prep: ["case", "harness", "samples", "owners"],
    collect: ["run", "sample", "transcript", "agent"],
    score: ["run"],
  };
  if (command === "--help" || command === undefined) {
    console.log(usage);
    return;
  }
  if (!Object.hasOwn(flags, command)) throw new Error(usage);
  const options = Object.fromEntries(
    flags[command].map((flag) => [flag, { type: "string" }]),
  );
  const { values } = parseArgs({ args, options });
  if (command === "prep")
    prep(values.case, values.harness, values.samples, values.owners);
  if (command === "collect")
    collect(values.run, values.sample, values.transcript, values.agent);
  if (command === "score") score(values.run);
}

try {
  main(process.argv.slice(2));
} catch (error) {
  console.error(`Eval: ${error.message}`);
  process.exitCode = 2;
}
