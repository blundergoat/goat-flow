/** Replays inert GraphQL requests through candidate hooks, including provider-shaped input. */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { after, describe, it } from "node:test";

const fixture = mkdtempSync(resolve(tmpdir(), "goat-graphql-policy-"));
const hooks = resolve(fixture, ".goat-flow/hooks");
mkdirSync(hooks, { recursive: true });
cpSync(resolve(import.meta.dirname, "../../workflow/hooks"), hooks, {
  recursive: true,
});
assert.equal(spawnSync("git", ["init", "-q", fixture]).status, 0);
after(() => rmSync(fixture, { recursive: true, force: true }));

const discussionQuery =
  '{ repository(owner: "blundergoat", name: "goat-flow") { discussions(first: 1) { nodes { title } } } }';
const allowed = [
  `gh api graphql -f query='${discussionQuery}'`,
  "gh api -f 'query={ viewer { login } }' graphql",
  "gh api graphql --raw-field='query=query Read { viewer { login } }' --field operationName=Read",
  "gh api graphql -f'query={ viewer { login } }' -XPOST",
  "gh api graphql -F'query={ viewer { login } }' --method=POST",
  "gh api graphql -f='query={ viewer { login } }' --method GET",
  "gh api graphql --paginate --slurp -F owner=blundergoat -f 'query=query Read($owner: String!, $endCursor: String) { repositoryOwner(login: $owner) { repositories(first: 1, after: $endCursor) { nodes { name } pageInfo { hasNextPage endCursor } } } }'",
  "gh api graphql -f 'query=# mutation is inert comment text\nquery Read { viewer { ...UserFields } } fragment UserFields on User { login }'",
  "gh api graphql -f 'query={ search(query: \"mutation { deleteIssue }\", type: ISSUE, first: 1) { issueCount } }'",
  'gh api graphql -f \'query={ search(query: """mutation { deleteIssue }""", type: ISSUE, first: 1) { issueCount } }\'',
  "env --debug gh api graphql -f 'query={ viewer { login } }'",
  "gh api graphql -f 'query={ viewer { login } }' | jq '.data.viewer.login'",
  "gh api repos/blundergoat/goat-flow --method GET -f per_page=1",
  "gh api 'repos/blundergoat/goat-flow/issues?state=open' --method GET",
  "gh api repos/{owner}/{repo}/issues --method GET",
  "gh issue list",
  "gh issue comment 42 --body ready",
];
const denied = [
  "gh api graphql -f 'query=mutation { deleteIssue(input: {issueId: \"inert\"}) { clientMutationId } }'",
  "gh api graphql --method GET -f 'query=mutation { deleteIssue(input: {issueId: \"inert\"}) { clientMutationId } }'",
  "gh api graphql --method HEAD -f 'query=mutation { deleteIssue(input: {issueId: \"inert\"}) { clientMutationId } }'",
  "gh api graphql -f 'query=subscription { viewer { login } }'",
  "gh api graphql -f 'query=query Read { viewer { login } } mutation Write { deleteIssue(input: {issueId: \"inert\"}) { clientMutationId } }' -f operationName=Read",
  "gh api graphql -f 'query=query A { viewer { login } } query B { viewer { id } }' -f operationName=A",
  "gh api graphql -f 'query={ viewer { login } }' -F 'query=mutation { x }'",
  "gh api graphql -F 'query=mutation { x }' -f 'query={ viewer { login } }'",
  "gh api graphql -f 'query=query Read { viewer { login } }' -f operationName=Read -f operationName=Read",
  "gh api graphql -f 'query=query Read { viewer { login } }' -f operationName=Other",
  "gh api graphql -f 'query[]={ viewer { login } }'",
  "gh api graphql -F query=@request.graphql",
  "gh api graphql -F query=@-",
  "gh api graphql --input request.json -f 'query={ viewer { login } }'",
  "gh api graphql --input - --method GET",
  'gh api graphql -f query="$QUERY"',
  "gh api graphql -f 'query={ viewer { login } }' -f query=\"$QUERY\"",
  'gh api graphql -f "query={ search(query: \\"$SEARCH\\", type: ISSUE) { issueCount } }"',
  "gh api graphql -f 'query={ viewer {'",
  "gh api graphql -f 'query={}'",
  "gh api graphql -f 'query={ viewer { ...Missing } }'",
  "gh api graphql -f 'query={ viewer { ...Loop } } fragment Loop on User { ...Loop }'",
  "gh api graphql -f 'query={ node(id: $missing) { id } }'",
  "gh api graphql -f 'query={ viewer { login } }' --unknown-option value",
  "gh api /graphql -X GET -f 'query=mutation { x }'",
  "gh api 'https://api.github.com/graphql?query=mutation' -X GET",
  "gh api graphql -X DELETE -f 'query={ viewer { login } }'",
  "gh api graphql -X GET -X POST -f 'query={ viewer { login } }'",
  "gh api $ENDPOINT -X GET -f 'query=mutation { x }'",
  "gh api graphq? -X GET -f 'query=mutation { x }'",
  "gh api repos/blundergoat/goat-flow -X POST -f body=inert",
];

describe("GraphQL read-only policy", () => {
  for (const [commands, expectedStatus] of [
    [allowed, 0],
    [denied, 2],
  ] as const) {
    for (const command of commands) {
      for (const isProviderInput of [false, true]) {
        it(`${expectedStatus === 0 ? "allows" : "denies"} ${command} (${isProviderInput ? "provider" : "check"})`, () => {
          const result = spawnSync(
            "bash",
            [
              resolve(hooks, "deny-git-mutations.sh"),
              ...(isProviderInput ? [] : ["--check", command]),
            ],
            {
              cwd: fixture,
              encoding: "utf8",
              input: isProviderInput
                ? JSON.stringify({ tool_name: "Bash", tool_input: { command } })
                : undefined,
            },
          );
          assert.equal(result.status, expectedStatus, result.stderr);
          if (expectedStatus === 2)
            assert.match(result.stderr, /Policy repository/u);
          else assert.equal(result.stderr, "");
        });
      }
    }
  }
});

describe("GraphQL dependency completeness", () => {
  for (const dependency of ["gh-graphql-read.cjs", "vendor/graphql.cjs"]) {
    it(`fails closed when ${dependency} is absent`, () => {
      const incomplete = mkdtempSync(
        resolve(tmpdir(), "goat-graphql-missing-"),
      );
      const incompleteHooks = resolve(incomplete, ".goat-flow/hooks");
      try {
        cpSync(hooks, incompleteHooks, { recursive: true });
        rmSync(resolve(incompleteHooks, dependency));
        assert.equal(spawnSync("git", ["init", "-q", incomplete]).status, 0);
        const result = spawnSync(
          "bash",
          [
            resolve(incompleteHooks, "deny-git-mutations.sh"),
            "--check",
            allowed[0],
          ],
          { cwd: incomplete, encoding: "utf8" },
        );
        assert.equal(result.status, 2, result.stderr);
        assert.match(result.stderr, /Policy hook unavailable/u);
      } finally {
        rmSync(incomplete, { recursive: true, force: true });
      }
    });
  }
});
