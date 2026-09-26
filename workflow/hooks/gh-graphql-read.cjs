/**
 * Admit one literal GitHub GraphQL query without executing command text or reading request files.
 * The Bash policy passes its raw stage and decoded API arguments. Exit 0 proves a query,
 * 2 denies unresolved/unsafe input, and 3 leaves a known REST request to the existing policy.
 */
"use strict";

const { parse } = require("./vendor/graphql.cjs");
const MAX_TEXT_BYTES = 65_536;
const VALUE_FLAGS = new Set(["field", "raw-field", "method", "input", "header", "hostname", "jq", "template", "cache", "preview"]);
const BOOL_FLAGS = new Set(["include", "paginate", "slurp", "silent", "verbose", "allow-escape-sequences", "help"]);
const SHORT_FLAGS = { F: "field", f: "raw-field", X: "method", H: "header", q: "jq", t: "template", p: "preview", i: "include", h: "help" };

/**
 * Recheck literal shell words because the Bash policy's decoded arguments have lost quote provenance.
 * Reject expansion and control syntax instead of guessing the bytes gh would receive.
 */
function literalWords(text) {
  const state = { words: [], word: "", quote: "", started: false };
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (state.quote !== "'" && char === "\\") {
      if (!appendEscapedCharacter(state, text[++i])) return null;
    } else if (!appendLiteralCharacter(state, char)) return null;
  }
  if (state.quote) return null;
  finishLiteralWord(state);
  return state.words;
}

/** Keep quoted empty arguments while discarding unquoted whitespace. */
function finishLiteralWord(state) {
  if (state.started) state.words.push(state.word);
  state.word = "";
  state.started = false;
}

/** Decode Bash escapes without interpreting their contents; a trailing escape is unresolved. */
function appendEscapedCharacter(state, next) {
  if (next === undefined) return false;
  if (next === "\n") return true;
  // Inside double quotes Bash preserves backslashes before ordinary characters.
  if (state.quote === '"' && !['$', '`', '"', '\\'].includes(next)) state.word += "\\";
  state.word += next;
  state.started = true;
  return true;
}

/** Track quoting and reject executable or expanding syntax outside literal single quotes. */
function appendLiteralCharacter(state, char) {
  if (state.quote === "'") {
    if (char === "'") state.quote = "";
    else state.word += char;
    return true;
  }
  if (char === "$" || char === "`") return false;
  if (state.quote === '"') {
    if (char === '"') state.quote = "";
    else state.word += char;
    return true;
  }
  if (char === "'" || char === '"') {
    state.quote = char;
    state.started = true;
    return true;
  }
  if (/\s/u.test(char)) {
    finishLiteralWord(state);
    return true;
  }
  if (/[;&|()<>*?\[\]{}~]/u.test(char) || (char === "#" && !state.started)) return false;
  state.word += char;
  state.started = true;
  return true;
}

/**
 * Parse known gh API flags without opening field files or resolving placeholders.
 * Unknown selection semantics return null because they cannot prove which request gh would execute.
 */
function apiRequest(args) {
  const flags = [];
  const endpoints = [];
  let hasEndedOptions = false;
  for (let i = 0; i < args.length; i += 1) {
    const word = args[i];
    if (word === "--" && !hasEndedOptions) {
      hasEndedOptions = true;
      continue;
    }
    if (hasEndedOptions || !word.startsWith("-") || word === "-") {
      endpoints.push(word);
      continue;
    }
    const lastIndex = word.startsWith("--") ? readLongOption(args, i, flags) : readShortOptions(args, i, flags);
    if (lastIndex === null) return null;
    i = lastIndex;
  }
  return endpoints.length === 1 ? { endpoint: endpoints[0], flags } : null;
}

/** Return the last consumed argv index, or null when the long option cannot be resolved. */
function readLongOption(args, index, flags) {
  const word = args[index];
  const separator = word.indexOf("=");
  const name = word.slice(2, separator < 0 ? undefined : separator);
  const attached = separator < 0 ? undefined : word.slice(separator + 1);
  if (VALUE_FLAGS.has(name)) {
    const operand = attached ?? args[++index];
    if (operand === undefined) return null;
    flags.push([name, operand]);
  } else if (BOOL_FLAGS.has(name) && (attached === undefined || /^(true|false)$/u.test(attached))) {
    flags.push([name, attached ?? "true"]);
  } else return null;
  return index;
}

/** Decode pflag boolean bundles followed by one attached or separated value; null rejects an unknown option. */
function readShortOptions(args, index, flags) {
  const word = args[index];
  for (let j = 1; j < word.length; j += 1) {
    const name = SHORT_FLAGS[word[j]];
    if (!name) return null;
    if (VALUE_FLAGS.has(name)) {
      const rest = word.slice(j + 1);
      const operand = rest ? rest.replace(/^=/u, "") : args[++index];
      if (operand === undefined) return null;
      flags.push([name, operand]);
      break;
    }
    flags.push([name, "true"]);
  }
  return index;
}

/** Match GraphQL URLs or URL-decoding errors so neither reaches REST's GET/HEAD exception. */
function isGraphqlOrUnresolvedEndpoint(endpoint) {
  try {
    const url = new URL(endpoint, "https://api.github.com/");
    const path = decodeURIComponent(url.pathname).replace(/\/+$/u, "").toLowerCase();
    return path === "/graphql" || path === "/api/graphql";
  } catch {
    return true;
  }
}

/**
 * Require one query with resolved fragments and variables because valid syntax alone also admits mixed operations.
 * The server still owns schema validation; these local checks prove only the operation's read classification.
 */
function isReadDocument(query, selectedName) {
  const document = parse(query, { noLocation: true, maxTokens: 4096 });
  const operations = document.definitions.filter((node) => node.kind === "OperationDefinition");
  if (operations.length !== 1 || operations[0].operation !== "query") return false;
  const operation = operations[0];
  if (selectedName !== undefined && selectedName !== operation.name?.value) return false;
  const fragments = documentFragments(document);
  const variables = operationVariables(operation);
  if (!fragments || !variables) return false;
  const edges = new Map();
  for (const definition of document.definitions) {
    const references = definitionReferences(definition, fragments, variables);
    if (!references) return false;
    if (definition.kind === "FragmentDefinition") edges.set(definition.name.value, references);
  }
  return isAcyclicFragmentGraph(edges);
}

/** Index unique fragment definitions within the bound; reject other document definition kinds. */
function documentFragments(document) {
  const fragments = new Map();
  for (const definition of document.definitions) {
    if (definition.kind === "OperationDefinition") continue;
    if (definition.kind !== "FragmentDefinition" || fragments.has(definition.name.value)) return null;
    fragments.set(definition.name.value, definition);
  }
  return fragments.size > 64 ? null : fragments;
}

/** Collect declared variable names, returning null for an ambiguous duplicate declaration. */
function operationVariables(operation) {
  const variables = new Set();
  for (const definition of operation.variableDefinitions) {
    const name = definition.variable.name.value;
    if (variables.has(name)) return null;
    variables.add(name);
  }
  return variables;
}

/** Resolve fragment and variable references without exceeding the per-definition AST bound. */
function definitionReferences(definition, fragments, variables) {
  const references = new Set();
  const pending = [definition];
  let nodes = 0;
  while (pending.length) {
    const node = pending.pop();
    if (++nodes > 16_384) return null;
    if (node.kind === "FragmentSpread") {
      if (!fragments.has(node.name.value)) return null;
      references.add(node.name.value);
    }
    if (node.kind === "Variable" && !variables.has(node.name.value)) return null;
    for (const child of Object.values(node)) {
      if (Array.isArray(child)) pending.push(...child);
      else if (child && typeof child === "object") pending.push(child);
    }
  }
  return references;
}

/** Reject recursive fragment dependencies, including fragments unused by the query. */
function isAcyclicFragmentGraph(edges) {
  const visiting = new Set(), visited = new Set();
  // A second visit on the active path is a cycle; a completed path can be reused.
  function isAcyclic(name) {
    if (visiting.has(name)) return false;
    if (visited.has(name)) return true;
    visiting.add(name);
    for (const target of edges.get(name)) if (!isAcyclic(target)) return false;
    visiting.delete(name);
    visited.add(name);
    return true;
  }
  return [...edges.keys()].every(isAcyclic);
}

/**
 * Return 0 for a proven query, 3 for REST delegation, or 2 on unsafe input, parser errors or unresolved selection.
 * Match raw shell provenance before admitting GraphQL because decoded arguments alone cannot prove literal input.
 */
function classify(rawStage, args) {
  if (!isBoundedInput(rawStage, args)) return 2;
  const request = apiRequest(args);
  if (!request) return 2;
  const literalArgs = hasLiteralArguments(rawStage, args);
  if (!isGraphqlOrUnresolvedEndpoint(request.endpoint)) {
    // REST keeps its policy, but a dynamic endpoint could resolve to GraphQL.
    const endpoint = request.endpoint.replace(/\{(?:owner|repo|branch)\}/gu, "");
    return literalArgs || !/[$`*?\[\]{}\\]/u.test(endpoint) ? 3 : 2;
  }
  // Only gh's canonical GraphQL mode has the inspected variable and pagination semantics.
  if (request.endpoint !== "graphql") return 2;
  if (!literalArgs) return 2;

  const selection = graphqlSelection(request.flags);
  if (!selection) return 2;
  try {
    return isReadDocument(selection.query, selection.operationName) ? 0 : 2;
  } catch {
    // Invalid syntax or parser bounds leave the request unproven, never implicitly allowed.
    return 2;
  }
}

/** Limit the complete parser input before decoding shell words or constructing an AST. */
function isBoundedInput(rawStage, args) {
  if (typeof rawStage !== "string" || !Array.isArray(args)) return false;
  if (args.some((word) => typeof word !== "string")) return false;
  return Buffer.byteLength(rawStage) + args.reduce((sum, word) => sum + Buffer.byteLength(word), 0) <= MAX_TEXT_BYTES;
}

/** Require raw shell provenance to reproduce the decoded API arguments byte for byte. */
function hasLiteralArguments(rawStage, args) {
  const words = literalWords(rawStage);
  const apiIndex = words ? words.length - args.length - 1 : -1;
  return apiIndex >= 1 && words[apiIndex] === "api" && args.every((word, i) => words[apiIndex + i + 1] === word);
}

/** Resolve exactly one query and optional selector; request-body files and conflicting methods remain denied. */
function graphqlSelection(flags) {
  const selection = { query: undefined, operationName: undefined };
  let methodCount = 0;
  for (const [flag, operand] of flags) {
    if (flag === "input") return null;
    if (flag === "method" && (++methodCount > 1 || !/^(GET|HEAD|POST)$/iu.test(operand))) return null;
    if (flag !== "field" && flag !== "raw-field") continue;
    if (!applyGraphqlField(selection, flag, operand)) return null;
  }
  return selection.query === undefined ? null : selection;
}

/** Accept literal fields without reading files; selectors must remain unique, scalar and unexpanded. */
function applyGraphqlField(selection, flag, operand) {
  const equals = operand.indexOf("=");
  if (equals < 1) return false;
  const key = operand.slice(0, equals), field = operand.slice(equals + 1);
  if (!/^[A-Za-z_][A-Za-z_0-9]*(?:\[[A-Za-z_0-9]*\])*$/u.test(key)) return false;
  if (flag === "field" && field.startsWith("@")) return false;
  if (key === "query") {
    if (selection.query !== undefined || (flag === "field" && /\{(?:owner|repo|branch)\}/u.test(field))) return false;
    selection.query = field;
  } else if (key === "operationName") {
    if (selection.operationName !== undefined || !/^[_A-Za-z][_0-9A-Za-z]*$/u.test(field)) return false;
    selection.operationName = field;
  } else if (/^(query|operationName)\[/u.test(key)) return false;
  return true;
}

module.exports = { classify };
if (require.main === module) {
  process.exit(classify(process.argv[2], process.argv.slice(3)));
}
