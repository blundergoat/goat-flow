/**
 * Direct checks for the launch-wrapper parsers in policy-prefixes.mts, run against the generated workflow/hooks copy that ships.
 * Each table pairs a wrapper's text after its executable with the payload the hook must see, so a regression shows up as one named row.
 *
 * The rows pin the three outcomes the composed normalizer relies on: the child command with its argv quoting kept, "absent" when
 * the wrapper launches nothing, and "unresolved" whenever an option is unknown or missing its value, which makes the hook refuse.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  normalizePolicyTimePrefix,
  normalizePolicySudoPrefix,
  policyWordStartsWithRedirection,
  normalizePolicyExecPrefix,
  normalizePolicyTimeoutPrefix,
  normalizePolicySetsidPrefix,
  normalizePolicyStdbufPrefix,
  normalizePolicyIonicePrefix,
  normalizePolicyTasksetPrefix,
  normalizePolicyChrtPrefix,
  normalizePolicyFlockPrefix,
} from "../../workflow/hooks/policy-prefixes.mjs";

describe("policy timing and privilege prefixes", () => {
  it("reveals time payloads after supported flags and quoted format/output settings", () => {
    for (const input of [
      " -p -v -q -a git 'status'",
      "--portability --verbose --quiet --append git 'status'",
      "--format '%E %C' --output='two files' git 'status'",
      "-f%E -oout -- git 'status'",
      "-f 'first\nsecond' git 'status'",
    ])
      assert.equal(normalizePolicyTimePrefix(input), "git 'status'", input);
  });

  it("retains time's uncertain options and handles settings without a child", () => {
    for (const [input, expected] of [
      ["--unknown git push", "--unknown git push"],
      ["-p", "-p"],
      ["--output", "--output"],
      ["-f value", ""],
      ["--output=file", ""],
      ["-- -p git status", "git status"],
      [" \t\r\n", ""],
    ])
      assert.equal(normalizePolicyTimePrefix(input ?? ""), expected, input);
  });

  it("reveals sudo payloads after known identity, environment and privilege flags", () => {
    for (const input of [
      "-u root -g wheel git 'status'",
      "-uroot -gwheel -nEH git 'status'",
      "--user=root --group=wheel --preserve-env=HOME git 'status'",
      "--askpass --background --non-interactive git 'status'",
      "--chdir=/repo -C 3 -R /root -T 5 -p prompt -- git 'status'",
    ])
      assert.equal(normalizePolicySudoPrefix(input), "git 'status'", input);
  });

  it("retains sudo's raw operands and refuses unknown or incomplete options", () => {
    for (const [input, expected] of [
      ["--unknown value git push", null],
      ["-u", null],
      ["-- -n git status", "-n git status"],
      ["git '--user=root' status", "git '--user=root' status"],
      ["", ""],
      ["\u00a0git status", "\u00a0git status"],
    ])
      assert.equal(normalizePolicySudoPrefix(input ?? ""), expected, input);
  });
});

describe("policy exec payloads", () => {
  it("recognizes only an ASCII descriptor followed immediately by a redirection", () => {
    for (const word of [">file", "<input", "2>>log", "123<>file"])
      assert.equal(policyWordStartsWithRedirection(word), true, word);
    for (const word of ["", "2", " 2>file", "name>file", "٢>file", "&>file"])
      assert.equal(policyWordStartsWithRedirection(word), false, word);
  });

  it("reveals exec children after argv-name and launch-environment options", () => {
    for (const input of [
      "-a 'display name' -cl git 'a b'",
      "-c -l -- git 'a b'",
      "git 'a b'",
    ])
      assert.deepEqual(
        normalizePolicyExecPrefix(input),
        {
          kind: "command",
          command: "git a\\ b",
        },
        input,
      );
  });

  it("distinguishes exec uncertainty from redirection-only and absent launches", () => {
    for (const input of ["-a", "-x git push", "-aVALUE git push"])
      assert.deepEqual(
        normalizePolicyExecPrefix(input),
        { kind: "unresolved" },
        input,
      );
    for (const input of ["", "-cl", "--", "2>log", "-a display >log"])
      assert.deepEqual(
        normalizePolicyExecPrefix(input),
        { kind: "absent" },
        input,
      );
  });
});

describe("policy duration and session prefixes", () => {
  it("reveals timeout children after separated or attached settings and the duration", () => {
    for (const input of [
      "-s TERM -k 1 --foreground 5 git 'a b'",
      "--signal=TERM --kill-after=1 --preserve-status --verbose 5 git 'a b'",
      "-sTERM -k1 -v -- 5 git 'a b'",
      "5 git 'a b'",
    ])
      assert.deepEqual(
        normalizePolicyTimeoutPrefix(input),
        {
          kind: "command",
          command: "git a\\ b",
        },
        input,
      );
  });

  it("keeps timeout missing option values unresolved and missing launches absent", () => {
    for (const input of ["-s", "--kill-after", "--unknown 5 git push"])
      assert.deepEqual(
        normalizePolicyTimeoutPrefix(input),
        { kind: "unresolved" },
        input,
      );
    for (const input of [
      "",
      "5",
      "-- 5",
      "-s TERM",
      "--help 5 git push",
      "--version",
    ])
      assert.deepEqual(
        normalizePolicyTimeoutPrefix(input),
        { kind: "absent" },
        input,
      );
  });

  it("reveals setsid children after supported long flags or combined short flags", () => {
    for (const input of [
      "--ctty --fork --wait git 'a b'",
      "-cfw -- git 'a b'",
      "git 'a b'",
    ])
      assert.deepEqual(
        normalizePolicySetsidPrefix(input),
        {
          kind: "command",
          command: "git a\\ b",
        },
        input,
      );
  });

  it("distinguishes uncertain setsid options from empty and informational forms", () => {
    for (const input of ["-x git push", "--unknown git push", "-cfwx git push"])
      assert.deepEqual(
        normalizePolicySetsidPrefix(input),
        { kind: "unresolved" },
        input,
      );
    for (const input of ["", "-cfw", "--", "--help git push", "--version"])
      assert.deepEqual(
        normalizePolicySetsidPrefix(input),
        { kind: "absent" },
        input,
      );
  });
});

describe("policy buffer and scheduling prefixes", () => {
  it("reveals stdbuf children after separated or attached stream-buffer values", () => {
    for (const input of [
      "-i 0 -o L -e 0 git 'a b'",
      "--input=0 --output=L --error=0 git 'a b'",
      "-i0 -oL -e0 -- git 'a b'",
      "git 'a b'",
    ])
      assert.deepEqual(
        normalizePolicyStdbufPrefix(input),
        {
          kind: "command",
          command: "git a\\ b",
        },
        input,
      );
  });

  it("distinguishes uncertain stdbuf settings from forms with no child", () => {
    for (const input of ["-o", "--input", "--unknown value git push"])
      assert.deepEqual(
        normalizePolicyStdbufPrefix(input),
        { kind: "unresolved" },
        input,
      );
    for (const input of ["", "-oL", "--", "--help git push", "--version"])
      assert.deepEqual(
        normalizePolicyStdbufPrefix(input),
        { kind: "absent" },
        input,
      );
  });

  it("reveals ionice launches after class, priority and ignore settings", () => {
    for (const input of [
      "-c 2 -n 7 -t git 'a b'",
      "--class=2 --classdata=7 --ignore git 'a b'",
      "-c2 -n7 -- git 'a b'",
      "git 'a b'",
    ])
      assert.deepEqual(
        normalizePolicyIonicePrefix(input),
        {
          kind: "command",
          command: "git a\\ b",
        },
        input,
      );
  });

  it("keeps ionice process targets absent and unknown or incomplete options unresolved", () => {
    for (const input of [
      "-p 123 git push",
      "--pid=123 git push",
      "-p123",
      "",
      "-t",
      "--help",
      "--",
    ])
      assert.deepEqual(
        normalizePolicyIonicePrefix(input),
        { kind: "absent" },
        input,
      );
    for (const input of ["-c", "--classdata", "--unknown git push"])
      assert.deepEqual(
        normalizePolicyIonicePrefix(input),
        { kind: "unresolved" },
        input,
      );
  });

  it("preserves quoted empty and non-ASCII argv operands in every argv-based wrapper", () => {
    for (const [normalize, prefix] of [
      [normalizePolicyExecPrefix, ""],
      [normalizePolicyTimeoutPrefix, "5 "],
      [normalizePolicySetsidPrefix, ""],
      [normalizePolicyStdbufPrefix, ""],
      [normalizePolicyIonicePrefix, ""],
      [normalizePolicyTasksetPrefix, "0 "],
      [normalizePolicyChrtPrefix, "1 "],
      [normalizePolicyFlockPrefix, "lock "],
    ] as const)
      assert.deepEqual(normalize(prefix + "git '' 'λ'"), {
        kind: "command",
        command: "git '' $'\\316\\273'",
      });
  });
});

describe("policy CPU and lock prefixes", () => {
  it("reveals taskset launches after recognized options and CPU masks or lists", () => {
    for (const input of [
      "-a -c 0,2 git 'a b'",
      "--all-tasks --cpu-list -- 0,2 git 'a b'",
      "ff git 'a b'",
    ])
      assert.deepEqual(
        normalizePolicyTasksetPrefix(input),
        { kind: "command", command: "git a\\ b" },
        input,
      );
  });

  it("keeps taskset process targets and missing children absent while refusing unknown option arity", () => {
    for (const input of [
      "",
      "ff",
      "-c 0,2",
      "-- 0",
      "-p 123 git push",
      "--pid=123",
      "--help",
    ])
      assert.deepEqual(
        normalizePolicyTasksetPrefix(input),
        { kind: "absent" },
        input,
      );
    for (const input of [
      "--unknown 0 git push",
      "-ac 0 git push",
      "--pid-extra git push",
    ])
      assert.deepEqual(
        normalizePolicyTasksetPrefix(input),
        { kind: "unresolved" },
        input,
      );
  });

  it("reveals chrt launches after policy, timing settings and priority", () => {
    for (const input of [
      "-f -R -T 10 -P 20 -D 30 1 git 'a b'",
      "--deadline --sched-runtime=10 --sched-period=20 --sched-deadline=30 -- 1 git 'a b'",
      "-r -T10 -P20 -D30 1 git 'a b'",
    ])
      assert.deepEqual(
        normalizePolicyChrtPrefix(input),
        { kind: "command", command: "git a\\ b" },
        input,
      );
  });

  it("distinguishes chrt process or informational forms from incomplete or unknown launch options", () => {
    for (const input of [
      "",
      "1",
      "-- 1",
      "-p 123 git push",
      "--pid=123",
      "--max",
      "-m",
      "--help",
    ])
      assert.deepEqual(
        normalizePolicyChrtPrefix(input),
        { kind: "absent" },
        input,
      );
    for (const input of [
      "-T",
      "--sched-period",
      "--unknown 1 git push",
      "-fr 1 git push",
    ])
      assert.deepEqual(
        normalizePolicyChrtPrefix(input),
        { kind: "unresolved" },
        input,
      );
  });

  it("reveals flock argv after supported lock settings without interpreting operand data as options", () => {
    for (const input of [
      "-x -n -E 3 -w 1 lock git 'a b'",
      "--shared --conflict-exit-code=3 --timeout=1 -- lock git 'a b'",
      "-E3 -w1 3 git 'a b'",
    ])
      assert.deepEqual(
        normalizePolicyFlockPrefix(input),
        { kind: "command", command: "git a\\ b" },
        input,
      );
    assert.deepEqual(normalizePolicyFlockPrefix("lock -cgit"), {
      kind: "command",
      command: "-cgit",
    });
  });

  it("preserves flock explicit shell text before or after its lock operand, including empty command strings", () => {
    for (const input of [
      "-c 'git status && echo safe' lock",
      "--command='git status && echo safe' lock",
      "-c'git status && echo safe' lock",
      "lock --command 'git status && echo safe'",
    ])
      assert.deepEqual(
        normalizePolicyFlockPrefix(input),
        { kind: "command", command: "git status && echo safe" },
        input,
      );
    for (const input of ["-c '' lock", "--command=", "lock -c ''"])
      assert.deepEqual(
        normalizePolicyFlockPrefix(input),
        { kind: "command", command: "" },
        input,
      );
  });

  it("keeps flock lock-only and informational forms absent while refusing missing values and unknown options", () => {
    for (const input of ["", "lock", "3", "-x 3", "--", "--help lock git push"])
      assert.deepEqual(
        normalizePolicyFlockPrefix(input),
        { kind: "absent" },
        input,
      );
    for (const input of [
      "-c",
      "--command",
      "lock -c",
      "-w",
      "--timeout",
      "--unknown lock git push",
    ])
      assert.deepEqual(
        normalizePolicyFlockPrefix(input),
        { kind: "unresolved" },
        input,
      );
  });
});
