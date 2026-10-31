/** Verify native substitution inspection forwards each executable interior and refuses forms it cannot inspect. */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { checkPolicyCommandSubstitutions } from "../../workflow/hooks/policy-substitutions.mjs";

/** Run the checker with a recording evaluator that denies any interior naming `deny` under its own scope. */
async function inspect(command: string, depth = 0) {
  const calls: string[] = [];
  const denial = await checkPolicyCommandSubstitutions(
    command,
    depth,
    "destructive",
    async (inner, nested) => {
      calls.push(`${inner}|${nested}`);
      return inner.includes("deny")
        ? { scope: "secret", reason: "denied interior" }
        : null;
    },
  );
  return { calls, denial };
}

describe("policy substitution interiors", () => {
  it("evaluates command and process substitution interiors one level deeper, in order, and keeps the first nested denial", async () => {
    const nested = { scope: "secret", reason: "denied interior" };
    for (const [command, depth, calls, denial] of [
      ["echo $(id)", 0, ["id|1"], null],
      ['echo "é $(id)"', 0, ["id|1"], null],
      ["x $(y)", 2, ["y|3"], null],
      ["cat <(echo a) >(cat) $(id)", 0, ["echo a|1", "cat|1", "id|1"], null],
      ['echo "$(echo ")")"', 0, ['echo ")"|1'], null],
      ["echo $((1 + $(deny)))", 0, ["deny|1"], nested],
      ["echo $(deny) $(later)", 0, ["deny|1"], nested],
    ] as const)
      assert.deepEqual(
        await inspect(command, depth),
        { calls: [...calls], denial },
        command,
      );
  });

  it("leaves quoted, escaped and empty forms uninspected without refusing them", async () => {
    for (const command of [
      "echo '$(deny)'",
      'echo "<(deny)"',
      "echo \\$(deny)",
      "echo $()",
      "echo $((2*3))",
      "echo '`id`'",
    ])
      assert.deepEqual(
        await inspect(command),
        { calls: [], denial: null },
        command,
      );
  });

  it("refuses unterminated substitutions and executable backticks under the caller's scope", async () => {
    const complex =
      "Complex command substitution. Write the expanded command directly.";
    const backtick =
      "Backtick command substitution hides nested execution. Use a direct command instead, or for an inline script run it from a file (e.g. node script.js).";
    for (const [command, reason] of [
      ["echo $(echo", complex],
      ["echo <(cat", complex],
      ["echo `id`", backtick],
      ['echo "`id`"', backtick],
    ])
      assert.deepEqual(
        await inspect(command),
        { calls: [], denial: { scope: "destructive", reason } },
        command,
      );
  });
});
