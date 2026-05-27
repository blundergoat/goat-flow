#!/usr/bin/env node
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
  "[permissions.goat-flow.filesystem]",
  "glob_scan_max_depth = 3",
  '":workspace_roots" = { "." = "write", "secrets/**" = "none", ".ssh/**" = "none", ".aws/**" = "none", ".docker/**" = "none", ".gnupg/**" = "none", ".kube/**" = "none" }',
  "",
].join("\n");

function parseArgs(argv) {
  const args = {
    project: process.cwd(),
    endpoint: "both",
    syntheticLarge: false,
    syntheticFiles: 1200,
    compareAgentCounts: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--project") {
      args.project = argv[++i] ?? args.project;
      continue;
    }
    if (arg === "--endpoint") {
      const value = argv[++i] ?? args.endpoint;
      if (!["fresh", "cached", "both"].includes(value)) {
        throw new Error("--endpoint must be fresh, cached, or both");
      }
      args.endpoint = value;
      continue;
    }
    if (arg === "--synthetic-large") {
      args.syntheticLarge = true;
      continue;
    }
    if (arg === "--synthetic-files") {
      args.syntheticFiles = Number.parseInt(argv[++i] ?? "", 10);
      if (!Number.isFinite(args.syntheticFiles) || args.syntheticFiles < 1) {
        throw new Error("--synthetic-files must be a positive integer");
      }
      continue;
    }
    if (arg === "--compare-agent-counts") {
      args.compareAgentCounts = true;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

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

function distUrl(relative) {
  return pathToFileURL(join(REPO_ROOT, relative)).href;
}

function createProfiler() {
  const spans = [];
  return {
    spans,
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
  const wrap = (name) =>
    function countedMethod(...args) {
      counts[name] += 1;
      const start = performance.now();
      try {
        return base[name](...args);
      } finally {
        const durationMs = performance.now() - start;
        timings[name] = Number((timings[name] + durationMs).toFixed(3));
        if ((name === "glob" || name === "existsGlob") && args[0]) {
          recordPattern(name, String(args[0]), durationMs);
        }
      }
    };

  return {
    fs: {
      ...base,
      glob: wrap("glob"),
      exists: wrap("exists"),
      readFile: wrap("readFile"),
      readJson: wrap("readJson"),
      listDir: wrap("listDir"),
      existsGlob: wrap("existsGlob"),
    },
    counts,
    timings,
    patterns,
  };
}

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

function timeSync(label, fn) {
  const start = performance.now();
  const value = fn();
  return {
    label,
    value,
    durationMs: Number((performance.now() - start).toFixed(3)),
  };
}

async function timeAsync(label, fn) {
  const start = performance.now();
  const value = await fn();
  return {
    label,
    value,
    durationMs: Number((performance.now() - start).toFixed(3)),
  };
}

function dashboardToken(server) {
  return new URL(server.url).searchParams.get("token") ?? "";
}

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

function writeSyntheticProject(fileCount, agents = ["codex"]) {
  const root = mkdtempSync(join(tmpdir(), "goat-flow-profile-"));
  mkdirSync(join(root, ".goat-flow", "footguns"), { recursive: true });
  mkdirSync(join(root, ".goat-flow", "lessons"), { recursive: true });
  mkdirSync(join(root, ".goat-flow", "decisions"), { recursive: true });
  mkdirSync(join(root, ".goat-flow", "scratchpad"), { recursive: true });
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

  if (agents.includes("claude")) {
    mkdirSync(join(root, ".claude", "hooks"), { recursive: true });
    mkdirSync(join(root, ".claude", "skills", "goat"), { recursive: true });
    writeFileSync(join(root, "CLAUDE.md"), "# CLAUDE.md\n\nSynthetic.\n");
    writeFileSync(join(root, ".claude", "settings.json"), "{}\n");
    writeFileSync(
      join(root, ".claude", "hooks", "guard-common.sh"),
      "#!/usr/bin/env bash\nexit 0\n",
    );
    writeFileSync(
      join(root, ".claude", "hooks", "guard-repository-writes.sh"),
      "#!/usr/bin/env bash\nexit 0\n",
    );
    writeFileSync(
      join(root, ".claude", "hooks", "guardrails-self-test.sh"),
      "#!/usr/bin/env bash\nexit 0\n",
    );
    writeFileSync(
      join(root, ".claude", "skills", "goat", "SKILL.md"),
      "---\nname: goat\n---\n# goat\n",
    );
  }

  if (agents.includes("codex")) {
    mkdirSync(join(root, ".codex", "hooks"), { recursive: true });
    mkdirSync(join(root, ".agents", "skills", "goat"), { recursive: true });
    writeFileSync(join(root, "AGENTS.md"), "# AGENTS.md\n\nSynthetic.\n");
    writeFileSync(join(root, ".codex", "config.toml"), CODEX_CONFIG);
    writeFileSync(
      join(root, ".codex", "hooks.json"),
      '{"hooks":{"PreToolUse":[{"matcher":"Bash","hooks":[{"type":"command","command":".codex/hooks/guard-repository-writes.sh"}]}]}}\n',
    );
    writeFileSync(
      join(root, ".codex", "hooks", "guard-common.sh"),
      "#!/usr/bin/env bash\nexit 0\n",
    );
    writeFileSync(
      join(root, ".codex", "hooks", "guard-repository-writes.sh"),
      "#!/usr/bin/env bash\nexit 0\n",
    );
    writeFileSync(
      join(root, ".codex", "hooks", "guardrails-self-test.sh"),
      "#!/usr/bin/env bash\nexit 0\n",
    );
    writeFileSync(
      join(root, ".agents", "skills", "goat", "SKILL.md"),
      "---\nname: goat\n---\n# goat\n",
    );
  }

  if (agents.includes("copilot")) {
    mkdirSync(join(root, ".github", "hooks"), { recursive: true });
    mkdirSync(join(root, ".github", "skills", "goat"), { recursive: true });
    writeFileSync(
      join(root, ".github", "copilot-instructions.md"),
      "# Copilot Instructions\n\nSynthetic.\n",
    );
    writeFileSync(
      join(root, ".github", "git-commit-instructions.md"),
      "# Git Commit Instructions\n\nSynthetic.\n",
    );
    writeFileSync(
      join(root, ".github", "hooks", "hooks.json"),
      '{"hooks":{"preToolUse":[{"command":".github/hooks/guard-repository-writes.sh"}]}}\n',
    );
    writeFileSync(
      join(root, ".github", "hooks", "guard-common.sh"),
      "#!/usr/bin/env bash\nexit 0\n",
    );
    writeFileSync(
      join(root, ".github", "hooks", "guard-repository-writes.sh"),
      "#!/usr/bin/env bash\nexit 0\n",
    );
    writeFileSync(
      join(root, ".github", "hooks", "guardrails-self-test.sh"),
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
    writeFileSync(
      join(dir, `file-${i}.ts`),
      `export const value${i} = ${i};\n`,
    );
  }
  return root;
}

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

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
