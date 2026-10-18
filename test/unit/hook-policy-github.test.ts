/** Exercise native GitHub write decisions with retained frozen-policy controls and no CLI launches. */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  checkRepositorySegment,
  inspectGhWriteOperation,
  isGhWriteOperation,
} from "../../workflow/hooks/deny-dangerous/github-command.mjs";

const namedCommands: ReadonlyArray<readonly [string, boolean]> = [
  ["gh pr lock 61", true],
  ["gh discussion comment 61 --body x", true],
  ["gh discussion view 61", false],
  ["gh agent-task list", false],
  ["gh gist rename abc old.md new.md", true],
  ["gh gist view abc", false],
  ["gh codespace ports visibility 3000:public -c example", true],
  ["gh codespace ports -c example", false],
  ["gh codespace ssh -- touch /tmp/review-write", true],
  ["gh codespace ssh --config -- touch /tmp/review-write", true],
  ["gh codespace ssh --config", false],
  ["gh codespace cp --help", false],
  ["gh alias set pv 'pr view'", true],
  ["gh alias list", false],
  ["gh co 12", true],
  ["gh PR view 61", true],
  ["gh ext install owner/gh-review", true],
  ["gh ext list", false],
  ["gh $github_create_topic new x", true],
  ["gh variable remove FOO", true],
  ["gh config set editor vim", true],
  ["gh config get editor", false],
  ["gh auth switch --user example", true],
  ["gh auth status", false],
  ["gh repo autolink create TICKET- 'https://example.com/<num>'", true],
  ["gh repo autolink list", false],
  ["2>/dev/null gh issue create --title x --body y", true],
  ["xargs --arg-file commands.txt gh pr create --fill", true],
  ["gh issue comment 1 --body hi", false],
  ["gh pr comment 123 --body lgtm", false],
  ["gh pr -R owner/repo review 123 --approve", true],
  ["gh repo deploy-key add deploy.pub", true],
  ["gh repo deploy-key list", false],
  [
    "rg -n 'gh issue comment 1 --body hi' .goat-flow/learning-loop/footguns",
    false,
  ],
];

const booleanOptions: ReadonlyArray<readonly [string, boolean]> = [
  ["gh skill publish --dry-run", false],
  ["gh extension browse", true],
  ["gh extension browse --help=false", true],
  ["gh extension browse --help", false],
  ["gh --repo owner/project pr co 123 --force=true", true],
  ["gh pr checkout 123 --force=false -f", true],
  ["gh pr checkout 123 -fbtopic", true],
  ["gh pr checkout 123 --force --detach --detach=false", true],
  ["gh pr checkout 123 --force --detach", false],
  ["gh pr co 123 -f --detach=false --detach=true", false],
  ["gh pr checkout 123 -bfeature", false],
  ["gh pr checkout 123 -- --force", false],
  ["gh pr checkout 123 --force --help", false],
  ["gh skill publish --tag --dry-run", true],
  ["gh skill publish -- --dry-run", true],
  ["gh skill publish --dry-run --fix", true],
  ["gh skill publish ./skills --dry-run=true --tag v1.2.3", false],
  ["gh skill publish --dry-run=false --dry-run", false],
  ["gh --repo owner/project skill publish --dry-run", false],
  ["gh skill --dry-run publish", false],
  ["gh skill publish --dry-run --fix=false", false],
];

const apiCommands: ReadonlyArray<readonly [string, boolean]> = [
  [
    'gh api graphql -f \'query={ repository(owner: "blundergoat", name: "goat-flow") { discussions(first: 1) { nodes { title } } } }\'',
    false,
  ],
  [
    "gh api graphql -X GET -f 'query=mutation { deleteIssue(input: {issueId: \"inert\"}) { clientMutationId } }'",
    true,
  ],
  ["gh api repos/owner/repo/issues/1/comments -X POST -f body=hi", true],
  ["gh api repos/owner/repo/issues --method GET -f state=open", false],
  [
    "gh api -f 'query=query Read($name: String!) { repositoryOwner(login: $name) { login } }' graphql -F name=blundergoat -f operationName=Read",
    false,
  ],
  [
    "gh api graphql -f 'query={ viewer { ...Fields } } fragment Fields on User { login }'",
    false,
  ],
  [
    "gh api graphql -f 'query=query Read { viewer { login } } mutation Write { x }' -f operationName=Read",
    true,
  ],
  [
    "gh api graphql -f 'query={ viewer { login } }' -F query=@request.graphql",
    true,
  ],
  ['gh api graphql -f query="$QUERY"', true],
  ["gh api graphql --input - -X HEAD", true],
];

describe("native GitHub write rules", () => {
  it("retains named writes, unknown aliases and read-only controls", () => {
    for (const [command, expected] of namedCommands)
      assert.equal(isGhWriteOperation(command), expected, command);
  });
  it("honors final Boolean values and keeps quoted operands out of flag decisions", () => {
    for (const [command, expected] of booleanOptions)
      assert.equal(isGhWriteOperation(command), expected, command);
  });
  it("proves GraphQL queries before REST method exemptions", () => {
    for (const [command, expected] of apiCommands)
      assert.equal(isGhWriteOperation(command), expected, command);
  });
  it("distinguishes unknown extensions from known writes for the denial reason", () => {
    assert.deepEqual(inspectGhWriteOperation("gh custom action"), {
      write: true,
      uninspectable: true,
    });
    assert.deepEqual(inspectGhWriteOperation("gh extension exec custom"), {
      write: true,
      uninspectable: true,
    });
    assert.deepEqual(inspectGhWriteOperation("gh issue create"), {
      write: true,
      uninspectable: false,
    });
  });
  it("checks the downstream pipeline and preserves read-only pipelines", () => {
    const context = { verb: "printf", hasRedirect: false, hasPipe: true };
    assert.match(
      checkRepositorySegment(
        "printf body | gh pr create --body-file -",
        context,
      ) ?? "",
      /GitHub write via gh is blocked/,
    );
    assert.equal(checkRepositorySegment("gh issue list | cat", context), null);
    assert.match(
      checkRepositorySegment("printf body | gh custom", context) ?? "",
      /Cannot inspect a gh alias or extension/,
    );
  });
});
