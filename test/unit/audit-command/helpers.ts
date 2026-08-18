/**
 * Shared audit-command fixtures for setup checks, harness concerns, and output contracts.
 * Use them to give each focused test a complete healthy project baseline while
 * overriding only the filesystem or agent behavior visible to the audit user.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { assertExists } from "../../helpers/assert-exists.ts";
import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import {
  computeHarness,
  createAuditFactsView,
  runAudit,
  runAuditBatch,
} from "../../src.js";
import {
  renderAuditJson,
  renderAuditMarkdown,
  renderAuditText,
} from "../../src.js";
import {
  AGENT_CHECKS,
  AUDIT_VERSION,
  composeSetup,
  createFS,
  extractBacktickPaths,
  extractHookFacts,
  extractProjectFacts,
  extractSettingsFacts,
  HARNESS_CHECKS,
  parseCLIArgs,
  PROFILES,
  renderAuditSarif,
  SETUP_CHECKS,
  getSkillNames,
} from "../../src.js";
import {
  completeInstruction,
  INSTRUCTION_FILES,
  RATIONALISATIONS_PREAMBLE,
} from "../../fixtures/evidence-before-claims.js";

export const PROJECT_ROOT = resolve(import.meta.dirname, "..", "..", "..");
export const BUILD_CHECKS = [...SETUP_CHECKS, ...AGENT_CHECKS];
export const CODEX_WORKSPACE_ROOT_ENTRIES = [
  '"**/.env*" = "deny"',
  '"**/secrets/**" = "deny"',
  '"**/.ssh/**" = "deny"',
  '"**/.aws/**" = "deny"',
  '"**/.docker/**" = "deny"',
  '"**/.gnupg/**" = "deny"',
  '"**/.kube/**" = "deny"',
  '"**/credentials*" = "deny"',
  '"**/.npmrc" = "deny"',
  '"**/.pypirc" = "deny"',
  '"**/*.pem" = "deny"',
  '"**/*.key" = "deny"',
  '"**/*.pfx" = "deny"',
];
/**
 * Render a Codex workspace-roots table for settings fixtures.
 *
 * @param entries - deny entries to include; the default is the full canonical set a healthy install carries
 * @returns the inline TOML table as it appears in a Codex config
 */
export function codexWorkspaceRootsTable(
  entries = CODEX_WORKSPACE_ROOT_ENTRIES,
): string {
  return `":workspace_roots" = { ${entries.join(", ")} }`;
}
import type { AuditContext, AuditReport, ProjectStructure } from "../../src.js";
import type {
  AgentId,
  AgentFacts,
  AgentProfile,
  GoatFlowConfig,
  LoadedConfig,
  ProjectFacts,
  ReadonlyFS,
} from "../../src.js";

// ---------------------------------------------------------------------------
// Cached repo audits
// ---------------------------------------------------------------------------

export const cachedRepoAudits = new Map<string, AuditReport>();

/**
 * Audit this repository once per distinct option set and reuse the result afterwards.
 * Use from any describe that audits the controlling workspace with identical inputs: a fresh audit
 * costs roughly 7-12s, so sharing one cuts about 30s off this file's suite time.
 * Callers must treat the report as read-only - every caller with equal options receives the same
 * object, so mutating it corrupts unrelated tests.
 *
 * @param opts - audit selectors; `agentFilter` null audits every agent, `harness` adds harness checks
 * @returns the shared report for `opts`; repeated calls with equal selectors return the same instance
 */
export function getRepoAudit(opts: {
  agentFilter: AgentId | null;
  harness: boolean;
}): AuditReport {
  const key = `${opts.agentFilter}|${opts.harness}`;
  let report = cachedRepoAudits.get(key);
  if (report === undefined) {
    report = runAudit(createFS(PROJECT_ROOT), PROJECT_ROOT, opts);
    cachedRepoAudits.set(key, report);
  }
  return report;
}

// ---------------------------------------------------------------------------
// Helpers: minimal mock context for targeted build-check tests
// ---------------------------------------------------------------------------

/**
 * Production code calls FS helpers with `path.join` results, which on Windows
 * use backslashes. Test handlers compare against POSIX-shape literals. Wrap
 * every incoming path with a forward-slash normaliser so handlers can match
 * on the documented separator-agnostic shape regardless of host.
 *
 * @param nativePath - a path as production code produced it, possibly containing Windows backslash separators
 * @returns the same path with every backslash rewritten to a forward slash
 */
export function posixifyPath(nativePath: string): string {
  return nativePath.replace(/\\/g, "/");
}

/**
 * Wrap a fake FS handler so it sees POSIX-shape paths on every host.
 * Use when stubbing a ReadonlyFS method whose test handler matches path literals: production code
 * passes `path.join` output, which uses backslashes on Windows and would miss those literals.
 *
 * @param block - handler supplied by the test; `undefined` means the caller wants the fallback instead
 * @param fallback - value yielded when no handler is supplied, so every stubbed method stays populated
 * @returns a handler that normalises separators before delegating, or one that always yields `fallback`
 */
export function wrapPathArg<T>(
  block: ((path: string) => T) | undefined,
  fallback: T,
): (path: string) => T {
  return (path: string): T => (block ? block(posixifyPath(path)) : fallback);
}

/**
 * Build a default-passing ReadonlyFS fake with optional targeted overrides.
 *
 * @param overrides - per-method handlers to replace specific defaults; supplied path handlers receive POSIX-normalised
 *   paths, and any method left out falls back to a benign default (exists true, reads null/empty)
 * @returns a ReadonlyFS where every method is populated, so a check exercises only the behaviour it overrode
 */
export function stubFS(overrides: Partial<ReadonlyFS> = {}): ReadonlyFS {
  const fs: ReadonlyFS = {
    exists: wrapPathArg(overrides.exists, true),
    readFile: wrapPathArg(overrides.readFile, null),
    lineCount: wrapPathArg(overrides.lineCount, 0),
    readJson: wrapPathArg(overrides.readJson, null),
    isReadableDirectory: wrapPathArg(overrides.isReadableDirectory, true),
    listDir: wrapPathArg(overrides.listDir, [] as string[]),
    isExecutable: wrapPathArg(overrides.isExecutable, false),
    glob: overrides.glob ?? ((): string[] => []),
    existsGlob:
      overrides.existsGlob ??
      ((pattern: string) =>
        (overrides.glob ?? ((): string[] => []))(pattern).length > 0),
  };
  return fs;
}

/**
 * Build a valid loaded-config fixture because audit checks only need targeted config overrides.
 *
 * @param overrides - config fields to merge over the default valid config; omit to get a fully-populated
 *   current-version config that passes structural checks
 * @returns a LoadedConfig marked exists+valid, wrapping the merged config object
 */
export function stubConfig(
  overrides: Partial<GoatFlowConfig> = {},
): LoadedConfig {
  return {
    exists: true,
    valid: true,
    config: {
      version: AUDIT_VERSION,
      footguns: { path: ".goat-flow/learning-loop/footguns/" },
      lessons: { path: ".goat-flow/learning-loop/lessons/" },
      decisions: { path: ".goat-flow/learning-loop/decisions/" },
      plans: { path: ".goat-flow/plans/" },
      logs: { path: ".goat-flow/logs/" },
      agents: null,
      skills: { install: "all" },
      lineLimits: { target: 125, limit: 150 },
      toolchain: {
        test: ["npm test"],
        lint: ["eslint ."],
        build: ["tsc"],
        package: [],
        format: [],
      },
      userRole: "developer",
      telemetry: false,
      learningLoop: { autoCapture: { enabled: false, targets: [] } },
      knownGaps: [],
      skillOverrides: {},
      harness: { acknowledge: [] },
      terminal: { idleTimeoutMinutes: 480 },
      hooks: {},
      ...overrides,
    },
    warnings: [],
    errors: [],
    parseError: null,
  };
}

export const STUB_AGENT_PROFILE: AgentProfile = {
  id: "claude",
  name: "Claude Code",
  instructionFile: "CLAUDE.md",
  terminalBinary: "claude",
  setupSurfaces: ["CLAUDE.md", ".claude/settings.json"],
  promptInvocationStyle: "slash",
  skillSource: "agent-mirror",
  supportsPostTurnHook: true,
  settingsFile: ".claude/settings.json",
  hookConfigFile: ".claude/settings.json",
  skillsDir: ".claude/skills",
  hooksDir: ".goat-flow/hooks",
  denyMechanism: { type: "settings-deny", path: ".claude/settings.json" },
  denyHookFile: ".goat-flow/hooks/deny-dangerous.sh",
  localPattern: "*/CLAUDE.md",
  hookEvents: { preTool: "PreToolUse", postTurn: "Stop" },
};

/**
 * Extract deny-hook facts from a single in-memory hook body, wrapping it in a fake FS so a test can probe the
 * extractor against one hook script without writing files.
 *
 * @param denyContent - the full text of a deny-hook script, served as the only readable file at the deny-hook path
 * @returns the hook facts the extractor derives from that body (secret-path coverage, registration, and so on)
 */
export function extractHookFactsForDenyContent(denyContent: string) {
  const fs = stubFS({
    exists: (path) => path === STUB_AGENT_PROFILE.denyHookFile,
    readFile: (path) =>
      path === STUB_AGENT_PROFILE.denyHookFile ? denyContent : null,
  });
  return extractHookFacts(fs, STUB_AGENT_PROFILE, {}, true, true);
}

/**
 * Build complete agent facts for checks that only override one concern.
 *
 * @param overrides - the single facts concern (instruction, settings, skills, hooks, ...) a check wants to vary;
 *   everything else defaults to a healthy, fully-installed agent
 * @returns an AgentFacts object with every concern populated so the check under test sees a realistic baseline
 */
export function stubAgentFacts(
  overrides: Partial<AgentFacts> = {},
): AgentFacts {
  return {
    agent: STUB_AGENT_PROFILE,
    instruction: {
      exists: true,
      content: "# Test",
      lineCount: 100,
      sections: new Map(),
    },
    settings: { exists: true, valid: true, parsed: {}, hasDenyPatterns: true },
    skills: {
      installedDirs: [],
      found: [
        "goat",
        "goat-debug",
        "goat-plan",
        "goat-review",
        "goat-critique",
        "goat-security",
        "goat-qa",
      ],
      missing: [],
      allPresent: true,
      versions: {},
      outdatedCount: 0,
      hasDispatcher: true,
      quality: {
        withStep0: 0,
        withHumanGate: 0,
        withConstraints: 0,
        withPhases: 0,
        withConversational: 0,
        withChoices: 0,
        withOutputFormat: 0,
        withSharedConventions: 0,
        malformedFenceCount: 0,
        unadaptedCount: 0,
        adaptCommentCount: 0,
        total: 0,
      },
    },
    hooks: {
      denyExists: true,
      denyHasBlocks: true,
      denyIsConfigBased: false,
      denyUsesJq: false,
      denyHandlesChaining: false,
      denyBlocksRmRf: true,
      denyBlocksGitPush: true,
      denyBlocksChmod: true,
      denyBlocksPipeToShell: false,
      denyBlocksCloudDestructive: false,
      denyIsRegistered: true,
      denyRegisteredPath: ".goat-flow/hooks/deny-dangerous.sh",
      postTurnExists: false,
      postTurnRegistered: false,
      postTurnRegisteredPath: null,
      postTurnExecutable: false,
      postTurnExitsZero: false,
      postTurnHasValidation: false,
      postTurnSwallowsFailures: false,
      absolutePathHooks: [],
      readDenyCoversSecrets: true,
      bashDenyCoversSecrets: true,
    },
    deny: { gitCommitBlocked: false, gitPushBlocked: false },
    router: { exists: true, paths: [], resolved: 0, unresolved: [] },
    localContext: { files: [], warranted: [], missing: [] },
    ...overrides,
  };
}

export const STUB_STRUCTURE: ProjectStructure = {
  required_files: [".goat-flow/config.yaml", ".goat-flow/architecture.md"],
  required_dirs: [
    ".goat-flow/learning-loop/footguns/",
    ".goat-flow/learning-loop/lessons/",
  ],
  skills: {
    canonical: [
      "goat",
      "goat-debug",
      "goat-plan",
      "goat-review",
      "goat-critique",
      "goat-security",
      "goat-qa",
    ],
    stale_names: ["goat-audit", "goat-investigate"],
  },
  agents: {},
};

/**
 * Build an audit context fixture because focused checks should override only the facts under test.
 *
 * @param overrides - the slice of audit context (facts, project path, config, ...) a check wants to set; the rest
 *   defaults to a benign well-formed context
 * @returns a complete AuditContext suitable for invoking a single check in isolation
 */
export function makeCtx(overrides: Partial<AuditContext> = {}): AuditContext {
  return {
    projectPath: "/tmp/test-project",
    facts: {
      root: "/tmp/test-project",
      stack: {
        languages: [],
        buildCommand: null,
        testCommand: null,
        lintCommand: null,
        formatCommand: null,
        sourceFileCount: 0,
        signals: {
          codeGenTools: [],
          deployPlatforms: [],
          llmIntegration: false,
          staticAnalysis: [],
          complianceSignals: false,
          formatterGaps: [],
        },
      },
      agents: [],
      shared: {
        footguns: {
          exists: true,
          hasEvidence: false,
          entryCount: 0,
          labelCount: 0,
          hasEvidenceLabels: false,
          dirMentions: new Map(),
          staleRefs: [],
          invalidLineRefs: [],
          duplicateSurfacePaths: [],
          buckets: [],
          totalRefs: 0,
          validRefs: 0,
          formatDiagnostic: null,
          path: ".goat-flow/learning-loop/footguns/",
        },
        lessons: {
          exists: true,
          hasEntries: false,
          entryCount: 0,
          staleRefs: [],
          invalidLineRefs: [],
          duplicateSurfacePaths: [],
          buckets: [],
          formatDiagnostic: null,
          path: ".goat-flow/learning-loop/lessons/",
        },
        decisions: {
          dirExists: true,
          fileCount: 0,
          path: ".goat-flow/learning-loop/decisions/",
          hasRealContent: false,
        },
        config: {
          exists: true,
          valid: true,
          warningCount: 0,
          errorCount: 0,
          parseError: null,
          lineLimits: { target: 125, limit: 150 },
          userRole: "developer",
        },
        architecture: { exists: true, lineCount: 50 },
        ignoreFiles: {
          copilotignore: false,
          cursorignore: false,
        },
        gitignore: { exists: true, hasRequiredEntries: true },
        preflightScript: { exists: false },
        skillConventions: { exists: true },
        localInstructions: {
          dirExists: false,
          location: null,
          aiDirExists: false,
          githubDirExists: false,
          duplicateSurfacePaths: [],
          fileCount: 0,
          hasRouter: false,
          hasValidRouter: false,
          routerNeedsFix: null,
          hasConventions: false,
          conventionsHasContent: false,
          hasFrontend: false,
          hasBackend: false,
          hasCodeReview: false,
          hasGitCommit: false,
          conventionsContent: null,
          localFileSizes: [],
          path: "",
        },
        gitCommitInstructions: {
          exists: false,
          path: null,
          requiredPath: "docs/coding-standards/git-commit-message.md",
          misplacedPaths: [],
        },
        localInstructionsLineCount: 0,
      },
    } as ProjectFacts,
    config: stubConfig(),
    fs: stubFS(),
    structure: STUB_STRUCTURE,
    agents: [stubAgentFacts()],
    agentFilter: null,
    ...overrides,
  };
}

/**
 * Build project facts around a real directory so a test can exercise checks that read the filesystem.
 *
 * @param root - project root the facts describe
 * @param agents - agent facts to attach; empty means the project has no supported agent installed
 * @returns project facts ready to drop into an audit context
 */
export function makeProjectFacts(
  root: string,
  agents: AgentFacts[] = [],
): ProjectFacts {
  const baseFacts = makeCtx().facts;
  return {
    ...baseFacts,
    root,
    agents,
  };
}

/**
 * Writes one file into a fixture project, creating parent directories as needed.
 *
 * @param root - fixture project root
 * @param relativePath - path within the project; missing parent directories are created rather than failing
 * @param content - file contents; the default empty string creates a present but empty file, which several checks treat differently from absent
 * @returns nothing; the file exists once this resolves
 */
export async function writeProjectFile(
  root: string,
  relativePath: string,
  content = "",
): Promise<void> {
  const fullPath = join(root, relativePath);
  await mkdir(dirname(fullPath), { recursive: true });
  await writeFile(fullPath, content);
}

/**
 * Create a temporary project, run one setup function against it, and hand back its cleanup.
 *
 * It writes a temporary directory on disk and throws only after removing it again, so a broken fixture cannot leave scratch directories behind.
 *
 * @param init - callback that populates the fresh project
 * @returns the project root and the cleanup function the test must call
 */
export async function makeTempProject(
  init: (root: string) => Promise<void>,
): Promise<{ root: string; cleanup: () => Promise<void> }> {
  const root = await mkdtemp(join(tmpdir(), "goat-flow-setup-tests-"));
  try {
    await init(root);
  } catch (error) {
    await rm(root, { recursive: true, force: true });
    throw error;
  }

  return {
    root,
    cleanup: () => rm(root, { recursive: true, force: true }),
  };
}

/**
 * Populate a fixture project with the setup artifacts the audit expects to find.
 *
 * The options toggle exactly the artifacts whose presence changes a check result, so one helper covers the pass and fail shapes.
 *
 * @param root - fixture project root
 * @param options - which optional artifacts to create; omitting one is how a test drives that check to fail
 * @returns nothing; the fixture is on disk once this resolves
 */
/**
 * Report whether a manifest path belongs to the shared skill-docs pack.
 *
 * @param manifestPath - a required file or directory from the manifest
 * @returns true when the path sits under the skill-docs tree, so the fixture can omit it on request
 */
function isSkillDocsPath(manifestPath: string): boolean {
  return (
    manifestPath.startsWith(".goat-flow/skill-docs/") ||
    manifestPath === ".goat-flow/skill-docs/" ||
    manifestPath === ".goat-flow/skill-docs/playbooks/"
  );
}

/**
 * Supply the contents one fixture file needs to pass its own audit check.
 *
 * Two files carry real content because checks parse them: the config is read for its version, and the gitignore is
 * compared against the shipped template. Everything else only needs to exist.
 *
 * @param file - manifest-relative path being written
 * @returns the file contents to write
 */
function auditFixtureFileContent(file: string): string {
  if (file === ".goat-flow/config.yaml") {
    return `version: "${AUDIT_VERSION}"\n\nagents:\n  - claude\nskills:\n  install: all\n`;
  }
  if (file === ".goat-flow/.gitignore") {
    return readFileSync(
      join(PROJECT_ROOT, "workflow/setup/reference/goat-flow-gitignore"),
      "utf-8",
    );
  }
  return "# Stub\n";
}

/**
 * Populate a fixture project with the setup artifacts the audit expects to find.
 *
 * The options toggle exactly the artifacts whose presence changes a check result, so one helper covers the pass shape and
 * both failure shapes without a test hand-building the manifest itself.
 * Side effect: writes directories and files into the fixture project on disk.
 *
 * @param root - fixture project root
 * @param options - which optional artifacts to create; omitting one is how a test drives that check to fail
 * @returns nothing; the fixture is on disk once this resolves
 */
export async function writeAuditSetupFixture(
  root: string,
  options: {
    skillReferenceDir: boolean;
    skillReferenceReadme?: boolean;
    instructionPointer: boolean;
  },
): Promise<void> {
  const manifest = JSON.parse(
    readFileSync(join(PROJECT_ROOT, "workflow/manifest.json"), "utf-8"),
  ) as { required_files: string[]; required_dirs: string[] };

  for (const dir of manifest.required_dirs) {
    // Omitting the skill-docs tree is how a test drives the "reference pack missing" checks to fail.
    if (!options.skillReferenceDir && isSkillDocsPath(dir)) continue;
    await mkdir(join(root, dir), { recursive: true });
  }

  for (const file of manifest.required_files) {
    if (!options.skillReferenceDir && isSkillDocsPath(file)) continue;
    // Omitting just the README exercises the narrower "pack present but unreadable" case.
    if (
      options.skillReferenceReadme === false &&
      file === ".goat-flow/skill-docs/README.md"
    ) {
      continue;
    }
    await writeProjectFile(root, file, auditFixtureFileContent(file));
  }

  const instructionContent = options.instructionPointer
    ? `# CLAUDE.md

## Execution Loop: READ -> SCOPE -> ACT -> VERIFY

### READ
Before declaring any tool or capability unavailable, read the matching playbook in .goat-flow/skill-docs/playbooks/ and run that doc's "Availability Check" section verbatim.

### SCOPE

### ACT

### VERIFY

## Router Table

| Resource | Path |
|----------|------|
| Skill playbooks | .goat-flow/skill-docs/playbooks/ |
`
    : "# CLAUDE.md\n";

  await writeProjectFile(root, "CLAUDE.md", instructionContent);
}

/**
 * Build one audit scope block for render and contract tests.
 *
 * @param status - scope status the renderer should display
 * @param checks - checks within the scope; an empty list is valid and renders as a scope with nothing to report
 * @returns the scope object as the report shape expects it
 */
export function makeAuditScope(
  status: "pass" | "fail",
  checks: AuditReport["scopes"]["setup"]["checks"],
): AuditReport["scopes"]["setup"] {
  return {
    status,
    checks,
    failures: checks.flatMap((check) =>
      check.status === "fail" && check.failure ? [check.failure] : [],
    ),
    summary: {},
  };
}

/**
 * Assemble a complete audit report so renderer and output-contract tests have a realistic payload.
 *
 * Every scope defaults to empty, letting a test supply only the scope it asserts on without hand-building the rest.
 *
 * @param root - project path recorded as the audit target
 * @param status - overall report status
 * @param setupChecks - setup-scope checks; empty renders that scope with no rows
 * @param agentChecks - agent-scope checks; empty renders that scope with no rows
 * @param harnessChecks - harness-scope checks; empty renders that scope with no rows
 * @returns the assembled report
 */
export function makeAuditReport(
  root: string,
  status: "pass" | "fail",
  setupChecks: AuditReport["scopes"]["setup"]["checks"] = [],
  agentChecks: AuditReport["scopes"]["agent"]["checks"] = [],
  harnessChecks: AuditReport["scopes"]["setup"]["checks"] = [],
): AuditReport {
  return {
    command: "audit",
    harness: harnessChecks.length > 0,
    status,
    target: root,
    scopes: {
      setup: makeAuditScope(
        setupChecks.some((check) => check.status === "fail") ? "fail" : "pass",
        setupChecks,
      ),
      agent: makeAuditScope(
        agentChecks.some((check) => check.status === "fail") ? "fail" : "pass",
        agentChecks,
      ),
      harness:
        harnessChecks.length > 0
          ? makeAuditScope(
              harnessChecks.some((check) => check.status === "fail")
                ? "fail"
                : "pass",
              harnessChecks,
            )
          : null,
    },
    concerns: null,
    enforcement: [],
    // This minimal fixture selects no agent surfaces, so users see an empty passing coverage section.
    hookCoverage: {
      status: "pass",
      selectedAgents: [],
      summary: {
        selectedSurfaces: 0,
        requiredSurfaces: 0,
        requiredIneffective: 0,
        effective: 0,
        warning: 0,
        danger: 0,
        disabled: 0,
      },
      hooks: [],
    },
    drift: null,
    content: null,
    overall: { status },
  };
}

/**
 * Wrap one harness scope in an otherwise empty report, for tests that assert only on harness detail rendering.
 *
 * @param scope - harness scope to place in the report, supplying both its checks and the overall status
 * @returns a report carrying just that scope
 */
export function makeReportWithDetails(
  scope: NonNullable<AuditReport["scopes"]["harness"]>,
): AuditReport {
  return makeAuditReport(
    "/tmp/test-project",
    scope.status,
    [],
    [],
    scope.checks,
  );
}

/**
 * Create a profile span recorder for audit-cache instrumentation assertions.
 *
 * @returns the profiler to pass into an audit plus the shared `names` array, which fills with span labels in call order
 */
export function createSpanRecorder(): {
  /** Profiler seam accepted by the audit entry points. */
  profile: { span<T>(name: string, block: () => T): T };
  names: string[];
} {
  const names: string[] = [];
  return {
    names,
    profile: {
      /** Record this span's label, then run the block untouched so timing never changes what the audit produces. */
      span<T>(name: string, block: () => T): T {
        names.push(name);
        return block();
      },
    },
  };
}

/**
 * Count recorded profile spans with the exact requested name.
 *
 * @param names - recorded span names in the order they were emitted by the span recorder
 * @param name - the exact span name to match (no prefix or substring matching)
 * @returns how many entries in `names` equal `name`, used to assert a span ran the expected number of times
 */
export function countSpan(names: string[], name: string): number {
  return names.filter((entry) => entry === name).length;
}

// ---------------------------------------------------------------------------
// Test 1: audit passes on a well-configured project (this repo)
// ---------------------------------------------------------------------------

export {
  describe,
  it,
  assert,
  assertExists,
  readFileSync,
  mkdir,
  mkdtemp,
  rm,
  writeFile,
  tmpdir,
  dirname,
  join,
  resolve,
  runAudit,
  computeHarness,
  runAuditBatch,
  createAuditFactsView,
  renderAuditJson,
  renderAuditMarkdown,
  renderAuditText,
  renderAuditSarif,
  parseCLIArgs,
  SETUP_CHECKS,
  AGENT_CHECKS,
  HARNESS_CHECKS,
  extractBacktickPaths,
  AUDIT_VERSION,
  getSkillNames,
  PROFILES,
  composeSetup,
  extractProjectFacts,
  extractHookFacts,
  extractSettingsFacts,
  completeInstruction,
  INSTRUCTION_FILES,
  RATIONALISATIONS_PREAMBLE,
  createFS,
};
