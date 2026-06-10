#!/usr/bin/env node
/**
 * Profiles dashboard audit reads against a synthetic project to expose filesystem hot paths.
 */
import { existsSync, mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { performance } from "node:perf_hooks";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CODEX_CONFIG = [
  'model = "gpt-5"',
  'default_permissions = "goat-flow"',
  "[features]",
  "hooks = true",
  "[permissions.goat-flow]",
  'description = "goat-flow workspace editing with secret-path read denies."',
  'extends = ":workspace"',
  "[permissions.goat-flow.filesystem]",
  "glob_scan_max_depth = 3",
  '":workspace_roots" = { "**/.env" = "deny", "**/.env.local" = "deny", "**/.env.development" = "deny", "**/.env.production" = "deny", "**/.env.staging" = "deny", "**/.env.test" = "deny", "**/.envrc" = "deny", "**/secrets/**" = "deny", "**/.ssh/**" = "deny", "**/.aws/**" = "deny", "**/.docker/**" = "deny", "**/.gnupg/**" = "deny", "**/.kube/**" = "deny", "**/credentials" = "deny", "**/.npmrc" = "deny", "**/.pypirc" = "deny", "**/*.pem" = "deny", "**/*.key" = "deny", "**/*.pfx" = "deny" }',
  "",
].join("\n");

/** Consume a value option, falling back to the current value when the value is omitted. */
function readOptionValue(argv, index, fallback) {
  return { value: argv[index + 1] ?? fallback, nextIndex: index + 1 };
}

/** Parse --project and return the index consumed by its value. */
function consumeProjectArg(argv, index, args) {
  const next = readOptionValue(argv, index, args.project);
  args.project = next.value;
  return next.nextIndex;
}

/** Parse --endpoint and throws when the mode is not one of the supported profile endpoints. */
function consumeEndpointArg(argv, index, args) {
  const next = readOptionValue(argv, index, args.endpoint);
  if (!["fresh", "cached", "both"].includes(next.value)) {
    throw new Error("--endpoint must be fresh, cached, or both");
  }
  args.endpoint = next.value;
  return next.nextIndex;
}

/** Enable the synthetic-large fixture flag. */
function consumeSyntheticLargeArg(_argv, index, args) {
  args.syntheticLarge = true;
  return index;
}

/** Parse --synthetic-files and throws when it is not a positive integer. */
function consumeSyntheticFilesArg(argv, index, args) {
  const next = readOptionValue(argv, index, "");
  args.syntheticFiles = Number.parseInt(next.value, 10);
  if (!Number.isFinite(args.syntheticFiles) || args.syntheticFiles < 1) {
    throw new Error("--synthetic-files must be a positive integer");
  }
  return next.nextIndex;
}

/** Enable the synthetic agent-count comparison profile. */
function consumeCompareAgentCountsArg(_argv, index, args) {
  args.compareAgentCounts = true;
  return index;
}

/** Print help and exits successfully because profiling should not continue after usage output. */
function consumeHelpArg() {
  printHelp();
  process.exit(0);
}

const ARGUMENT_HANDLERS = new Map([
  ["--project", consumeProjectArg],
  ["--endpoint", consumeEndpointArg],
  ["--synthetic-large", consumeSyntheticLargeArg],
  ["--synthetic-files", consumeSyntheticFilesArg],
  ["--compare-agent-counts", consumeCompareAgentCountsArg],
  ["--help", consumeHelpArg],
  ["-h", consumeHelpArg],
]);

/** Dispatch one CLI flag to its parser and throws on unknown options. */
function consumeArg(argv, index, args) {
  const arg = argv[index];
  const handler = ARGUMENT_HANDLERS.get(arg);
  if (!handler) {
    throw new Error(`Unknown argument: ${arg}`);
  }
  return handler(argv, index, args);
}

/** Parse CLI flags; throws on unknown or malformed options because profiling must not guess intent. */
function parseArgs(argv) {
  const args = {
    project: process.cwd(),
    endpoint: "both",
    syntheticLarge: false,
    syntheticFiles: 1200,
    compareAgentCounts: false,
  };
  for (let i = 0; i < argv.length; i++) {
    i = consumeArg(argv, i, args);
  }
  return args;
}

/** Print the operator-facing usage text for this profiling script. */
function printHelp() {
  console.log(`Usage: node scripts/profile-dashboard-audit.mjs [options]

Options:
  --project <path>          Project to profile (default: cwd)
  --endpoint <mode>         fresh, cached, or both (default: both)
  --synthetic-large         Generate and profile a temporary large fixture
  --synthetic-files <n>     Number of synthetic source files (default: 1200)
  --compare-agent-counts    Compare fresh summary timing for 1 vs 3 synthetic agents
`);
}

/** Fail before profiling when dashboard imports would resolve to missing built runtime files; throws with rebuild hint. */
function ensureBuiltRuntime() {
  const required = [
    "dist/cli/server/dashboard.js",
    "dist/cli/audit/audit.js",
    "dist/cli/facts/fs.js",
    "dist/cli/detect/project-stack.js",
  ];
  const missing = required.filter((path) => !existsSync(join(REPO_ROOT, path)));
  if (missing.length > 0) {
    throw new Error(
      `Built runtime is missing ${missing.join(", ")}. Run npm run build first.`,
    );
  }
}

/** Convert a built runtime path to a file URL for dynamic ESM imports. */
function distUrl(relative) {
  return pathToFileURL(join(REPO_ROOT, relative)).href;
}

/** Build a span collector because dashboard endpoint timings do not expose lower-level filesystem costs. */
function createProfiler() {
  const spans = [];
  return {
    spans,
    /** Run a synchronous span and record its rounded duration even when the callback throws. */
    span(name, fn) {
      const start = performance.now();
      try {
        return fn();
      } finally {
        spans.push({
          name,
          durationMs: Number((performance.now() - start).toFixed(3)),
        });
      }
    },
  };
}

/**
 * Wrap the project filesystem because cold-path profile runs otherwise hide repeated file probes behind one elapsed-time total.
 */
function createCountingFS(base) {
  const counts = {
    glob: 0,
    existsGlob: 0,
    exists: 0,
    readFile: 0,
    readJson: 0,
    listDir: 0,
  };
  const timings = Object.fromEntries(
    Object.keys(counts).map((key) => [key, 0]),
  );
  const patterns = {
    glob: new Map(),
    existsGlob: new Map(),
  };
  /** Aggregate glob pattern timing by method so repeated probes show up as one row. */
  const recordPattern = (name, pattern, durationMs) => {
    const existing = patterns[name].get(pattern) ?? {
      count: 0,
      totalMs: 0,
      maxMs: 0,
    };
    existing.count += 1;
    existing.totalMs += durationMs;
    existing.maxMs = Math.max(existing.maxMs, durationMs);
    patterns[name].set(pattern, existing);
  };
  /** Create a counted filesystem method wrapper while preserving the base method's return value. */
  function wrapInstrumentedMethod(methodName) {
    /** Count and time one filesystem method call, including glob-pattern detail when present. */
    return function countedMethod(...args) {
      counts[methodName] += 1;
      const start = performance.now();
      try {
        return base[methodName](...args);
      } finally {
        const durationMs = performance.now() - start;
        timings[methodName] = Number(
          (timings[methodName] + durationMs).toFixed(3),
        );
        if ((methodName === "glob" || methodName === "existsGlob") && args[0]) {
          recordPattern(methodName, String(args[0]), durationMs);
        }
      }
    };
  }

  return {
    fs: {
      ...base,
      glob: wrapInstrumentedMethod("glob"),
      exists: wrapInstrumentedMethod("exists"),
      readFile: wrapInstrumentedMethod("readFile"),
      readJson: wrapInstrumentedMethod("readJson"),
      listDir: wrapInstrumentedMethod("listDir"),
      existsGlob: wrapInstrumentedMethod("existsGlob"),
    },
    counts,
    timings,
    patterns,
  };
}

/** Collapse raw span events into a deterministic slowest-first summary contract. */
function summarizeSpans(spans) {
  const summary = new Map();
  for (const span of spans) {
    const existing = summary.get(span.name) ?? {
      count: 0,
      totalMs: 0,
      maxMs: 0,
    };
    existing.count += 1;
    existing.totalMs += span.durationMs;
    existing.maxMs = Math.max(existing.maxMs, span.durationMs);
    summary.set(span.name, existing);
  }
  return [...summary.entries()]
    .map(([name, value]) => ({
      name,
      count: value.count,
      totalMs: Number(value.totalMs.toFixed(3)),
      maxMs: Number(value.maxMs.toFixed(3)),
    }))
    .sort((a, b) => b.totalMs - a.totalMs);
}

/** Measure a synchronous operation and return the label, result value, and elapsed milliseconds. */
function timeSync(label, fn) {
  const start = performance.now();
  const value = fn();
  return {
    label,
    value,
    durationMs: Number((performance.now() - start).toFixed(3)),
  };
}

/** Measure an async operation and return the label, awaited value, and elapsed milliseconds. */
async function timeAsync(label, fn) {
  const start = performance.now();
  const value = await fn();
  return {
    label,
    value,
    durationMs: Number((performance.now() - start).toFixed(3)),
  };
}

/** Extract the per-server dashboard token from the started server URL. */
function dashboardToken(server) {
  return new URL(server.url).searchParams.get("token") ?? "";
}

/** Fetch one dashboard audit endpoint variant and retain the small response fields needed for timing output. */
async function fetchAudit(baseUrl, token, projectPath, fresh) {
  const params = new URLSearchParams({
    path: projectPath,
    quality: "true",
    profile: "true",
  });
  if (fresh) params.set("fresh", "true");
  return timeAsync(fresh ? "endpoint fresh" : "endpoint cached", async () => {
    const res = await fetch(`${baseUrl}/api/audit?${params.toString()}`, {
      headers: { "X-Goat-Flow-Dashboard-Token": token },
    });
    const text = await res.text();
    const body = JSON.parse(text);
    return {
      status: res.status,
      bytes: Buffer.byteLength(text),
      cached: body.cached === true,
      profile: body._profile ?? null,
      agentScores: Array.isArray(body.agentScores)
        ? body.agentScores.length
        : 0,
      statusText: typeof body.status === "string" ? body.status : null,
    };
  });
}

/**
 * Compare fresh dashboard audit timing for one-agent and three-agent synthetic projects.
 * Each case gets its own freshly-served dashboard and a `?fresh=true` fetch because the goal is to
 * isolate how per-agent audit work scales with configured agent count - sharing a server or
 * reusing the cache would let one case's warm state mask the other's cold cost. The leading
 * `/api/health` call is intentional: it forces first-request module/route warmup so the measured
 * audit fetch reflects steady-state work, not one-time server boot.
 */
async function runAgentCountComparison(serveDashboard, fileCount) {
  const cases = [
    { label: "one-agent", agents: ["codex"] },
    { label: "three-agent", agents: ["claude", "codex", "copilot"] },
  ];
  for (const testCase of cases) {
    const projectPath = writeSyntheticProject(fileCount, testCase.agents);
    const server = await serveDashboard({ projectPath, dev: true });
    try {
      const baseUrl = `http://127.0.0.1:${server.port}`;
      const token = dashboardToken(server);
      await fetch(`${baseUrl}/api/health`, {
        headers: { "X-Goat-Flow-Dashboard-Token": token },
      });
      const result = await fetchAudit(baseUrl, token, projectPath, true);
      console.log(
        `agent-count ${testCase.label}: configured=${testCase.agents.length} time=${result.durationMs}ms status=${result.value.status} cached=${result.value.cached} agentScores=${result.value.agentScores}`,
      );
    } finally {
      await server.close();
    }
  }
}

/** Print the HTTP endpoint timing summary and the slowest endpoint profile spans. */
function printEndpointResult(result) {
  const body = result.value;
  console.log(
    `${result.label}: status=${body.status} time=${result.durationMs}ms bytes=${body.bytes} cached=${body.cached} agentScores=${body.agentScores}`,
  );
  if (body.profile?.spans) {
    for (const span of summarizeSpans(body.profile.spans).slice(0, 12)) {
      console.log(
        `  span ${span.name}: total=${span.totalMs}ms count=${span.count} max=${span.maxMs}ms`,
      );
    }
  }
}

/** Print direct audit timings, filesystem counters, and pattern costs captured outside the HTTP route. */
function printDirectProfile(result) {
  console.log(`direct timings:`);
  for (const row of result.timings) {
    console.log(`  ${row.label}: ${row.durationMs}ms`);
  }
  console.log(`route-equivalent fs counts:`);
  for (const key of Object.keys(result.counts)) {
    console.log(
      `  ${key}: count=${result.counts[key]} time=${result.fsTimings[key]}ms`,
    );
  }
  console.log(`audit batch spans:`);
  for (const span of summarizeSpans(result.spans).slice(0, 16)) {
    console.log(
      `  ${span.name}: total=${span.totalMs}ms count=${span.count} max=${span.maxMs}ms`,
    );
  }
  if (result.stackCounts) {
    console.log(`detectStack fs counts:`);
    for (const key of Object.keys(result.stackCounts)) {
      console.log(
        `  ${key}: count=${result.stackCounts[key]} time=${result.stackFsTimings[key]}ms`,
      );
    }
    console.log(`detectStack glob patterns:`);
    for (const row of result.stackPatternTimings.slice(0, 16)) {
      console.log(
        `  ${row.method} ${row.pattern}: total=${row.totalMs}ms count=${row.count} max=${row.maxMs}ms`,
      );
    }
  }
}

/**
 * Flatten the per-method glob-pattern timing maps into one rows array for tabular profile output.
 * Maintains the same slowest-first contract as summarizeSpans: rows are sorted by descending
 * totalMs so the heaviest pattern is always row 0, and the `glob`-before-`existsGlob` method order
 * is fixed so two runs over the same data produce a deterministic, diffable ordering.
 */
function summarizePatternTimings(patterns) {
  const rows = [];
  for (const method of ["glob", "existsGlob"]) {
    for (const [pattern, value] of patterns[method]) {
      rows.push({
        method,
        pattern,
        count: value.count,
        totalMs: Number(value.totalMs.toFixed(3)),
        maxMs: Number(value.maxMs.toFixed(3)),
      });
    }
  }
  return rows.sort((a, b) => b.totalMs - a.totalMs);
}

/** Run the dashboard profile flow for the requested project or generated synthetic project. */
async function main() {
  const args = parseArgs(process.argv.slice(2));
  ensureBuiltRuntime();

  process.env.GOAT_FLOW_PACKAGED_MODE ??= "1";
  process.env.GOAT_FLOW_AUDIT_PROFILE ??= "1";

  const projectPath = args.syntheticLarge
    ? writeSyntheticProject(args.syntheticFiles)
    : resolve(args.project);

  const { serveDashboard } = await import(
    distUrl("dist/cli/server/dashboard.js")
  );
  const { createFS } = await import(distUrl("dist/cli/facts/fs.js"));
  const { loadConfig } = await import(distUrl("dist/cli/config/reader.js"));
  const { detectAgents: detectConfiguredAgents } = await import(
    distUrl("dist/cli/detect/agents.js")
  );
  const { detectStack } = await import(
    distUrl("dist/cli/detect/project-stack.js")
  );
  const { extractSharedFacts } = await import(
    distUrl("dist/cli/facts/shared/index.js")
  );
  const { runAudit, runAuditBatch } = await import(
    distUrl("dist/cli/audit/audit.js")
  );

  console.log(`# dashboard audit profile`);
  console.log(`project=${projectPath}`);
  console.log(`endpoint=${args.endpoint}`);

  if (args.compareAgentCounts) {
    await runAgentCountComparison(serveDashboard, args.syntheticFiles);
    return;
  }

  const server = await serveDashboard({ projectPath, dev: true });
  try {
    const baseUrl = `http://127.0.0.1:${server.port}`;
    const token = dashboardToken(server);
    await fetch(`${baseUrl}/api/health`, {
      headers: { "X-Goat-Flow-Dashboard-Token": token },
    });
    if (args.endpoint === "fresh" || args.endpoint === "both") {
      printEndpointResult(await fetchAudit(baseUrl, token, projectPath, true));
    }
    if (args.endpoint === "cached" || args.endpoint === "both") {
      printEndpointResult(await fetchAudit(baseUrl, token, projectPath, false));
    }
  } finally {
    await server.close();
  }

  const directTimings = [];
  const configTiming = timeSync("config load", () =>
    loadConfig(projectPath, createFS(projectPath)),
  );
  directTimings.push(configTiming);
  const stackCounted = createCountingFS(createFS(projectPath));
  const detectStackTiming = timeSync("detectStack", () =>
    detectStack(stackCounted.fs),
  );
  directTimings.push(detectStackTiming);
  const sharedTiming = timeSync("extractSharedFacts", () =>
    extractSharedFacts(createFS(projectPath), configTiming.value),
  );
  directTimings.push(sharedTiming);
  const aggregateTiming = timeSync("runAudit aggregate", () =>
    runAudit(createFS(projectPath), projectPath, {
      agentFilter: null,
      harness: true,
      denyMechanismEvidenceLevel: "present-only",
    }),
  );
  directTimings.push(aggregateTiming);

  const counted = createCountingFS(createFS(projectPath));
  const profile = createProfiler();
  const configState = profile.span("config load", () =>
    loadConfig(projectPath, counted.fs),
  );
  const configAgents = profile
    .span("configured-agent detection", () =>
      detectConfiguredAgents(counted.fs),
    )
    .map((agent) => agent.id);
  const batchTiming = timeSync("runAuditBatch", () =>
    runAuditBatch(
      counted.fs,
      projectPath,
      {
        agentFilter: null,
        harness: true,
        denyMechanismEvidenceLevel: "present-only",
        factProfile: "dashboard-summary",
        profile,
      },
      configAgents,
    ),
  );
  directTimings.push(batchTiming);

  profile.span("extractSharedFacts standalone", () =>
    extractSharedFacts(counted.fs, configState),
  );

  printDirectProfile({
    timings: directTimings,
    counts: counted.counts,
    fsTimings: counted.timings,
    spans: profile.spans,
    stackCounts: stackCounted.counts,
    stackFsTimings: stackCounted.timings,
    stackPatternTimings: summarizePatternTimings(stackCounted.patterns),
  });
}

/** Writes a temporary goat-flow project because profiling needs a repeatable large-repo audit fixture. */
function writeSyntheticProject(fileCount, agents = ["codex"]) {
  const root = mkdtempSync(join(tmpdir(), "goat-flow-profile-"));
  mkdirSync(join(root, ".goat-flow", "learning-loop", "footguns"), {
    recursive: true,
  });
  mkdirSync(join(root, ".goat-flow", "learning-loop", "lessons"), {
    recursive: true,
  });
  mkdirSync(join(root, ".goat-flow", "learning-loop", "decisions"), {
    recursive: true,
  });
  mkdirSync(join(root, ".goat-flow", "scratchpad"), { recursive: true });
  mkdirSync(join(root, ".goat-flow", "hooks", "deny-dangerous"), {
    recursive: true,
  });
  mkdirSync(join(root, "src"), { recursive: true });

  writeFileSync(
    join(root, ".goat-flow", "config.yaml"),
    `version: "1.3.2"\nagents:\n${agents.map((agent) => `  - ${agent}`).join("\n")}\n`,
  );
  writeFileSync(
    join(root, "package.json"),
    '{"scripts":{"test":"node --test"}}\n',
  );
  writeFileSync(join(root, "tsconfig.json"), "{}\n");
  for (const file of [
    "patterns-shell.sh",
    "patterns-paths.sh",
    "patterns-writes.sh",
    "deny-dangerous-self-test.sh",
  ]) {
    writeFileSync(
      join(root, ".goat-flow", "hooks", "deny-dangerous", file),
      "#!/usr/bin/env bash\nexit 0\n",
    );
  }

  if (agents.includes("claude")) {
    mkdirSync(join(root, ".claude", "hooks"), { recursive: true });
    mkdirSync(join(root, ".claude", "skills", "goat"), { recursive: true });
    writeFileSync(join(root, "CLAUDE.md"), "# CLAUDE.md\n\nSynthetic.\n");
    writeFileSync(join(root, ".claude", "settings.json"), "{}\n");
    writeFileSync(
      join(root, ".claude", "hooks", "deny-dangerous.sh"),
      "#!/usr/bin/env bash\nexit 0\n",
    );
    writeFileSync(
      join(root, ".claude", "skills", "goat", "SKILL.md"),
      "---\nname: goat\n---\n# goat\n",
    );
  }

  if (agents.includes("codex")) {
    mkdirSync(join(root, ".goat-flow", "hooks"), { recursive: true });
    mkdirSync(join(root, ".agents", "skills", "goat"), { recursive: true });
    writeFileSync(join(root, "AGENTS.md"), "# AGENTS.md\n\nSynthetic.\n");
    writeFileSync(join(root, ".codex", "config.toml"), CODEX_CONFIG);
    writeFileSync(
      join(root, ".codex", "hooks.json"),
      '{"hooks":{"PreToolUse":[{"matcher":"Bash","hooks":[{"type":"command","command":".goat-flow/hooks/deny-dangerous.sh"}]}]}}\n',
    );
    writeFileSync(
      join(root, ".goat-flow", "hooks", "deny-dangerous.sh"),
      "#!/usr/bin/env bash\nexit 0\n",
    );
    writeFileSync(
      join(root, ".agents", "skills", "goat", "SKILL.md"),
      "---\nname: goat\n---\n# goat\n",
    );
  }

  if (agents.includes("copilot")) {
    mkdirSync(join(root, ".github", "hooks"), { recursive: true });
    mkdirSync(join(root, ".goat-flow", "hooks"), { recursive: true });
    mkdirSync(join(root, ".github", "skills", "goat"), { recursive: true });
    writeFileSync(
      join(root, ".github", "copilot-instructions.md"),
      "# Copilot Instructions\n\nSynthetic. Commit rules: `docs/coding-standards/git-commit.md`.\n",
    );
    mkdirSync(join(root, "docs", "coding-standards"), { recursive: true });
    writeFileSync(
      join(root, "docs", "coding-standards", "git-commit.md"),
      "# Git Commit Instructions\n\nSynthetic.\n",
    );
    writeFileSync(
      join(root, ".github", "hooks", "hooks.json"),
      '{"hooks":{"preToolUse":[{"command":".goat-flow/hooks/deny-dangerous.sh"}]}}\n',
    );
    writeFileSync(
      join(root, ".goat-flow", "hooks", "deny-dangerous.sh"),
      "#!/usr/bin/env bash\nexit 0\n",
    );
    writeFileSync(
      join(root, ".github", "skills", "goat", "SKILL.md"),
      "---\nname: goat\n---\n# goat\n",
    );
  }

  for (let i = 0; i < fileCount; i++) {
    const dir = join(root, "src", `group-${Math.floor(i / 100)}`);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `file-${i}.ts`), `const value${i} = ${i};\n`);
  }
  return root;
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
