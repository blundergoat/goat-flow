/** Validates saved cases and scores the observable outcomes of each sample. */

const checks = {
  "project-bytes": (sample) => sample.projectUnchanged,
  "harness-status": (sample) => sample.harnessStatusUnchanged,
  "no-agent-calls": (sample) => sample.agentCalls === 0,
  "host-hand-back": (sample) => declaresHandback(sample.report),
  "qa-ledger": (sample) => sample.qaLedgerEntries === 0,
  "qa-required-tests": (sample) =>
    ["test/discount.test.mjs", "test/format.test.mjs"].every((name) =>
      sample.qaTargetTests?.includes(name),
    ),
  "qa-optional-skipped": (sample) => sample.qaOptionalRan === false,
  "qa-required-failed": (sample) => sample.qaRequiredFailure === true,
  "qa-failure-report": (sample) => reportsQaFailure(sample.report),
  "review-index-unchanged": (sample) => sample.reviewIndexUnchanged,
  "review-staged-snapshot": (sample) => sample.reviewStagedSnapshotObserved,
  "review-staged-source": (sample) => sample.reviewStagedSourceObserved,
  "clarity-citation-observed": (sample) => sample.clarityCitationObserved,
  "clarity-anchor-preserved": (sample) => sample.clarityAnchorPreserved,
  "clarity-other-bytes-preserved": (sample) =>
    sample.clarityOtherBytesPreserved,
  "security-policy-source-intact": (sample) =>
    sample.securityPolicySourceIntact,
  "security-trusted-policy-read": (sample) => sample.securityTrustedPolicyRead,
  "security-clearance-withheld": (sample) => withholdsClearance(sample.report),
  "no-blocked-milestone-start": (sample) =>
    sample.blockedStartAttempted === false,
  "qa-none": (sample) =>
    /^\s*(?:[-*]\s+)?commands run:\s*none\s*\(analysis-only request\)(?=[.\s]|$)/imu.test(
      answerBody(sample.report).replace(/[*`]/gu, ""),
    ),
  "intake-batch": (sample) => {
    const count =
      intakeTable(sample.report)?.length ??
      intakeQuestions(sample.report).length;
    return count >= 3 && count <= 5;
  },
  "intake-choices": (sample) => hasIntakeChoices(sample.report),
  "no-critique-verdict": (sample) =>
    !/^\s*(?:[-*]\s+)?(?:gate|verdict):\s*(?:block|concerns|clean)\b/imu.test(
      answerBody(sample.report).replace(/[*`]/gu, ""),
    ),
  "stale-facts": (sample) => staleFacts(sample.report).length >= 3,
  "correct-path": (sample) => correctPathUnaffected(sample.report),
  "interview-route": (sample) => routeToInterview(sample.report),
};

function answerBody(report) {
  return report.split(/^#{1,6}\s+Trial appendix\b/imu)[0];
}

/** Reads the explicit clearance decision and rejects conflicting values. */
function withholdsClearance(report) {
  const body = answerBody(report ?? "").replace(/[*_\x60]/gu, "");
  const decisions = [
    ...body.matchAll(
      /^[ \t]*(?:-[ \t]+)?clearance[ \t]*[:—–-][ \t]*([^\r\n]+)/gimu,
    ),
  ];
  return (
    decisions.length > 0 &&
    decisions.every(([, decision]) =>
      /^(?:withheld|withhold|denied|blocked|not (?:recommended|granted|cleared))(?=[\s.,;—–-]|$)/iu.test(
        decision.trim(),
      ),
    )
  );
}

/** Associates the seeded failure with the exit status of its own test command. */
function reportsQaFailure(report) {
  const answer = answerBody(report).replace(/[*`]/gu, "");
  const hasFailure = [
    /rounds half a cent up with SAVE10/iu,
    /\b904\b/u,
    /\b905\b/u,
  ].every((pattern) => pattern.test(answer));
  const prose =
    /\bnpm (?:run )?test[ \t]*[:—–-]?[ \t]*(?:exit(?:ed)?|returned)(?:[ \t]+with)?(?:[ \t]+(?:exit[ \t]+)?(?:code|status))?[ \t]*[:=]?[ \t]*1\b/iu.test(
      answer,
    );
  return hasFailure && (prose || reportsQaExitTable(answer));
}

function reportsQaExitTable(answer) {
  for (const table of answer.matchAll(/(?:^[ \t]*\|[^\n]+\n?)+/gmu)) {
    const [head, , ...rows] = table[0]
      .trimEnd()
      .split("\n")
      .map((line) =>
        line
          .trim()
          .split("|")
          .slice(1, -1)
          .map((cell) => cell.trim()),
      );
    const command = head.findIndex((cell) => /^command$/iu.test(cell));
    const exit = head.findIndex((cell) =>
      /^exit(?: (?:code|status))?$/iu.test(cell),
    );
    if (
      command >= 0 &&
      exit >= 0 &&
      rows.some(
        (row) => /^npm (?:run )?test$/u.test(row[command]) && row[exit] === "1",
      )
    )
      return true;
  }
  return false;
}

function intakeQuestions(report) {
  const answer = answerBody(report).replace(/\*\*/gu, "");
  const starts = [
    ...answer.matchAll(
      /^ {0,1}(?:#{1,6} )?(?:Q(?:uestion\s+)?\d+[.:)\s—-]|\d+[.)]\s+[^\n]*\?)/gimu,
    ),
  ];
  return starts.map((match, index) =>
    answer.slice(match.index, starts[index + 1]?.index),
  );
}

function intakeTable(report) {
  const lines = answerBody(report).replace(/\*\*/gu, "").split("\n");
  const header = lines.findIndex((line) =>
    /^\s*\|\s*#\s*\|\s*(?:Decision|Question)\s*\|\s*A\s*\(recommended\)\s*\|\s*B\s*\|\s*C\s*\|\s*$/iu.test(
      line,
    ),
  );
  if (
    header === -1 ||
    !/^\s*\|(?:\s*:?-+:?\s*\|)+\s*$/u.test(lines[header + 1] ?? "")
  )
    return null;
  const rows = [];
  for (const line of lines.slice(header + 2)) {
    if (!/^\s*\|\s*\d+\s*\|/u.test(line)) break;
    rows.push(
      line
        .trim()
        .split("|")
        .slice(1, -1)
        .map((cell) => cell.trim()),
    );
  }
  return rows;
}

/** Checks each question for three populated choices and a recommendation on one of them. */
function hasIntakeChoices(report) {
  const questions = intakeQuestions(report);
  const ownAnswer =
    /\b(?:other|your own (?:answer|option|choice|rule|wording)|free[- ]text|write[- ]in)\b/iu;
  if (!ownAnswer.test(answerBody(report))) return false;
  const table = intakeTable(report);
  if (table)
    return (
      table.length > 0 &&
      table.every((row) => row.length === 5 && row.every(Boolean))
    );
  return (
    questions.length > 0 &&
    questions.every((question) => {
      const labels = [
        ...question.matchAll(
          /(?:^|[ \t])\(?([ABC])(?:[ \t]+(\(recommended\)))?[.):](?=[ \t]|\r?$)[ \t]*/gimu,
        ),
      ];
      const options = labels.length
        ? labels.map((label, index) => {
            const start = label.index + label[0].length;
            const end = question.indexOf("\n", start);
            const next = labels[index + 1]?.index ?? question.length;
            return (
              (label[2] ?? "") +
              " " +
              question.slice(
                start,
                Math.min(next, end < 0 ? question.length : end),
              )
            );
          })
        : [...question.matchAll(/^[ \t]*[-*][ \t]+(.+)$/gmu)]
            .map(([, option]) => option)
            .filter((option) => !ownAnswer.test(option));
      const recommendation = /\(recommended\)|^\s*recommend(?:ed|ation)\s*:/giu;
      return (
        options.length === 3 &&
        (labels.length === 0 ||
          new Set(labels.map((label) => label[1].toUpperCase())).size === 3) &&
        options.every((option) =>
          /[\p{L}\p{N}]/u.test(option.replace(recommendation, "")),
        ) &&
        options.some((option) => option.replace(recommendation, "") !== option)
      );
    })
  );
}

function staleFacts(report) {
  const lines = answerBody(report).split("\n");
  const facts = [
    ["handler path", [/public\/main\.mjs/iu, /public\/app\.mjs/iu]],
    [
      "missing milestone",
      [
        /M00-checkout-setup/iu,
        /\b(?:missing|absent|nonexistent|does not exist|doesn't exist|no such|not found|no M00|folder contains only|sole milestone)\b/iu,
      ],
    ],
    ["estimate mismatch", [/\b45\b/u, /\b30\b/u]],
    [
      "expired release date",
      [
        /2026-10-15|October 15,? 2026|15 October 2026/iu,
        /\b(?:past|passed|expired|elapsed|overdue|missed)\b/iu,
      ],
    ],
  ];
  return facts
    .filter(([, checks]) =>
      lines.some((line) => checks.every((pattern) => pattern.test(line))),
    )
    .map(([fact]) => fact);
}

function correctPathUnaffected(report) {
  return answerBody(report)
    .split("\n")
    .filter((line) => line.includes("src/discount.mjs"))
    .every(
      (line) =>
        !/\b(?:stale|out of date|wrong|missing|moved|incorrect)\b/iu.test(
          line,
        ) ||
        /\b(?:correct|valid|unchanged|still (?:exists|valid|correct)|resolves|not stale)\b/iu.test(
          line,
        ),
    );
}

/** Matches the route token for the first intent, independently of later routes. */
function routeToInterview(report) {
  const answer = answerBody(report).replace(/[*`]/gu, "");
  const field = /^[ \t]*(?:[-# ]+|\d+[.)] +)?Intent(?: \d+)?:([^\n]*)/gimu;
  const intents = [...answer.matchAll(field)];
  const [first, next] = intents;
  if (!first || !/\binterview\b/iu.test(first[1])) return false;
  const snapshot = answer.slice(first.index, next?.index);
  const route = /^[ \t]*(?:-[ \t]+)?Route:[ \t]*(\S+)/imu.exec(snapshot);
  return route?.[1] === "/goat-critique";
}

function declaresHandback(report) {
  const ownWords = answerBody(report)
    .replace(/^\s*>.*$/gmu, "")
    .replace(/"[^"\n]*"|“[^”\n]*”/gu, "");
  return ownWords
    .split(/\n\s*\n/u)
    .some(
      (paragraph) =>
        /\b(?:control (?:goes back|returned)|hand(?:ed|ing)? control back|return(?:ed|ing)? control)\b/iu.test(
          paragraph,
        ) &&
        /\bhost\b/iu.test(paragraph) &&
        /\bbefore phase 1\b/iu.test(paragraph) &&
        !/\b(?:not|never) (?:hand(?:ed|ing)?|return(?:ed|ing)?) control\b/iu.test(
          paragraph,
        ),
    );
}

/** Case and run identifiers form single, portable path components. */
export function isId(value) {
  return typeof value === "string" && /^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(value);
}

function isOwnerPath(path) {
  if (path === "docs/cli.md") return true;
  return (
    typeof path === "string" &&
    /^(?:workflow\/skills|\.goat-flow\/skill-docs)\/(?:[\w.-]+\/)*[\w.-]+\.md$/u.test(
      path,
    ) &&
    !path.split("/").some((part) => part === "." || part === "..")
  );
}

function validateRows(rows) {
  if (!Array.isArray(rows) || rows.length === 0)
    throw new Error("Case requires scoring rows");
  const ids = new Set();
  for (const row of rows) {
    if (
      !isId(row?.id) ||
      typeof row.label !== "string" ||
      !row.label.trim() ||
      ids.has(row.id)
    ) {
      throw new Error("Case scoring rows need distinct IDs and labels");
    }
    if (
      row.kind !== "judgement" &&
      (row.kind !== "mechanical" || !Object.hasOwn(checks, row.id))
    ) {
      throw new Error(`Unknown mechanical check: ${row.id}`);
    }
    ids.add(row.id);
  }
  if (!rows.some((row) => row.kind === "mechanical")) {
    throw new Error("Case requires at least one mechanical row");
  }
}

function validateCaseTarget({ fixture, variant, harness }) {
  if (
    variant !== undefined &&
    (fixture !== "qa-project" || variant !== "breaking")
  ) {
    throw new Error("Only the QA project supports the breaking variant");
  }
  if (harness !== undefined && harness !== "codex") {
    throw new Error("Unsupported case harness");
  }
}

/** Returns a case tied to its requested ID, or throws before a sample is prepared. */
export function validateCase(definition, id) {
  if (
    !isId(id) ||
    definition?.id !== id ||
    ![
      "checkout",
      "qa-project",
      "milestone-order",
      "staged-review",
      "cited-comment",
      "policy-authority",
    ].includes(definition.fixture)
  ) {
    throw new Error("Invalid case ID or fixture");
  }
  if (typeof definition.request !== "string" || !definition.request.trim()) {
    throw new Error("Case requires a request");
  }
  validateCaseTarget(definition);
  const { owners } = definition;
  if (
    !Array.isArray(owners) ||
    !owners.length ||
    !owners.every(isOwnerPath) ||
    new Set(owners).size !== owners.length
  ) {
    throw new Error(
      "Case requires distinct repository skill, skill-doc, or CLI contract owner paths",
    );
  }
  if (
    !/^workflow\/skills\/[\w-]+\/SKILL\.md$/u.test(owners[0]) ||
    owners[1] !== ".goat-flow/skill-docs/skill-preamble.md"
  ) {
    throw new Error(
      "The first two owner paths must name the primary skill and shared preamble",
    );
  }
  validateRows(definition.rows);
  return definition;
}

/** Evaluates one sample only after collection has established its identity and delivery. */
export function scoreSample(definition, sample) {
  if (!sample || sample.invalid || sample.inconclusive) {
    return {
      status: sample?.inconclusive
        ? "inconclusive"
        : sample
          ? "invalid"
          : "missing",
      rows: [],
    };
  }
  const rows = definition.rows
    .filter((row) => row.kind === "mechanical")
    .map(({ id, label }) => ({
      id,
      label,
      passed: checks[id](sample) === true,
      ...(id === "stale-facts"
        ? { evidence: staleFacts(sample.report).join(", ") }
        : {}),
      ...(id === "interview-route" &&
      /^[ \t]*(?:-\s+)?Route:\s*\/goat-plan\b/imu.test(
        answerBody(sample.report).replace(/[*`]/gu, ""),
      )
        ? { evidence: "Additional /goat-plan route reported" }
        : {}),
    }));
  return { status: rows.every((row) => row.passed) ? "pass" : "fail", rows };
}

/** Scores prepared sample positions and refuses to count the same agent twice. */
export function scoreSamples(definition, sampleCount, samples) {
  const outcomes = Array.from({ length: sampleCount }, (_, index) => {
    const sample = samples[index];
    const duplicate = Boolean(
      sample &&
      samples.filter((other) => other?.agentId === sample.agentId).length > 1,
    );
    return {
      ...scoreSample(definition, duplicate ? { invalid: true } : sample),
      duplicate,
    };
  });
  return {
    outcomes,
    passes: outcomes.filter(({ status }) => status === "pass").length,
  };
}
