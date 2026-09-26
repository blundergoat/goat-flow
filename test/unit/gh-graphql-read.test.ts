/** Tests the shipped parser without shell execution, network calls, or target node_modules. */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { describe, it } from "node:test";

const require = createRequire(import.meta.url);
const { classify } = require("../../workflow/hooks/gh-graphql-read.cjs") as {
  classify: (rawStage: unknown, args: unknown) => number;
};
const quote = (word: string): string => `'${word.replaceAll("'", "'\\''")}'`;
const classifyArguments = (args: string[]): number =>
  classify(`gh api ${args.map(quote).join(" ")}`, args);

describe("bounded GraphQL document admission", () => {
  const documents = [
    ["shorthand read", "{ viewer { login } }", 0],
    ["named read", "query Read { viewer { login } }", 0],
    [
      "literal operation keyword",
      '{ search(query: "mutation", type: ISSUE) { issueCount } }',
      0,
    ],
    [
      "block string",
      '{ search(query: """mutation { x }""", type: ISSUE) { issueCount } }',
      0,
    ],
    [
      "nested fragments",
      "{ viewer { ...A } } fragment A on User { ...B } fragment B on User { login }",
      0,
    ],
    [
      "fragment variables",
      "query Read($id: ID!) { ...A } fragment A on Query { node(id: $id) { id } }",
      0,
    ],
    ["mutation", "mutation { x }", 2],
    ["subscription", "subscription { x }", 2],
    ["multiple operations", "query A { x } query B { y }", 2],
    ["mixed operations", "query A { x } mutation B { y }", 2],
    ["type definition", "type Query { x: String }", 2],
    ["missing fragment", "{ viewer { ...Missing } }", 2],
    [
      "duplicate fragment",
      "{ viewer { ...A } } fragment A on User { login } fragment A on User { id }",
      2,
    ],
    [
      "fragment cycle",
      "{ viewer { ...A } } fragment A on User { ...B } fragment B on User { ...A }",
      2,
    ],
    ["missing variable", "{ node(id: $id) { id } }", 2],
    [
      "duplicate variable",
      "query Read($id: ID!, $id: ID!) { node(id: $id) { id } }",
      2,
    ],
    ["incomplete syntax", "{ viewer {", 2],
    ["trailing garbage", "{ viewer { login } } garbage", 2],
    ["token limit", `{ ${"x ".repeat(4100)} }`, 2],
    ["text limit", `#${"x".repeat(65_536)}\n{ x }`, 2],
    [
      "fragment limit",
      `{ x } ${Array.from({ length: 65 }, (_, i) => `fragment F${i} on User { login }`).join(" ")}`,
      2,
    ],
  ] as const;
  for (const [name, document, status] of documents) {
    it(name, () => {
      assert.equal(
        classifyArguments(["graphql", "-f", `query=${document}`]),
        status,
      );
    });
  }
});

describe("literal request and field selection", () => {
  const query = "query=query Read { viewer { login } }";
  const cases = [
    ["raw attached query", ["graphql", `--raw-field=${query}`], 0],
    ["typed attached query", ["graphql", `-F=${query}`], 0],
    ["boolean bundle", ["graphql", `-if${query}`], 0],
    ["matching selector", ["graphql", "-f", query, "-foperationName=Read"], 0],
    [
      "nested variables",
      ["graphql", "-f", query, "-F", "input[values][]=42"],
      0,
    ],
    ["pagination", ["graphql", "-f", query, "--paginate", "--slurp"], 0],
    ["duplicate query", ["graphql", "-f", query, "-F", query], 2],
    [
      "duplicate selector",
      ["graphql", "-f", query, "-foperationName=Read", "-FoperationName=Read"],
      2,
    ],
    ["array selector", ["graphql", "-f", query, "-foperationName[]=Read"], 2],
    ["wrong selector", ["graphql", "-f", query, "-foperationName=Other"], 2],
    ["file query", ["graphql", "-Fquery=@request.graphql"], 2],
    ["file variable", ["graphql", "-f", query, "-Fvariable=@request.txt"], 2],
    ["input body", ["graphql", "-f", query, "--input=-"], 2],
    ["placeholder query", ["graphql", "-Fquery={owner}"], 2],
    ["unknown option", ["graphql", "-f", query, "--unknown"], 2],
    ["missing option value", ["graphql", "-f"], 2],
    ["multiple endpoints", ["graphql", "graphql", "-f", query], 2],
    ["known REST delegation", ["repos/owner/repo", "-XGET"], 3],
    ["alternate endpoint", ["/graphql", "-f", query, "-XGET"], 2],
    ["encoded endpoint", ["https://api.github.com/%67raphql", "-XGET"], 2],
    ["enterprise endpoint", ["https://github.example/api/graphql", "-XGET"], 2],
  ] as const;
  for (const [name, args, status] of cases) {
    it(name, () => assert.equal(classifyArguments([...args]), status));
  }
  for (const raw of [
    'gh api graphql -f "query=query Read($id: ID!) { node(id: $id) { id } }"',
    "gh api graphql -f query=$QUERY",
    "gh api graphql -f query=`read-query`",
    "gh api graphql -f 'query={ viewer { login } }",
  ]) {
    it(`rejects unproven shell words: ${raw}`, () => {
      assert.equal(classify(raw, ["graphql", "-f", query]), 2);
    });
  }
  it("accepts double-quoted literal words when decoded bytes match", () => {
    assert.equal(
      classify(`gh api graphql -f "${query}"`, ["graphql", "-f", query]),
      0,
    );
  });
  it("rejects malformed caller inputs", () => {
    assert.equal(classify(null, []), 2);
    assert.equal(classify("gh api", [null]), 2);
  });
});
