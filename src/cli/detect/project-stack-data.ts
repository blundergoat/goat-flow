/**
 * Loads and schema-validates the shipped detector tables in workflow/project-stack-data.json, then re-exports each table as a typed constant for the
 * project-stack detector and setup signals.
 *
 * Loaded eagerly at module import: a malformed shipped table throws during startup rather than producing silently wrong detection.
 * The exported PROJECT_STACK_* constants are the only supported way to read these rows; consumers must not re-parse the JSON.
 */
import { readFileSync } from "node:fs";
import { getTemplatePath } from "../paths.js";

/** Package-dependency row that turns Node manifests into canonical framework ids. */
interface NodeFrameworkSignal {
  language: string;
  packages: string[];
}

/** Shared shipped-data shape for detector rows that match paths, globs, or both. */
interface NamedPathGlobSignal {
  paths: string[];
  globs: string[];
}

/** Extra language detector row loaded from the project-stack data table. */
interface LanguagePathGlobSignal extends NamedPathGlobSignal {
  language: string;
}

/** Tool detector row for code generation and deployment signals. */
export interface ToolPathGlobSignal extends NamedPathGlobSignal {
  tool: string;
}

/** Setup dashboard framework marker that scans selected files for package/config tokens. */
interface SetupFrameworkMarkerSignal {
  name: string;
  files: string[];
  markers: string[];
}

/** Node test-framework row used to choose the most specific npm test command. */
interface NodeTestFrameworkSignal {
  name: string;
  packages: string[];
}

/** Parsed schema for workflow/project-stack-data.json after startup validation. */
interface ProjectStackData {
  nodeFrameworks: NodeFrameworkSignal[];
  nodeTestFrameworks: NodeTestFrameworkSignal[];
  extraLanguageSignals: LanguagePathGlobSignal[];
  codeGenSignals: ToolPathGlobSignal[];
  deploySignals: ToolPathGlobSignal[];
  setupFrameworkMarkers: SetupFrameworkMarkerSignal[];
  rootPythonFiles: string[];
  subdirPythonGlobs: string[];
  javaManifestPaths: string[];
  llmEnvFiles: string[];
  llmDepFiles: string[];
  complianceDocs: string[];
  formatterMap: Record<string, string[]>;
}

/** Relative path to the shipped project-stack data tables. */
const PROJECT_STACK_DATA_PATH = "workflow/project-stack-data.json";

/** Treat arrays as invalid records because every shipped data row uses named fields. */
function isRecord(candidate: unknown): candidate is Record<string, unknown> {
  return (
    typeof candidate === "object" &&
    candidate !== null &&
    !Array.isArray(candidate)
  );
}

/** Read a string array from shipped data; throws with the table label on schema drift. */
function readStringArray(rawValue: unknown, label: string): string[] {
  if (
    !Array.isArray(rawValue) ||
    rawValue.some((entry) => typeof entry !== "string")
  ) {
    throw new Error(`${PROJECT_STACK_DATA_PATH} has an invalid ${label} array`);
  }
  return [...rawValue];
}

/** Read language/path/glob rows; throws with row indexes so bad shipped data is fixable. */
function readLanguageSignals(
  value: unknown,
  label: string,
): LanguagePathGlobSignal[] {
  if (!Array.isArray(value)) {
    throw new Error(`${PROJECT_STACK_DATA_PATH} has an invalid ${label} list`);
  }
  return value.map((entry, index) => {
    if (!isRecord(entry) || typeof entry.language !== "string") {
      throw new Error(
        `${PROJECT_STACK_DATA_PATH} has an invalid ${label}[${index}] entry`,
      );
    }
    return {
      language: entry.language,
      paths: readStringArray(entry.paths, `${label}[${index}].paths`),
      globs: readStringArray(entry.globs, `${label}[${index}].globs`),
    };
  });
}

/** Read tool/path/glob rows; throws before detector startup can use malformed data. */
function readToolSignals(
  rawValue: unknown,
  label: string,
): ToolPathGlobSignal[] {
  if (!Array.isArray(rawValue)) {
    throw new Error(`${PROJECT_STACK_DATA_PATH} has an invalid ${label} list`);
  }
  return rawValue.map((entry, index) => {
    if (!isRecord(entry) || typeof entry.tool !== "string") {
      throw new Error(
        `${PROJECT_STACK_DATA_PATH} has an invalid ${label}[${index}] entry`,
      );
    }
    return {
      tool: entry.tool,
      paths: readStringArray(entry.paths, `${label}[${index}].paths`),
      globs: readStringArray(entry.globs, `${label}[${index}].globs`),
    };
  });
}

/** Read setup-framework marker rows from the project-stack data JSON. */
function readSetupFrameworkMarkers(
  value: unknown,
  label: string,
): SetupFrameworkMarkerSignal[] {
  if (!Array.isArray(value)) {
    throw new Error(`${PROJECT_STACK_DATA_PATH} has an invalid ${label} list`);
  }
  return value.map((entry, index) => {
    if (!isRecord(entry) || typeof entry.name !== "string") {
      throw new Error(
        `${PROJECT_STACK_DATA_PATH} has an invalid ${label}[${index}] entry`,
      );
    }
    return {
      name: entry.name,
      files: readStringArray(entry.files, `${label}[${index}].files`),
      markers: readStringArray(entry.markers, `${label}[${index}].markers`),
    };
  });
}

/** Read Node framework rows from the project-stack data JSON. */
function readNodeFrameworkSignals(
  value: unknown,
  label: string,
): NodeFrameworkSignal[] {
  if (!Array.isArray(value)) {
    throw new Error(`${PROJECT_STACK_DATA_PATH} has an invalid ${label} list`);
  }
  return value.map((entry, index) => {
    if (!isRecord(entry) || typeof entry.language !== "string") {
      throw new Error(
        `${PROJECT_STACK_DATA_PATH} has an invalid ${label}[${index}] entry`,
      );
    }
    return {
      language: entry.language,
      packages: readStringArray(entry.packages, `${label}[${index}].packages`),
    };
  });
}

/** Read Node test framework rows from the project-stack data JSON. */
function readNodeTestFrameworkSignals(
  value: unknown,
  label: string,
): NodeTestFrameworkSignal[] {
  if (!Array.isArray(value)) {
    throw new Error(`${PROJECT_STACK_DATA_PATH} has an invalid ${label} list`);
  }
  return value.map((entry, index) => {
    if (!isRecord(entry) || typeof entry.name !== "string") {
      throw new Error(
        `${PROJECT_STACK_DATA_PATH} has an invalid ${label}[${index}] entry`,
      );
    }
    return {
      name: entry.name,
      packages: readStringArray(entry.packages, `${label}[${index}].packages`),
    };
  });
}

/** Read formatter mappings; throws if a language maps to anything other than strings. */
function readFormatterMap(rawValue: unknown): Record<string, string[]> {
  if (!isRecord(rawValue)) {
    throw new Error(`${PROJECT_STACK_DATA_PATH} has an invalid formatterMap`);
  }
  return Object.fromEntries(
    Object.entries(rawValue).map(([language, formatters]) => [
      language,
      readStringArray(formatters, `formatterMap.${language}`),
    ]),
  );
}

/** Load shipped detector tables once; throws during startup when the JSON schema drifts. */
function loadProjectStackData(): ProjectStackData {
  const path = getTemplatePath(PROJECT_STACK_DATA_PATH);
  const raw = JSON.parse(readFileSync(path, "utf-8")) as unknown;
  if (!isRecord(raw)) {
    throw new Error(`${PROJECT_STACK_DATA_PATH} must contain a JSON object`);
  }
  return {
    nodeFrameworks: readNodeFrameworkSignals(
      raw.nodeFrameworks,
      "nodeFrameworks",
    ),
    nodeTestFrameworks: readNodeTestFrameworkSignals(
      raw.nodeTestFrameworks,
      "nodeTestFrameworks",
    ),
    extraLanguageSignals: readLanguageSignals(
      raw.extraLanguageSignals,
      "extraLanguageSignals",
    ),
    codeGenSignals: readToolSignals(raw.codeGenSignals, "codeGenSignals"),
    deploySignals: readToolSignals(raw.deploySignals, "deploySignals"),
    setupFrameworkMarkers: readSetupFrameworkMarkers(
      raw.setupFrameworkMarkers,
      "setupFrameworkMarkers",
    ),
    rootPythonFiles: readStringArray(raw.rootPythonFiles, "rootPythonFiles"),
    subdirPythonGlobs: readStringArray(
      raw.subdirPythonGlobs,
      "subdirPythonGlobs",
    ),
    javaManifestPaths: readStringArray(
      raw.javaManifestPaths,
      "javaManifestPaths",
    ),
    llmEnvFiles: readStringArray(raw.llmEnvFiles, "llmEnvFiles"),
    llmDepFiles: readStringArray(raw.llmDepFiles, "llmDepFiles"),
    complianceDocs: readStringArray(raw.complianceDocs, "complianceDocs"),
    formatterMap: readFormatterMap(raw.formatterMap),
  };
}

const PROJECT_STACK_DATA = loadProjectStackData();

/** Node.js framework indicators matched against package dependencies. */
export const PROJECT_STACK_NODE_FRAMEWORKS = PROJECT_STACK_DATA.nodeFrameworks;
/** Additional language/template indicators beyond primary manifest detection. */
export const PROJECT_STACK_EXTRA_LANGUAGE_SIGNALS =
  PROJECT_STACK_DATA.extraLanguageSignals;
/** Code generation tool indicators detected from config files. */
export const PROJECT_STACK_CODE_GENERATION_SIGNALS =
  PROJECT_STACK_DATA.codeGenSignals;
/** Deployment platform indicators detected from config files. */
export const PROJECT_STACK_DEPLOYMENT_SIGNALS =
  PROJECT_STACK_DATA.deploySignals;
/** Extra framework markers used only for setup-view framework display names. */
export const PROJECT_STACK_SETUP_FRAMEWORK_MARKERS =
  PROJECT_STACK_DATA.setupFrameworkMarkers;
/** Root-level files that indicate a Python project. */
export const PROJECT_STACK_ROOT_PYTHON_FILES =
  PROJECT_STACK_DATA.rootPythonFiles;
/** Glob patterns for detecting Python projects in subdirectories. */
export const PROJECT_STACK_SUBDIRECTORY_PYTHON_GLOBS =
  PROJECT_STACK_DATA.subdirPythonGlobs;
/** Build manifest paths read to detect Java framework dependencies. */
export const PROJECT_STACK_JAVA_MANIFEST_PATHS =
  PROJECT_STACK_DATA.javaManifestPaths;
/** Environment files checked for LLM provider API key variables. */
export const PROJECT_STACK_LLM_ENV_FILES = PROJECT_STACK_DATA.llmEnvFiles;
/** Dependency files checked for LLM SDK references. */
export const PROJECT_STACK_LLM_DEPENDENCY_FILES =
  PROJECT_STACK_DATA.llmDepFiles;
/** Files checked for compliance-related keywords (HIPAA, GDPR, etc.). */
export const PROJECT_STACK_COMPLIANCE_DOCS = PROJECT_STACK_DATA.complianceDocs;
/** Maps languages to their known formatter tool names for gap detection. */
export const PROJECT_STACK_FORMATTER_MAP = PROJECT_STACK_DATA.formatterMap;
