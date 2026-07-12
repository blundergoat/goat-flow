/**
 * Composer for the artifact (skill / reference) quality-assessment prompt.
 *
 * Builds the prompt that scores a single skill or reference document against the
 * five semantic dimensions, applying per-subtype weighting: playbook and index
 * subtypes weight Examples higher, while the meta subtype may mark Examples `n/a`
 * with justification. Pure string assembly over the passed SkillQualityReport.
 */
import type { SkillQualityReport } from "../quality/skill-quality.js";
import { markdownTableCell } from "./compose-quality-common.js";

/** Render the per-subtype Examples dimension criteria for the Semantic
 *  Dimensions section. Playbook/index subtypes weight Examples higher; meta
 *  subtype permits an explicit `n/a` with justification. */
function renderExamplesDimensionCriteria(subtype: string): string[] {
  const lines: string[] = [];
  lines.push(
    "  - Are examples concrete (real values, real expected output) or hypothetical placeholders?",
  );
  lines.push("  - Do examples show edge cases, not just the happy path?");
  lines.push(
    "  - Are BAD/GOOD pairs, labelled counter-examples, or expected-output annotations present where the artifact enforces a convention?",
  );
  if (subtype === "workflow") {
    lines.push(
      "  - Workflow subtype: is at least one full phase walked through with real artifacts (file path + action + expected outcome)?",
    );
  } else if (subtype === "playbook" || subtype === "index") {
    lines.push(
      `  - **${subtype} subtype: weight Examples HIGHER.** Playbooks and indexes live or die by examples; treat thin example coverage as a deduction even if other dimensions are strong.`,
    );
  } else if (subtype === "meta") {
    lines.push(
      "  - Meta subtype: Examples may legitimately be `n/a`. If you mark it n/a, justify why (the artifact is a contract loaded by skills, not a procedure that needs runnable examples) and exclude it from `semanticMax`.",
    );
  }
  return lines;
}

function appendComposedFromInstruction(
  lines: string[],
  report: SkillQualityReport,
  kindLower: string,
): void {
  const { artifact, composedFrom } = report;
  if (composedFrom.length === 0) {
    lines.push(
      `Assess the ${kindLower} artifact at \`${artifact.path}\`. The engine composed no additional files (single-file scoring path); read this file in full before scoring.`,
    );
    return;
  }
  const exampleReferenced =
    composedFrom.find((s) => s.startsWith("references/")) ??
    composedFrom.find((s) => s !== artifact.name && !/^SKILL\.md$/i.test(s)) ??
    composedFrom[composedFrom.length - 1];
  const exampleClause = exampleReferenced
    ? ` Structural signals from referenced files count toward your assessment: content documented in \`${exampleReferenced}\` is part of the ${kindLower}, not bonus material.`
    : "";
  lines.push(
    `Assess the ${kindLower} **${artifact.name}**. Read every file in **Composed from** below - the engine composes ${composedFrom.length} file${composedFrom.length === 1 ? "" : "s"} into the runtime surface (\`${composedFrom.join("`, `")}\`).${exampleClause}`,
  );
  lines.push("");
  lines.push(
    'If a `composition truncated` fit note appears below, the composed bundle is incomplete. Read the actual files listed in **Composed from** directly when context allows; otherwise note the skipped files in the final "What was not verified" section.',
  );
}

/** Compose a focused quality prompt for a single skill or reference artifact.
 *  The prompt requires five scored semantic dimensions, an
 *  anti-bias preamble, an explicit per-file `composedFrom` reading
 *  instruction, a focus/scope probe, a final gate decision, and a fenced JSON
 *  block summarising the verdict.
 *
 * @param report - skill-quality report to turn into a focused reviewer prompt
 * @returns prompt text for reviewing the selected skill or reference artifact
 */
export function composeArtifactQualityPrompt(
  report: SkillQualityReport,
): string {
  const {
    artifact,
    totalScore,
    maxTotalScore,
    subtype,
    recommendation,
    metrics,
    composedFrom,
    fitNotes,
  } = report;
  const kindLabel = artifact.kind === "skill" ? "Skill" : "Shared Reference";
  const kindLower = kindLabel.toLowerCase();
  const pct =
    maxTotalScore > 0 ? Math.round((totalScore / maxTotalScore) * 100) : 0;

  const lines: string[] = [];
  lines.push(`# ${kindLabel} Quality Review: ${artifact.name}`);
  lines.push("");
  lines.push(
    "REPORTING-ONLY ASSESSMENT MODE. Do not edit tracked files. This prompt is the full assessment contract. You may read files and run read-only commands.",
  );
  lines.push("");
  appendComposedFromInstruction(lines, report, kindLower);
  lines.push("");

  lines.push("## Deterministic Baseline");
  lines.push("");
  lines.push(`- **Artifact:** ${artifact.name} (${kindLabel})`);
  lines.push(`- **Path:** \`${artifact.path}\``);
  lines.push(`- **Subtype:** ${subtype}`);
  if (report.shapeMismatch) {
    lines.push(
      `- **Detected shape:** ${report.detectedShape} (${Math.round(report.shapeConfidence * 100)}% confidence)`,
    );
  }
  lines.push(`- **Score:** ${totalScore}/${maxTotalScore} (${pct}%)`);
  lines.push(`- **Recommendation:** ${recommendation}`);
  if (composedFrom.length > 0) {
    lines.push(`- **Composed from:** ${composedFrom.join(", ")}`);
  }
  lines.push("");

  lines.push("### Metric Breakdown");
  lines.push("");
  lines.push("| Metric | Score | Severity | Detail |");
  lines.push("|--------|-------|----------|--------|");
  for (const m of metrics) {
    lines.push(
      `| ${markdownTableCell(m.label)} | ${m.score}/${m.maxScore} | ${m.severity} | ${markdownTableCell(m.detail)} |`,
    );
  }
  lines.push("");

  if (fitNotes.length > 0) {
    lines.push("### Fit Notes");
    lines.push("");
    for (const note of fitNotes) {
      lines.push(`- ${note}`);
    }
    lines.push("");
  }

  lines.push("## Anti-Bias Guidance");
  lines.push("");
  lines.push(
    'Score against absolute criteria, not relative to other artifacts you have reviewed. Do not let one strong dimension halo over a weak one - score each dimension independently. Recent sections of the file should not weigh more than earlier ones; read everything before scoring. If you are tempted to round up because the artifact "seems okay," round down - leniency is the most common failure mode of this rubric.',
  );
  lines.push("");

  lines.push("## Semantic Dimensions");
  lines.push("");
  lines.push(
    'Score each applicable dimension on a 1-5 scale. For every dimension provide: (a) the score, (b) one sentence of evidence, (c) the lowest-quality span supporting any deduction, cited as `path/file (search: "semantic-anchor")`. If a dimension is legitimately `n/a` for this subtype, mark it `n/a`, justify why, and exclude it from `semanticMax`.',
  );
  lines.push("");
  lines.push("- **Clarity (1-5)** - instruction precision, imperative voice,");
  lines.push(
    "  ambiguity, technical-term grounding. Can a fresh reader execute the workflow without guessing?",
  );
  lines.push("- **Examples (1-5)** -");
  for (const line of renderExamplesDimensionCriteria(subtype)) {
    lines.push(line);
  }
  lines.push(
    '- **Focus (1-5)** - single purpose vs kitchen-sink. Apply the "describe in one sentence" test: if the artifact\'s purpose needs three clauses joined by AND, focus is weak.',
  );
  lines.push(
    "- **Coherence (1-5)** - does the bundle (SKILL.md + references) tell one coherent story, or do parts contradict, drift, or duplicate?",
  );
  lines.push(
    "- **Misuse / Limits (1-5)** - does the artifact state when not to use it, forbidden shortcuts, and where adjacent work belongs? Penalize boundary text that exists only to satisfy a checklist but does not change an agent's decision.",
  );
  lines.push("");
  lines.push(
    "Compute `semanticTotal`, `semanticMax` (default `/25` across the five dimensions; subtract any `n/a` dimension's max), and `semanticPct = semanticTotal / semanticMax`.",
  );
  lines.push("");

  lines.push("## Your Assessment");
  lines.push("");
  lines.push(
    "After the structured semantic scoring above, deepen the assessment with these questions:",
  );
  lines.push("");
  lines.push(
    `1. **Classification challenge:** Is \`${recommendation}\` the right recommendation? If the artifact is currently a ${kindLower}, should it be reclassified? Provide evidence.`,
  );
  lines.push(
    "2. **Metric verification:** For each metric scored below max, is the deduction justified? Are there structural signals the static scorer missed?",
  );
  lines.push(
    "3. **Quality gaps:** What quality issues exist that the deterministic metrics do not capture (e.g., misleading instructions, outdated references, unclear boundaries)?",
  );
  lines.push(
    "4. **Top 3 improvements:** Actionable changes with file path and semantic anchor evidence. **Each improvement must cite the dimension it addresses; if a deduction has no improvement listed, that is itself a finding.**",
  );
  lines.push(
    "5. **What was not verified:** State any aspects you could not assess from a file read.",
  );
  lines.push(
    '6. **Scope check:** Write a one-sentence summary of what this artifact does. If you cannot, that is a Clarity finding (record in semantic dimensions). If your sentence describes 3+ distinct concerns ("formats code AND evaluates it AND documents it"), recommend splitting and propose the boundaries. Note: this answers "is the scope right within the assigned subtype?" - distinct from the structural `consider-reclassifying` recommendation, which answers "is the subtype right?"',
  );
  lines.push(
    "7. **Metric-gaming check:** What could an author add to satisfy this score without improving agent behavior? Identify checklist-shaped language that would look compliant while leaving misuse possible.",
  );
  lines.push("");

  lines.push("## Final Gate");
  lines.push("");
  lines.push(
    "Return one of `ship` / `revise` / `block` based on the deterministic recommendation, the semantic percentage, and per-dimension floors:",
  );
  lines.push("");
  lines.push(
    "- **ship** - deterministic recommendation is `keep-skill` OR `reference-playbook`, AND `semanticPct >= 0.8`, AND no applicable dimension scores below 3.",
  );
  lines.push(
    "- **revise** - deterministic recommendation is `keep-skill` / `reference-playbook` AND (`semanticPct < 0.8` OR any applicable dimension < 3); OR deterministic recommendation is `consider-revision` AND `semanticPct >= 0.5` AND no applicable dimension equals 1.",
  );
  lines.push(
    "- **block** - deterministic recommendation is `needs-human-review` / `retire` / `consider-reclassifying`; OR `semanticPct < 0.5`; OR any applicable dimension equals 1.",
  );
  lines.push("");
  lines.push(
    "The deterministic recommendation is the structural floor. You may override it (e.g. gate `block` when the engine said `keep-skill`) only with explicit reasoning that cites specific evidence the engine missed.",
  );
  lines.push("");

  lines.push("## Required JSON Verdict");
  lines.push("");
  lines.push(
    "End your response with a fenced ```json``` block matching this schema. The block must be the final content; the dashboard parses it best-effort.",
  );
  lines.push("");
  lines.push("```json");
  lines.push("{");
  lines.push('  "semanticScores": {');
  lines.push('    "clarity": 4,');
  lines.push('    "examples": 3,');
  lines.push('    "focus": 5,');
  lines.push('    "coherence": 4,');
  lines.push('    "misuseLimits": 4,');
  lines.push('    "total": 20,');
  lines.push('    "max": 25');
  lines.push("  },");
  lines.push('  "gateDecision": "revise",');
  lines.push(
    '  "gateRationale": "Examples score 3/5; only one realistic scenario shown.",',
  );
  lines.push('  "blockers": [],');
  lines.push('  "improvements": [');
  lines.push("    {");
  lines.push('      "dimension": "examples",');
  lines.push('      "priority": "high",');
  lines.push(
    '      "action": "Add 2 concrete scenarios showing expected output for the ambiguous-input case (cite file + semantic anchor)."',
  );
  lines.push("    }");
  lines.push("  ]");
  lines.push("}");
  lines.push("```");

  return lines.join("\n");
}
