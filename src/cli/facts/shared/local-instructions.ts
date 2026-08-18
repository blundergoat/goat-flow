/**
 * Local instruction fact extraction - detects existing project-specific guidance under `.github/instructions/`. `.goat-flow/coding-standards/` is
 * user-owned, not framework-managed - ignored here.
 */
import type { SharedFacts, ReadonlyFS } from "../../types.js";

/** Active local instruction directory and which convention selected it. */
interface LocalInstructionDir {
  location: "ai" | "github";
  dir: string;
}

/** Feature flags inferred from local instruction filenames. */
interface LocalInstructionFlags {
  hasConventions: boolean;
  hasFrontend: boolean;
  hasBackend: boolean;
  hasCodeReview: boolean;
  hasGitCommit: boolean;
}

/** Router-table validation result for local instruction link targets. */
interface RouterValidation {
  hasValidRouter: boolean;
  routerNeedsFix: string | null;
  invalidRefs: string[];
}

const GITHUB_INSTRUCTIONS_DIR = ".github/instructions";

/** Resolve the active local instruction directory. */
function resolveLocalInstructionDir(
  hasGithubDirectory: boolean,
): LocalInstructionDir | null {
  if (hasGithubDirectory)
    return { location: "github", dir: GITHUB_INSTRUCTIONS_DIR };
  return null;
}

/** Create the empty local-instructions fact payload. */
function createEmptyLocalInstructions(): SharedFacts["localInstructions"] {
  return {
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
    path: GITHUB_INSTRUCTIONS_DIR,
  };
}

/** Check whether a basename exists in either supported instruction filename form. */
function hasInstructionFile(files: string[], baseName: string): boolean {
  return files.some(
    (file) =>
      file === `${baseName}.md` || file === `${baseName}.instructions.md`,
  );
}

/** Collect local-instruction feature flags from the discovered files. */
function collectLocalInstructionFlags(files: string[]): LocalInstructionFlags {
  return {
    hasConventions: hasInstructionFile(files, "conventions"),
    hasFrontend: hasInstructionFile(files, "frontend"),
    hasBackend: hasInstructionFile(files, "backend"),
    hasCodeReview: hasInstructionFile(files, "code-review"),
    hasGitCommit: hasInstructionFile(files, "git-commit"),
  };
}

/** Collect line counts for the discovered local instruction files. */
function collectLocalFileSizes(
  fs: ReadonlyFS,
  dir: string,
  files: string[],
): Array<{ path: string; lines: number }> {
  return files.map((file) => ({
    path: `${dir}/${file}`,
    lines: fs.lineCount(`${dir}/${file}`),
  }));
}

/** Check whether a conventions file contains substantial project guidance. */
function hasConventionsContent(content: string): boolean {
  const hasCommands = /##.*command|```bash|```sh/i.test(content);
  const hasConventionRules =
    /##.*convention|do.*don't|do:.*don't:|good.*bad/i.test(content);
  const lineCount = content.split("\n").length;
  return hasCommands && hasConventionRules && lineCount > 15;
}

/** Check whether a README reference looks like a real repo path. */
function isReadableRouterRef(rawRef: string): boolean {
  const ref = rawRef.trim();
  if (!ref) return false;
  if (ref.startsWith("http://") || ref.startsWith("https://")) return false;
  if (ref.startsWith("$")) return false;
  if (!ref.includes("/") && /\b(README|docs|command|format|lint)\b/i.test(ref))
    return false;
  if (ref.includes(" ")) return false;
  return /(?:^\.\/|^\.\.\/|^[\w-]+\/|^[a-zA-Z0-9._-]+\.[a-zA-Z0-9]+$)/.test(
    ref,
  );
}

/** Remove any heading anchor from a router reference. */
function stripRouterAnchor(ref: string): string {
  const anchorIndex = ref.indexOf("#");
  if (anchorIndex === -1) return ref.trim();
  return ref.slice(0, anchorIndex).trim();
}

/** Extract repo-local file references from markdown links and code spans. */
function extractRouterRefsFromMarkdown(content: string): string[] {
  const refs = new Set<string>();

  for (const match of content.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
    const raw = match[1];
    if (!raw) continue;
    const ref = stripRouterAnchor(raw);
    if (isReadableRouterRef(ref)) refs.add(ref);
  }

  for (const match of content.matchAll(/`([^`]+)`/g)) {
    const raw = match[1];
    if (!raw) continue;
    const ref = stripRouterAnchor(raw);
    if (isReadableRouterRef(ref)) refs.add(ref);
  }

  return Array.from(refs);
}

/** Validate router references against files that actually exist. */
function validateRouterLinks(
  fs: ReadonlyFS,
  aiReadmeContent: string | null,
): RouterValidation {
  if (aiReadmeContent === null) {
    return {
      hasValidRouter: false,
      invalidRefs: [],
      routerNeedsFix:
        ".goat-flow/README.md missing - create it and reference existing project guidance if you use this surface",
    };
  }

  const refs = extractRouterRefsFromMarkdown(aiReadmeContent);
  if (refs.length === 0) {
    return {
      hasValidRouter: false,
      invalidRefs: [],
      routerNeedsFix:
        ".goat-flow/README.md should reference at least one real project guidance file.",
    };
  }

  const invalidRefs = refs.filter((ref) => !fs.exists(ref));
  if (invalidRefs.length > 0) {
    return {
      hasValidRouter: false,
      invalidRefs,
      routerNeedsFix: `.goat-flow/README.md references missing paths: ${invalidRefs.join(", ")}`,
    };
  }

  return {
    hasValidRouter: true,
    invalidRefs: [],
    routerNeedsFix: null,
  };
}

/** Read the conventions file and score whether it has real content. */
function analyzeConventionsContent(
  fs: ReadonlyFS,
  _location: LocalInstructionDir["location"],
  hasConventions: boolean,
): Pick<
  SharedFacts["localInstructions"],
  "conventionsContent" | "conventionsHasContent"
> {
  if (!hasConventions) {
    return { conventionsContent: null, conventionsHasContent: false };
  }

  const conventionsPath = `${GITHUB_INSTRUCTIONS_DIR}/conventions.instructions.md`;
  const conventionsContent = fs.readFile(conventionsPath);
  return {
    conventionsContent,
    conventionsHasContent:
      conventionsContent !== null && hasConventionsContent(conventionsContent),
  };
}

/** Resolve router-validation facts for the active instruction surface. */
function resolveRouterValidation(
  fs: ReadonlyFS,
  location: LocalInstructionDir["location"],
): {
  hasRouter: boolean;
  routerValidation: RouterValidation;
} {
  const hasRouter = location === "ai" && fs.exists(".goat-flow/README.md");
  const routerValidation =
    location === "ai"
      ? validateRouterLinks(fs, fs.readFile(".goat-flow/README.md"))
      : { hasValidRouter: true, routerNeedsFix: null, invalidRefs: [] };
  return { hasRouter, routerValidation };
}

/**
 * Extract local-instruction facts from the project instruction surface.
 *
 * @param fs - project filesystem adapter used to inspect local instruction files
 * @returns local instruction presence, flags, router status, and validation details
 */
export function extractLocalInstructions(
  fs: ReadonlyFS,
): SharedFacts["localInstructions"] {
  const githubDirExists = fs.exists(GITHUB_INSTRUCTIONS_DIR);

  const localInstructionDir = resolveLocalInstructionDir(githubDirExists);
  if (localInstructionDir === null) return createEmptyLocalInstructions();

  const files = fs
    .listDir(localInstructionDir.dir)
    .filter((file) => file.endsWith(".md"));
  const flags = collectLocalInstructionFlags(files);
  const conventions = analyzeConventionsContent(
    fs,
    localInstructionDir.location,
    flags.hasConventions,
  );
  const { hasRouter, routerValidation } = resolveRouterValidation(
    fs,
    localInstructionDir.location,
  );

  return {
    dirExists: true,
    location: localInstructionDir.location,
    aiDirExists: false,
    githubDirExists,
    duplicateSurfacePaths: [],
    fileCount: files.length,
    hasRouter,
    hasValidRouter: routerValidation.hasValidRouter,
    routerNeedsFix: routerValidation.routerNeedsFix,
    hasConventions: flags.hasConventions,
    conventionsHasContent: conventions.conventionsHasContent,
    hasFrontend: flags.hasFrontend,
    hasBackend: flags.hasBackend,
    hasCodeReview: flags.hasCodeReview,
    hasGitCommit: flags.hasGitCommit,
    conventionsContent: conventions.conventionsContent,
    localFileSizes: collectLocalFileSizes(fs, localInstructionDir.dir, files),
    path: localInstructionDir.dir,
  };
}
